import { resolveApiBase } from "../config"
import { fetchRawKiloModels, type KiloRawModel } from "../models"
import { fetchProfile, organizationSelectOptions, type KiloProfile } from "../profile"
import { parseKiloToken } from "../token"

export const PERSONAL = "personal"

const PROFILE_TIMEOUT_MS = 10_000

export interface OrgOption {
  value: string
  label: string
}

export interface KiloAuth {
  token: string
  apiBase: string
  embeddedBaseUrl: boolean
  orgId?: string
  orgName?: string
  source: "env" | "credential"
  credential?: { access: string; refresh: string; expires: number }
}

export interface KiloState {
  auth?: KiloAuth
  orgOptions: OrgOption[]
  models?: KiloRawModel[]
}

export interface ConnectionApi<C = unknown> {
  active(integrationID: string): Promise<C | undefined>
  resolve(connection: C): Promise<
    | {
        type: string
        access?: string
        refresh?: string
        expires?: number
        key?: string
        metadata?: Record<string, unknown>
      }
    | undefined
  >
}

export interface KiloStateDeps<C = unknown> {
  connection: ConnectionApi<C>
  env: Record<string, string | undefined>
  fetchImpl?: typeof fetch
  onChange: () => Promise<void>
}

interface ResolvedAuth {
  auth: KiloAuth
  metadataOrgName?: string
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined
}

async function resolveAuth<C>(deps: KiloStateDeps<C>): Promise<ResolvedAuth | undefined> {
  const { env } = deps
  const envKey = env.KILO_API_KEY
  if (envKey) {
    return {
      auth: {
        token: envKey,
        apiBase: resolveApiBase(env.KILO_API_URL),
        embeddedBaseUrl: false,
        orgId: env.KILO_ORG_ID || undefined,
        source: "env",
      },
    }
  }

  const active = await deps.connection.active("kilo")
  if (active === undefined || active === null) return undefined
  const resolved = await deps.connection.resolve(active)
  if (!resolved) return undefined

  if (resolved.type === "oauth" && resolved.access) {
    const parsed = parseKiloToken(resolved.access)
    const metadataOrgName = str(resolved.metadata?.orgName)
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
    }
  }

  if (resolved.type === "key" && resolved.key) {
    return {
      auth: {
        token: resolved.key,
        apiBase: resolveApiBase(env.KILO_API_URL),
        embeddedBaseUrl: false,
        source: "credential",
      },
    }
  }

  return undefined
}

function withTimeout(base: typeof fetch, ms: number): typeof fetch {
  return ((input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) =>
    base(input, { ...init, signal: AbortSignal.timeout(ms) })) as typeof fetch
}

function toOrgOptions(profile: KiloProfile): OrgOption[] {
  return organizationSelectOptions(profile).map((option) => ({
    value: option.value === "" ? PERSONAL : option.value,
    label: option.label,
  }))
}

function sameAuth(a: KiloAuth | undefined, b: KiloAuth | undefined): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

export function createKiloState<C>(deps: KiloStateDeps<C>): { state: KiloState; refresh(): Promise<void> } {
  const state: KiloState = { orgOptions: [] }
  let generation = 0

  async function run(gen: number): Promise<void> {
    const resolved = await resolveAuth(deps)
    const fetchImpl = deps.fetchImpl ?? fetch
    let auth = resolved?.auth

    // Profile and models are independent: a failure of one keeps the previous
    // value of that part of the state (undefined here = "not fetched").
    let orgOptions: OrgOption[] | undefined
    let models: KiloRawModel[] | undefined

    if (auth) {
      const { apiBase, token, orgId } = auth
      const [profileResult, modelsResult] = await Promise.allSettled([
        fetchProfile(apiBase, token, withTimeout(fetchImpl, PROFILE_TIMEOUT_MS)),
        fetchRawKiloModels({ baseUrl: apiBase, accountId: orgId, token, fetchImpl: deps.fetchImpl }),
      ])

      let profileOrgName: string | undefined
      if (profileResult.status === "fulfilled") {
        orgOptions = toOrgOptions(profileResult.value)
        profileOrgName = orgId ? profileResult.value.organizations?.find((org) => org.id === orgId)?.name : undefined
      }
      if (modelsResult.status === "fulfilled") models = modelsResult.value

      // Org name precedence: profile > stored metadata > previous name (same org).
      const previous = state.auth
      const previousName = previous && previous.orgId === orgId && previous.token === token ? previous.orgName : undefined
      const orgName = profileOrgName ?? resolved?.metadataOrgName ?? previousName
      if (orgName !== undefined) auth = { ...auth, orgName }
    } else {
      // Signed out: the public catalog is not fetched; models stay undefined.
      orgOptions = []
    }

    // Stale generations must be discarded before ANY state assignment.
    if (gen !== generation) return

    // Data must never outlive the account it was fetched for: when the token
    // changes, a failed profile fetch clears orgOptions; when the token or the
    // effective org changes, a failed models fetch clears models (undefined →
    // provider falls back to the catalog). With the same account, a failed
    // fetch keeps the previous value.
    const previous = state.auth
    const tokenChanged = previous?.token !== auth?.token
    const accountChanged = tokenChanged || previous?.orgId !== auth?.orgId
    const nextOrgOptions = orgOptions ?? (tokenChanged ? [] : state.orgOptions)
    const nextModels = models ?? (accountChanged ? undefined : state.models)

    // onChange rule: called once per non-stale, completed refresh in which
    // auth, orgOptions or models changed in content (compared by value), so
    // identical periodic refreshes and "network down, same account" refreshes
    // do not trigger reloads.
    const changed =
      !sameAuth(previous, auth) ||
      JSON.stringify(nextOrgOptions) !== JSON.stringify(state.orgOptions) ||
      JSON.stringify(nextModels) !== JSON.stringify(state.models)

    state.auth = auth
    state.orgOptions = nextOrgOptions
    state.models = nextModels

    if (changed) await deps.onChange()
  }

  async function refresh(): Promise<void> {
    const gen = ++generation
    try {
      await run(gen)
    } catch {
      // never throws: a failing connection lookup or onChange leaves state as is
    }
  }

  return { state, refresh }
}
