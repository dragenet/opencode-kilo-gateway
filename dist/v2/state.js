import { resolveApiBase } from "../config.js";
import { fetchRawKiloModels } from "../models.js";
import { fetchProfile, organizationSelectOptions } from "../profile.js";
import { parseKiloToken } from "../token.js";
export const PERSONAL = "personal";
const PROFILE_TIMEOUT_MS = 10_000;
function str(value) {
    return typeof value === "string" && value ? value : undefined;
}
async function resolveAuth(deps) {
    const { env } = deps;
    const envKey = env.KILO_API_KEY;
    if (envKey) {
        return {
            auth: {
                token: envKey,
                apiBase: resolveApiBase(env.KILO_API_URL),
                embeddedBaseUrl: false,
                orgId: env.KILO_ORG_ID || undefined,
                source: "env",
            },
        };
    }
    const active = await deps.connection.active("kilo");
    if (active === undefined || active === null)
        return undefined;
    const resolved = await deps.connection.resolve(active);
    if (!resolved)
        return undefined;
    if (resolved.type === "oauth" && resolved.access) {
        const parsed = parseKiloToken(resolved.access);
        const metadataOrgName = str(resolved.metadata?.orgName);
        return {
            auth: {
                token: parsed.token,
                apiBase: parsed.baseUrl ?? resolveApiBase(env.KILO_API_URL),
                embeddedBaseUrl: parsed.baseUrl !== undefined,
                orgId: env.KILO_ORG_ID || str(resolved.metadata?.accountID),
                source: "credential",
                credential: {
                    access: resolved.access,
                    refresh: resolved.refresh ?? "",
                    expires: resolved.expires ?? 0,
                },
            },
            metadataOrgName,
        };
    }
    if (resolved.type === "key" && resolved.key) {
        return {
            auth: {
                token: resolved.key,
                apiBase: resolveApiBase(env.KILO_API_URL),
                embeddedBaseUrl: false,
                source: "credential",
            },
        };
    }
    return undefined;
}
function withTimeout(base, ms) {
    return ((input, init) => base(input, { ...init, signal: AbortSignal.timeout(ms) }));
}
function toOrgOptions(profile) {
    return organizationSelectOptions(profile).map((option) => ({
        value: option.value === "" ? PERSONAL : option.value,
        label: option.label,
    }));
}
function sameAuth(a, b) {
    return JSON.stringify(a) === JSON.stringify(b);
}
export function createKiloState(deps) {
    const state = { orgOptions: [] };
    let generation = 0;
    async function run(gen) {
        const resolved = await resolveAuth(deps);
        const fetchImpl = deps.fetchImpl ?? fetch;
        let auth = resolved?.auth;
        // Profile and models are independent: a failure of one keeps the previous
        // value of that part of the state (undefined here = "not fetched").
        let orgOptions;
        let models;
        if (auth) {
            const { apiBase, token, orgId } = auth;
            const [profileResult, modelsResult] = await Promise.allSettled([
                fetchProfile(apiBase, token, withTimeout(fetchImpl, PROFILE_TIMEOUT_MS)),
                fetchRawKiloModels({ baseUrl: apiBase, accountId: orgId, token, fetchImpl: deps.fetchImpl }),
            ]);
            let profileOrgName;
            if (profileResult.status === "fulfilled") {
                orgOptions = toOrgOptions(profileResult.value);
                profileOrgName = orgId ? profileResult.value.organizations?.find((org) => org.id === orgId)?.name : undefined;
            }
            if (modelsResult.status === "fulfilled")
                models = modelsResult.value;
            // Org name precedence: profile > stored metadata > previous name (same org).
            const previous = state.auth;
            const previousName = previous && previous.orgId === orgId && previous.token === token ? previous.orgName : undefined;
            const orgName = profileOrgName ?? resolved?.metadataOrgName ?? previousName;
            if (orgName !== undefined)
                auth = { ...auth, orgName };
        }
        else {
            // Signed out: the public catalog is not fetched; models stay undefined.
            orgOptions = [];
        }
        // Stale generations must be discarded before ANY state assignment.
        if (gen !== generation)
            return;
        // Data must never outlive the account it was fetched for: when the token
        // changes, a failed profile fetch clears orgOptions; when the token or the
        // effective org changes, a failed models fetch clears models (undefined →
        // provider falls back to the catalog). With the same account, a failed
        // fetch keeps the previous value.
        const previous = state.auth;
        const tokenChanged = previous?.token !== auth?.token;
        const accountChanged = tokenChanged || previous?.orgId !== auth?.orgId;
        const nextOrgOptions = orgOptions ?? (tokenChanged ? [] : state.orgOptions);
        const nextModels = models ?? (accountChanged ? undefined : state.models);
        // onChange rule: called once per non-stale, completed refresh in which
        // auth, orgOptions or models changed in content (compared by value), so
        // identical periodic refreshes and "network down, same account" refreshes
        // do not trigger reloads.
        const changed = !sameAuth(previous, auth) ||
            JSON.stringify(nextOrgOptions) !== JSON.stringify(state.orgOptions) ||
            JSON.stringify(nextModels) !== JSON.stringify(state.models);
        state.auth = auth;
        state.orgOptions = nextOrgOptions;
        state.models = nextModels;
        if (changed)
            await deps.onChange();
    }
    async function refresh() {
        const gen = ++generation;
        try {
            await run(gen);
        }
        catch {
            // never throws: a failing connection lookup or onChange leaves state as is
        }
    }
    return { state, refresh };
}
