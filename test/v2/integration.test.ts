import { describe, expect, it } from "vitest"
import { credentialLabel, LOGIN_METHOD_ID, ORG_METHOD_ID, registerIntegration } from "../../src/v2/integration"
import { PERSONAL, type KiloAuth, type KiloState } from "../../src/v2/state"

const NOW = 1_700_000_000_000
const YEAR = 365 * 24 * 60 * 60 * 1000
const API = "https://api.kilo.ai"

type Registration = {
  integrationID: string
  method: { id: string; type: string; label: string; form?: any[] }
  authorize: (answer: Record<string, unknown>) => Promise<any>
  label: (credential: { metadata?: Record<string, unknown> }) => string
}

function fakeCtx() {
  const transforms: ((editor: any) => void)[] = []
  const ctx = {
    integration: {
      transform: async (cb: (editor: any) => void) => {
        transforms.push(cb)
        return { dispose: async () => {} }
      },
    },
  }
  return { ctx: ctx as any, transforms }
}

function runTransform(cb: (editor: any) => void) {
  const updated: Registration[] = []
  const removed: { integrationID: string; method: any }[] = []
  const editor = {
    method: {
      update: (input: Registration) => updated.push(input),
      remove: (integrationID: string, method: any) => removed.push({ integrationID, method }),
    },
  }
  cb(editor)
  return { updated, removed }
}

function auth(overrides: Partial<KiloAuth> = {}): KiloAuth {
  return {
    token: "tok",
    apiBase: API,
    embeddedBaseUrl: false,
    source: "credential",
    credential: { access: "acc", refresh: "ref", expires: 123 },
    ...overrides,
  }
}

const twoOptions = [
  { value: PERSONAL, label: "Personal account" },
  { value: "org1", label: "Acme" },
]

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })
}

const waitOptions = { sleep: async () => {}, pollIntervalMs: 1 }

async function setup(state: KiloState, fetchImpl: typeof fetch = (async () => json({}, 500)) as any, env = {}) {
  const { ctx, transforms } = fakeCtx()
  await registerIntegration(ctx, state, { fetchImpl, waitOptions, now: () => NOW, env })
  expect(transforms).toHaveLength(1)
  const { updated, removed } = runTransform(transforms[0]!)
  return { transforms, updated, removed, login: updated.find((r) => r.method.id === LOGIN_METHOD_ID)! }
}

function deviceFetch(poll: () => Response, profile?: () => Response) {
  const calls: string[] = []
  const fetchImpl = (async (input: any) => {
    const url = String(input)
    calls.push(url)
    if (url.endsWith("/api/device-auth/codes")) {
      return json({ code: "ABC", verificationUrl: "https://kilo.ai/device?code=ABC", expiresIn: 600 })
    }
    if (url.includes("/api/device-auth/codes/")) return poll()
    if (url.endsWith("/api/profile")) return profile ? profile() : json({}, 500)
    throw new Error("unexpected " + url)
  }) as typeof fetch
  return { fetchImpl, calls }
}

describe("credentialLabel", () => {
  it("uses accountID when only that is present", () => {
    expect(credentialLabel({ metadata: { accountID: "org1" } })).toBe("Kilo · org1")
  })
  it("prefers orgName", () => {
    expect(credentialLabel({ metadata: { orgName: "Acme", accountID: "org1" } })).toBe("Kilo · Acme")
  })
  it("falls back to Personal", () => {
    expect(credentialLabel({})).toBe("Kilo · Personal")
    expect(credentialLabel({ metadata: {} })).toBe("Kilo · Personal")
  })
})

