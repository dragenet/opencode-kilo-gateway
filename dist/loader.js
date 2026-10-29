import { resolveApiBase } from "./config.js";
import { buildKiloHeaders } from "./headers.js";
import { parseKiloToken } from "./token.js";
/**
 * Builds the provider options opencode/the AI SDK need to talk to Kilo:
 * the shared `/api/openrouter` base URL, the bearer token, and headers.
 * Chat completions always route through this shared base — Kilo's
 * `/api/organizations/{id}` URL-path namespace only implements model
 * listing, not chat completions (confirmed to 404 there). Organization
 * scoping for chat completions is done exclusively via the
 * `X-KiloCode-OrganizationId` header (see `buildKiloHeaders`), not the URL.
 * Returns `{}` when there is no usable OAuth credential yet.
 */
export function buildLoaderResult(auth, version, envApiUrl, envApiKey, envOrgId) {
    if (envApiKey) {
        const apiBase = resolveApiBase(envApiUrl);
        const baseURL = `${apiBase}/api/openrouter`;
        return {
            baseURL,
            apiKey: envApiKey,
            headers: buildKiloHeaders({ ...(envOrgId ? { accountId: envOrgId } : {}), version }),
        };
    }
    if (!auth || auth.type !== "oauth" || !auth.access)
        return {};
    const { baseUrl: embeddedBaseUrl, token } = parseKiloToken(auth.access);
    const apiBase = embeddedBaseUrl ?? resolveApiBase(envApiUrl);
    const baseURL = `${apiBase}/api/openrouter`;
    return {
        baseURL,
        apiKey: token,
        headers: buildKiloHeaders({ ...(envOrgId || auth.accountId ? { accountId: envOrgId || auth.accountId } : {}), version }),
    };
}
/** Creates the opencode auth-plugin `loader` function for the Kilo provider. */
export function createLoader(version) {
    return async (getAuth) => {
        const auth = await getAuth();
        return buildLoaderResult(auth, version, process.env.KILO_API_URL, process.env.KILO_API_KEY, process.env.KILO_ORG_ID);
    };
}
