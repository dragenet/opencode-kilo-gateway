import { buildLoginMethod, buildSwitchOrgMethod } from "./auth.js";
import { getStoredAuth } from "./client.js";
import { PACKAGE_VERSION, PROVIDER_ID, resolveApiBase } from "./config.js";
import { createLoader } from "./loader.js";
import { fetchKiloModels } from "./models.js";
import { fetchProfile, organizationSelectOptions } from "./profile.js";
import { setup } from "./v2/index.js";
/**
 * The Kilo gateway opencode plugin: device-auth login, cross-surface
 * organization selection, and dynamic org-scoped model listing for the
 * `kilo` provider.
 */
export const KiloGateway = async (input) => {
    const apiBase = resolveApiBase(process.env.KILO_API_URL);
    const methods = [buildLoginMethod(apiBase)];
    const stored = await getStoredAuth(input.client, PROVIDER_ID);
    if (stored?.type === "oauth" && stored.access) {
        try {
            const profile = await fetchProfile(apiBase, stored.access);
            const options = organizationSelectOptions(profile);
            const switchMethod = buildSwitchOrgMethod(apiBase, options, stored.access, stored.expires);
            if (switchMethod)
                methods.push(switchMethod);
        }
        catch {
            // Profile fetch failed (e.g. expired/invalid token) — only the
            // primary login method is offered; logging in again will refresh it.
        }
    }
    return {
        auth: {
            provider: PROVIDER_ID,
            methods,
            loader: createLoader(PACKAGE_VERSION),
        },
        provider: {
            id: PROVIDER_ID,
            async models(_provider, ctx) {
                const auth = ctx.auth;
                const token = process.env.KILO_API_KEY || (auth?.type === "oauth" ? auth.access : undefined);
                const accountId = process.env.KILO_ORG_ID || (auth?.type === "oauth" ? auth.accountId : undefined);
                return fetchKiloModels({ baseUrl: apiBase, accountId, token });
            },
        },
    };
};
export default { id: "kilo-gateway", server: KiloGateway, setup };