describe("login method", () => {
  it("is always registered with id oauth", async () => {
    const { login, updated } = await setup({ orgOptions: [] })
    expect(updated).toHaveLength(1)
    expect(login.integrationID).toBe("kilo")
    expect(login.method).toEqual({ id: "oauth", type: "oauth", label: "Login with Kilo" })
    expect(login.label({ metadata: { orgName: "Acme" } })).toBe("Kilo · Acme")
  })

  it("device flow success yields the credential shape", async () => {
    const { fetchImpl } = deviceFetch(
      () => json({ status: "approved", token: "kilo-token" }),
      () =>
        json({
          user: { email: "a@b.c" },
          organizations: [{ id: "org1", name: "Acme", role: "member" }],
          selectedOrganizationId: "org1",
        }),
    )
    const { login } = await setup({ orgOptions: [] }, fetchImpl)
    const authz = await login.authorize({})
    expect(authz.url).toBe("https://kilo.ai/device?code=ABC")
    expect(authz.instructions).toBe("Approve this device in your browser. Code: ABC")
    expect(authz.expiresAt).toBe(NOW + 600_000)
    expect(authz.mode).toBe("auto")
    await expect(authz.callback).resolves.toEqual({
      type: "oauth",
      methodID: "oauth",
      access: "kilo-token",
      refresh: "kilo-token",
      expires: NOW + YEAR,
      metadata: { accountID: "org1", orgName: "Acme" },
    })
  })

  it("uses KILO_API_URL for the api base", async () => {
    const urls: string[] = []
    const fetchImpl = (async (input: any) => {
      urls.push(String(input))
      return json({}, 500)
    }) as typeof fetch
    const { login } = await setup({ orgOptions: [] }, fetchImpl, { KILO_API_URL: "https://self.example" })
    const authz = await login.authorize({})
    await authz.callback.catch(() => {})
    expect(urls[0]).toBe("https://self.example/api/device-auth/codes")
    expect(authz.url).toBe("https://self.example")
  })

  it("429 resolves authorize and rejects the callback with the message", async () => {
    const fetchImpl = (async () => json({}, 429)) as unknown as typeof fetch
    const { login } = await setup({ orgOptions: [] }, fetchImpl)
    const authz = await login.authorize({})
    expect(authz.mode).toBe("auto")
    expect(authz.url).toBe(API)
    expect(authz.instructions).toBe("Too many pending authorization requests. Please wait and try again.")
    await expect(authz.callback).rejects.toThrow("Too many pending authorization requests. Please wait and try again.")
  })

  it("network failure also resolves authorize", async () => {
    const fetchImpl = (async () => {
      throw new Error("offline")
    }) as unknown as typeof fetch
    const { login } = await setup({ orgOptions: [] }, fetchImpl)
    const authz = await login.authorize({})
    expect(authz.instructions).toBe("offline")
    await expect(authz.callback).rejects.toThrow("offline")
  })

  it("denied rejects with the exact message", async () => {
    const { fetchImpl } = deviceFetch(() => json({}, 403))
    const { login } = await setup({ orgOptions: [] }, fetchImpl)
    const authz = await login.authorize({})
    await expect(authz.callback).rejects.toThrow("Kilo login was denied")
  })

  it("expired rejects with the exact message", async () => {
    const { fetchImpl } = deviceFetch(() => json({}, 410))
    const { login } = await setup({ orgOptions: [] }, fetchImpl)
    const authz = await login.authorize({})
    await expect(authz.callback).rejects.toThrow("Kilo device code expired — try again")
  })

  it("profile failure after approval yields a credential without metadata", async () => {
    const { fetchImpl } = deviceFetch(() => json({ status: "approved", token: "t" }))
    const { login } = await setup({ orgOptions: [] }, fetchImpl)
    const authz = await login.authorize({})
    const credential = await authz.callback
    expect(credential).toEqual({ type: "oauth", methodID: "oauth", access: "t", refresh: "t", expires: NOW + YEAR })
    expect(credential.metadata).toBeUndefined()
  })
})

