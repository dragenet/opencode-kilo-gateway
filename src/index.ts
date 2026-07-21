import type { Plugin } from "@opencode-ai/plugin"
import { buildLoginMethod, buildSwitchOrgMethod, type OAuthMethod } from "./auth"
import { getStoredAuth } from "./client"
import { PACKAGE_VERSION, PROVIDER_ID, resolveApiBase } from "./config"
import { createLoader } from "./loader"
import { fetchKiloModels } from "./models"
import { fetchProfile, organizationSelectOptions } from "./profile"

/**
 * The Kilo gateway opencode plugin: device-auth login, cross-surface
 * organization selection, and dynamic org-scoped model listing for the
 * `kilo` provider.
 */
export const KiloGateway: Plugin = async (input) => {
  const apiBase = resolveApiBase(process.env.KILO_API_URL)

  const methods: OAuthMethod[] = [buildLoginMethod(apiBase)]

  const stored = await getStoredAuth((input as { client?: unknown }).client, PROVIDER_ID)
  if (stored?.type === "oauth" && stored.access) {
    try {
      const profile = await fetchProfile(apiBase, stored.access)
      const options = organizationSelectOptions(profile)
      const switchMethod = buildSwitchOrgMethod(apiBase, options, stored.access, stored.expires)
      if (switchMethod) methods.push(switchMethod)
    } catch {
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
        const auth = (ctx as { auth?: { type?: string; access?: string; accountId?: string } }).auth
        const token = auth?.type === "oauth" ? auth.access : undefined
        const accountId = auth?.type === "oauth" ? auth.accountId : undefined
        return fetchKiloModels({ baseUrl: apiBase, accountId, token })
      },
    },
  }
}
