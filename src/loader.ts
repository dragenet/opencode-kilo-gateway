import type { StoredAuth } from "./client"
import { resolveApiBase } from "./config"
import { buildKiloHeaders } from "./headers"
import { parseKiloToken } from "./token"

export interface LoaderResult {
  baseURL: string
  apiKey: string
  headers: Record<string, string>
}

/**
 * Builds the provider options opencode/the AI SDK need to talk to Kilo:
 * the org-scoped (or public) base URL, the bearer token, and headers.
 * Returns `{}` when there is no usable OAuth credential yet.
 */
export function buildLoaderResult(
  auth: StoredAuth,
  version: string,
  envApiUrl?: string,
): LoaderResult | Record<string, never> {
  if (!auth || auth.type !== "oauth" || !auth.access) return {}

  const { baseUrl: embeddedBaseUrl, token } = parseKiloToken(auth.access)
  const apiBase = embeddedBaseUrl ?? resolveApiBase(envApiUrl)
  const baseURL = auth.accountId
    ? `${apiBase}/api/organizations/${encodeURIComponent(auth.accountId)}`
    : `${apiBase}/api/openrouter`

  return {
    baseURL,
    apiKey: token,
    headers: buildKiloHeaders({ ...(auth.accountId ? { accountId: auth.accountId } : {}), version }),
  }
}

/** Creates the opencode auth-plugin `loader` function for the Kilo provider. */
export function createLoader(version: string) {
  return async (getAuth: () => Promise<StoredAuth>): Promise<LoaderResult | Record<string, never>> => {
    const auth = await getAuth()
    return buildLoaderResult(auth, version, process.env.KILO_API_URL)
  }
}
