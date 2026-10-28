import type { StoredAuth } from "./client.js";
export interface LoaderResult {
    baseURL: string;
    apiKey: string;
    headers: Record<string, string>;
}
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
export declare function buildLoaderResult(auth: StoredAuth, version: string, envApiUrl?: string, envApiKey?: string, envOrgId?: string): LoaderResult | Record<string, never>;
/** Creates the opencode auth-plugin `loader` function for the Kilo provider. */
export declare function createLoader(version: string): (getAuth: () => Promise<StoredAuth>) => Promise<LoaderResult | Record<string, never>>;
