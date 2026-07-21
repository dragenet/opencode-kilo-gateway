import { initiateDeviceAuth, waitForDeviceAuthApproval, type WaitForDeviceAuthOptions } from "./device-auth"
import { defaultOrganizationId, fetchProfile, type SelectOption } from "./profile"

const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000

interface AuthorizeSuccess {
  type: "success"
  provider: "kilo"
  refresh: string
  access: string
  expires: number
  accountId?: string
}

interface AuthorizeFailed {
  type: "failed"
}

type CallbackResult = AuthorizeSuccess | AuthorizeFailed

interface OAuthAuthorization {
  url: string
  instructions: string
  method: "auto"
  callback(): Promise<CallbackResult>
}

export interface OAuthMethod {
  type: "oauth"
  label: string
  prompts?: Array<{ type: "select"; key: string; message: string; options: SelectOption[] }>
  authorize(inputs?: Record<string, string>): Promise<OAuthAuthorization>
}

/**
 * Builds the primary "Login with Kilo" auth method: runs the device
 * authorization grant, then resolves and stores the default organization
 * from the user's profile.
 */
export function buildLoginMethod(
  apiBase: string,
  fetchImpl: typeof fetch = fetch,
  waitOptions: WaitForDeviceAuthOptions = {},
): OAuthMethod {
  return {
    type: "oauth",
    label: "Login with Kilo",
    async authorize() {
      const init = await initiateDeviceAuth(apiBase, fetchImpl)
      return {
        url: init.verificationUrl,
        instructions: `Approve this device in your browser. Code: ${init.code}`,
        method: "auto",
        async callback(): Promise<CallbackResult> {
          const poll = await waitForDeviceAuthApproval(apiBase, init, fetchImpl, waitOptions)
          if (poll.status !== "approved" || !poll.token) {
            return { type: "failed" }
          }

          let accountId: string | undefined
          try {
            const profile = await fetchProfile(apiBase, poll.token, fetchImpl)
            accountId = defaultOrganizationId(profile)
          } catch {
            accountId = undefined
          }

          return {
            type: "success",
            provider: "kilo",
            refresh: poll.token,
            access: poll.token,
            expires: Date.now() + ONE_YEAR_MS,
            ...(accountId ? { accountId } : {}),
          }
        },
      }
    },
  }
}

/**
 * Builds the "Switch organization" auth method: a native `select` prompt
 * (populated at plugin-load time with the user's organizations) that, on
 * selection, reuses the existing token — no browser flow — and persists
 * the newly chosen `accountId`.
 *
 * Returns `undefined` when there is no existing token to reuse, or when
 * there is nothing to choose between (personal account only).
 */
export function buildSwitchOrgMethod(
  apiBase: string,
  options: SelectOption[],
  existingToken: string | undefined,
  existingExpires: number | undefined,
): OAuthMethod | undefined {
  if (!existingToken || options.length <= 1) return undefined

  return {
    type: "oauth",
    label: "Kilo · Switch organization",
    prompts: [{ type: "select", key: "accountId", message: "Select organization", options }],
    async authorize(inputs: Record<string, string> = {}) {
      const chosenAccountId = inputs.accountId || undefined
      return {
        url: apiBase,
        instructions: "Switching Kilo organization...",
        method: "auto",
        async callback(): Promise<CallbackResult> {
          return {
            type: "success",
            provider: "kilo",
            refresh: existingToken,
            access: existingToken,
            expires: existingExpires ?? Date.now() + ONE_YEAR_MS,
            ...(chosenAccountId ? { accountId: chosenAccountId } : {}),
          }
        },
      }
    },
  }
}
