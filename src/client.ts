import { readFile } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"

export interface StoredOAuthAuth {
  type: "oauth"
  access: string
  refresh: string
  expires: number
  accountId?: string
}

export interface StoredApiAuth {
  type: "api"
  key: string
}

export interface StoredWellKnownAuth {
  type: "wellknown"
  key: string
  token: string
}

export type StoredAuth = StoredOAuthAuth | StoredApiAuth | StoredWellKnownAuth | undefined

const AUTH_JSON_PATH = join(homedir(), ".local", "share", "opencode", "auth.json")

interface SdkClientWithAuthAccessor {
  auth?: {
    get?: (args: { path: { id: string } }) => Promise<{ data?: StoredAuth }>
  }
}

/**
 * Reads the currently stored credential for a provider.
 *
 * Tries a duck-typed SDK client auth accessor first, for forward
 * compatibility if a future `@opencode-ai/sdk` version adds one. As of the
 * currently pinned SDK version, no such accessor exists on the real client
 * type — this branch is a no-op today, and every call falls through to
 * reading `auth.json` directly, the same file opencode writes to for
 * plugin credentials.
 */
export async function getStoredAuth(client: unknown, providerId: string): Promise<StoredAuth> {
  const accessor = (client as SdkClientWithAuthAccessor | undefined)?.auth?.get
  if (typeof accessor === "function") {
    try {
      const result = await accessor({ path: { id: providerId } })
      if (result?.data) return result.data
    } catch {
      // Fall through to the file-based fallback below.
    }
  }

  try {
    const raw = await readFile(AUTH_JSON_PATH, "utf-8")
    const parsed = JSON.parse(raw) as Record<string, StoredAuth>
    return parsed[providerId]
  } catch {
    return undefined
  }
}
