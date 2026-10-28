import { PROVIDER_ID, resolveApiBase } from "../config.js";
import { initiateDeviceAuth, waitForDeviceAuthApproval } from "../device-auth.js";
import { defaultOrganizationId, fetchProfile } from "../profile.js";
import { PERSONAL } from "./state.js";
export const LOGIN_METHOD_ID = "oauth";
export const ORG_METHOD_ID = "organization";
const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000;
const LOGIN_METHOD = { id: LOGIN_METHOD_ID, type: "oauth", label: "Login with Kilo" };
const ORG_METHOD_BASE = { id: ORG_METHOD_ID, type: "oauth", label: "Kilo · Add organization" };
export function credentialLabel(credential) {
    const name = credential.metadata?.orgName ?? credential.metadata?.accountID ?? "Personal";
    return "Kilo · " + String(name);
}
/** Builds a v2 OAuth credential; the branded `methodID` cast lives here. */
function oauthCredential(methodID, fields) {
    const { metadata, ...rest } = fields;
    const credential = { type: "oauth", methodID, ...rest, ...(metadata ? { metadata } : {}) };
    return credential;
}
function rejected(apiBase, instructions, error) {
    const callback = Promise.reject(error);
    // Silence premature unhandled-rejection detection; core still awaits `callback` itself.
    callback.catch(() => { });
    return { url: apiBase, instructions, mode: "auto", callback };
}
function errorMessage(error) {
    return error instanceof Error ? error.message : String(error);
}
export async function registerIntegration(ctx, state, deps = {}) {
    const fetchImpl = deps.fetchImpl ?? fetch;
    const env = deps.env ?? process.env;
    const now = deps.now ?? Date.now;
    const waitOptions = deps.waitOptions ?? {};
    async function approve(apiBase, init) {
        const poll = await waitForDeviceAuthApproval(apiBase, init, fetchImpl, waitOptions);
        if (poll.status === "denied")
            throw new Error("Kilo login was denied");
        if (poll.status !== "approved" || !poll.token)
            throw new Error("Kilo device code expired — try again");
        const token = poll.token;
        const metadata = {};
        try {
            const profile = await fetchProfile(apiBase, token, fetchImpl);
            const orgId = defaultOrganizationId(profile);
            if (orgId) {
                metadata.accountID = orgId;
                const orgName = profile.organizations?.find((org) => org.id === orgId)?.name;
                if (orgName)
                    metadata.orgName = orgName;
            }
        }
        catch {
            // profile unavailable: store the credential without organization metadata
        }
        return oauthCredential(LOGIN_METHOD_ID, {
            access: token,
            refresh: token,
            expires: now() + ONE_YEAR_MS,
            ...(Object.keys(metadata).length > 0 ? { metadata } : {}),
        });
    }
    async function authorizeLogin() {
        const apiBase = resolveApiBase(env.KILO_API_URL);
        let init;
        try {
            init = await initiateDeviceAuth(apiBase, fetchImpl);
        }
        catch (error) {
            const message = errorMessage(error);
            return rejected(apiBase, message, new Error(message));
        }
        return {
            url: init.verificationUrl,
            instructions: `Approve this device in your browser. Code: ${init.code}`,
            expiresAt: now() + init.expiresIn * 1000,
            mode: "auto",
            callback: approve(apiBase, init),
        };
    }
    async function authorizeOrganization(answer) {
        const apiBase = resolveApiBase(env.KILO_API_URL);
        const stored = state.auth?.credential;
        if (!stored)
            return rejected(apiBase, "Adding Kilo organization…", new Error("Log in with ‘Login with Kilo’ first"));
        const selected = typeof answer[ORG_METHOD_ID] === "string" ? answer[ORG_METHOD_ID] : PERSONAL;
        const metadata = selected === PERSONAL
            ? { orgName: "Personal" }
            : {
                accountID: selected,
                orgName: state.orgOptions.find((option) => option.value === selected)?.label ?? selected,
            };
        return {
            url: apiBase,
            instructions: "Adding Kilo organization…",
            mode: "auto",
            callback: Promise.resolve(oauthCredential(ORG_METHOD_ID, {
                access: stored.access,
                refresh: stored.refresh,
                expires: stored.expires,
                metadata,
            })),
        };
    }
    await ctx.integration.transform((editor) => {
        editor.method.update({
            integrationID: PROVIDER_ID,
            method: LOGIN_METHOD,
            authorize: authorizeLogin,
            label: credentialLabel,
        });
        const auth = state.auth;
        if (auth?.source === "credential" && auth.credential && state.orgOptions.length >= 2) {
            const form = [
                {
                    type: "string",
                    key: ORG_METHOD_ID,
                    title: "Organization",
                    required: true,
                    options: state.orgOptions,
                    default: auth.orgId ?? PERSONAL,
                },
            ];
            editor.method.update({
                integrationID: PROVIDER_ID,
                method: { ...ORG_METHOD_BASE, form },
                authorize: authorizeOrganization,
                label: credentialLabel,
            });
        }
        else {
            editor.method.remove(PROVIDER_ID, ORG_METHOD_BASE);
        }
    });
}