describe("organization method", () => {
  it("is absent (and removed) for env auth", async () => {
    const { updated, removed } = await setup({ auth: auth({ source: "env", credential: undefined }), orgOptions: twoOptions })
    expect(updated.map((r) => r.method.id)).toEqual(["oauth"])
    expect(removed).toHaveLength(1)
    expect(removed[0]!.integrationID).toBe("kilo")
    expect(removed[0]!.method).toMatchObject({ id: "organization", type: "oauth" })
  })

  it("is absent with fewer than 2 options", async () => {
    const { updated, removed } = await setup({ auth: auth(), orgOptions: [twoOptions[0]!] })
    expect(updated.map((r) => r.method.id)).toEqual(["oauth"])
    expect(removed).toHaveLength(1)
  })

  it("is absent without auth", async () => {
    const { updated, removed } = await setup({ orgOptions: twoOptions })
    expect(updated.map((r) => r.method.id)).toEqual(["oauth"])
    expect(removed).toHaveLength(1)
  })

  it("is present with 2+ options and a credential, default = current org", async () => {
    const { updated, removed } = await setup({ auth: auth({ orgId: "org1" }), orgOptions: twoOptions })
    expect(removed).toHaveLength(0)
    const org = updated.find((r) => r.method.id === ORG_METHOD_ID)!
    expect(org.method).toEqual({
      id: "organization",
      type: "oauth",
      label: "Kilo · Add organization",
      form: [
        {
          type: "string",
          key: "organization",
          title: "Organization",
          required: true,
          options: twoOptions,
          default: "org1",
        },
      ],
    })
    expect(org.label({ metadata: { accountID: "org1" } })).toBe("Kilo · org1")
  })

  it("defaults the form to personal without orgId", async () => {
    const { updated } = await setup({ auth: auth(), orgOptions: twoOptions })
    const org = updated.find((r) => r.method.id === ORG_METHOD_ID)!
    expect(org.method.form![0].default).toBe("personal")
  })

  it("personal selection yields no accountID", async () => {
    const { updated } = await setup({ auth: auth({ orgId: "org1" }), orgOptions: twoOptions })
    const org = updated.find((r) => r.method.id === ORG_METHOD_ID)!
    const authz = await org.authorize({ organization: PERSONAL })
    expect(authz).toMatchObject({ url: API, instructions: "Adding Kilo organization…", mode: "auto" })
    const credential = await authz.callback
    expect(credential.metadata).toEqual({ orgName: "Personal" })
    expect("accountID" in credential.metadata).toBe(false)
  })

  it("org selection yields accountID and orgName and reuses the stored credential", async () => {
    const { updated } = await setup({ auth: auth(), orgOptions: twoOptions })
    const org = updated.find((r) => r.method.id === ORG_METHOD_ID)!
    const authz = await org.authorize({ organization: "org1" })
    await expect(authz.callback).resolves.toEqual({
      type: "oauth",
      methodID: "organization",
      access: "acc",
      refresh: "ref",
      expires: 123,
      metadata: { accountID: "org1", orgName: "Acme" },
    })
  })

  it("reads state at authorize time (state mutated after registration)", async () => {
    const state: KiloState = { auth: auth(), orgOptions: twoOptions }
    const { updated } = await setup(state)
    const org = updated.find((r) => r.method.id === ORG_METHOD_ID)!
    state.auth = auth({ credential: { access: "acc2", refresh: "ref2", expires: 456 } })
    const credential = await (await org.authorize({ organization: "org1" })).callback
    expect(credential).toMatchObject({ access: "acc2", refresh: "ref2", expires: 456 })
  })

  it("rejects the callback when there is no stored credential", async () => {
    const state: KiloState = { auth: auth(), orgOptions: twoOptions }
    const { updated } = await setup(state)
    const org = updated.find((r) => r.method.id === ORG_METHOD_ID)!
    state.auth = undefined
    const authz = await org.authorize({ organization: "org1" })
    await expect(authz.callback).rejects.toThrow("Log in with ‘Login with Kilo’ first")
  })
})

describe("transform callback", () => {
  it("is pure: repeated runs give identical registrations and no fetch", async () => {
    let fetches = 0
    const fetchImpl = (async () => {
      fetches++
      return json({}, 500)
    }) as unknown as typeof fetch
    const { transforms } = await setup({ auth: auth({ orgId: "org1" }), orgOptions: twoOptions }, fetchImpl)
    const strip = (r: { updated: Registration[]; removed: unknown[] }) => ({
      methods: r.updated.map((u) => u.method),
      removed: r.removed,
    })
    const first = strip(runTransform(transforms[0]!))
    const second = strip(runTransform(transforms[0]!))
    expect(second).toEqual(first)
    expect(fetches).toBe(0)
  })
})
