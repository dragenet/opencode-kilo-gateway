import { describe, expect, it } from "vitest"
import type { KiloRawModel } from "../../src/models"
import { registerProvider, toV2Model } from "../../src/v2/provider"
import type { KiloAuth, KiloState } from "../../src/v2/state"

const rawModel: KiloRawModel = {
  id: "z-ai/glm-5.1",
  name: "GLM 5.1",
  context_length: 160_000,
  max_completion_tokens: 8_000,
  pricing: {
    prompt: "0.000002",
    completion: "0.000010",
    input_cache_read: "0.0000005",
    input_cache_write: "0.000003",
  },
  architecture: { input_modalities: ["text", "image"], output_modalities: ["text"] },
  supported_parameters: ["tools"],
}

type Callback = (e: any) => void

function fakeCtx() {
  const transforms: Callback[] = []
  const hooks: { name: string; cb: Callback; options?: unknown }[] = []
  const ctx = {
    provider: {
      transform: async (cb: Callback) => {
        transforms.push(cb)
        return { dispose: async () => {} }
      },
    },
    session: {
      hook: async (name: string, cb: Callback, options?: unknown) => {
        hooks.push({ name, cb, options })
        return { dispose: async () => {} }
      },
    },
  }
  return { ctx: ctx as any, transforms, hooks }
}

function runTransform(cb: Callback) {
  const provider = { settings: { keep: 1 } as Record<string, unknown>, headers: { "X-Existing": "1" } as Record<string, string> }
  const updates: string[] = []
  const sets: { providerID: string; models: any[] }[] = []
  const editor = {
    update: (id: string, fn: (p: typeof provider) => void) => {
      updates.push(id)
      fn(provider)
    },
    models: {
      set: (providerID: string, models: any[]) => {
        sets.push({ providerID, models })
      },
    },
  }
  cb(editor)
  return { provider, updates, sets }
}

const credentialAuth = (patch: Partial<KiloAuth> = {}): KiloAuth => ({
  token: "tok",
  apiBase: "https://api.kilo.ai",
  embeddedBaseUrl: false,
  source: "credential",
  ...patch,
})

async function setup(state: KiloState) {
  const fake = fakeCtx()
  await registerProvider(fake.ctx, state)
  const hook = (name: string) => fake.hooks.find((h) => h.name === name)!
  return { ...fake, hook }
}

describe("toV2Model", () => {
  it("maps pricing per million and limits", () => {
    const model = toV2Model(rawModel)
    expect(model).toMatchObject({
      id: "z-ai/glm-5.1",
      modelID: "z-ai/glm-5.1",
      providerID: "kilo",
      name: "GLM 5.1",
      capabilities: { tools: true, input: ["text", "image"], output: ["text"] },
      limit: { context: 160_000, output: 8_000 },
      status: "active",
      enabled: true,
      variants: [],
      time: { released: 0 },
    })
    expect(model.cost).toHaveLength(1)
    expect(model.cost[0].input).toBeCloseTo(2)
    expect(model.cost[0].output).toBeCloseTo(10)
    expect(model.cost[0].cache.read).toBeCloseTo(0.5)
    expect(model.cost[0].cache.write).toBeCloseTo(3)
  })

  it("falls back to top_provider then context length for output limit", () => {
    const withTop = toV2Model({ ...rawModel, max_completion_tokens: null, top_provider: { max_completion_tokens: 4_000 } })
    expect(withTop.limit.output).toBe(4_000)
    const none = toV2Model({ ...rawModel, max_completion_tokens: undefined })
    expect(none.limit).toEqual({ context: 160_000, output: 160_000 })
  })

  it('maps Kilo "file" modality to pdf and de-duplicates', () => {
    const model = toV2Model({
      ...rawModel,
      architecture: { input_modalities: ["text", "image", "file"], output_modalities: ["text", "file", "pdf"] },
    })
    expect(model.capabilities.input).toEqual(["text", "image", "pdf"])
    expect(model.capabilities.output).toEqual(["text", "pdf"])
  })

  it("defaults modalities to text when empty and name to id", () => {
    const model = toV2Model({
      ...rawModel,
      name: undefined as unknown as string,
      architecture: { input_modalities: [], output_modalities: [] },
    })
    expect(model.name).toBe("z-ai/glm-5.1")
    expect(model.capabilities.input).toEqual(["text"])
    expect(model.capabilities.output).toEqual(["text"])
  })
})

describe("provider.transform", () => {
  it("baseURL default", async () => {
    const { transforms } = await setup({ orgOptions: [] })
    const { provider, updates } = runTransform(transforms[0])
    expect(updates).toEqual(["kilo"])
    expect(provider.settings.baseURL).toBe("https://api.kilo.ai/api/openrouter")
    expect(provider.settings.keep).toBe(1)
    expect(provider.headers["X-Existing"]).toBe("1")
  })

  it("sets baseURL and headers on a provider without settings/headers", async () => {
    const { transforms } = await setup({ orgOptions: [] })
    const provider: Record<string, any> = {}
    transforms[0]({
      update: (_id: string, fn: (p: Record<string, any>) => void) => fn(provider),
      models: { set: () => {} },
    })
    expect(provider.settings.baseURL).toBe("https://api.kilo.ai/api/openrouter")
    expect(provider.headers["X-Title"]).toBe("Kilo Code")
  })

  it("baseURL embedded", async () => {
    const state: KiloState = {
      orgOptions: [],
      auth: credentialAuth({ apiBase: "https://gw.example", embeddedBaseUrl: true }),
    }
    const { transforms } = await setup(state)
    expect(runTransform(transforms[0]).provider.settings.baseURL).toBe("https://gw.example/api/openrouter")
  })

  it("baseURL from KILO_API_URL via state.auth.apiBase", async () => {
    const state: KiloState = { orgOptions: [], auth: credentialAuth({ apiBase: "https://self.hosted", source: "env" }) }
    const { transforms } = await setup(state)
    expect(runTransform(transforms[0]).provider.settings.baseURL).toBe("https://self.hosted/api/openrouter")
  })

  it("reads state at call time", async () => {
    const state: KiloState = { orgOptions: [] }
    const { transforms } = await setup(state)
    state.auth = credentialAuth({ apiBase: "https://later.example" })
    expect(runTransform(transforms[0]).provider.settings.baseURL).toBe("https://later.example/api/openrouter")
  })

  it("attribution headers set, no org header in provider headers", async () => {
    const state: KiloState = { orgOptions: [], auth: credentialAuth({ orgId: "org-1", orgName: "Org" }) }
    const { transforms } = await setup(state)
    const { provider } = runTransform(transforms[0])
    expect(provider.headers["X-KILOCODE-EDITORNAME"]).toBe("opencode-kilo-gateway/0.1.0")
    expect(provider.headers["User-Agent"]).toBe("opencode-kilo-gateway/0.1.0")
    expect(provider.headers["HTTP-Referer"]).toBe("https://kilo.ai/")
    expect(provider.headers["X-Title"]).toBe("Kilo Code")
    expect(provider.headers["X-Existing"]).toBe("1")
    expect(provider.headers["X-KiloCode-OrganizationId"]).toBeUndefined()
  })

  it("models.set only when state.models defined", async () => {
    const state: KiloState = { orgOptions: [] }
    const { transforms } = await setup(state)
    expect(runTransform(transforms[0]).sets).toEqual([])

    state.models = [rawModel]
    const { sets } = runTransform(transforms[0])
    expect(sets).toHaveLength(1)
    expect(sets[0].providerID).toBe("kilo")
    expect(sets[0].models.map((m) => m.id)).toEqual(["z-ai/glm-5.1"])

    state.models = []
    const empty = runTransform(transforms[0])
    expect(empty.sets).toEqual([{ providerID: "kilo", models: [] }])
  })

  it("replaying the transform twice yields the same result", async () => {
    const state: KiloState = { orgOptions: [], auth: credentialAuth(), models: [rawModel] }
    const { transforms } = await setup(state)
    const first = runTransform(transforms[0])
    const second = runTransform(transforms[0])
    expect(second).toEqual(first)
  })
})

describe("model.request hook", () => {
  const request = () => ({ headers: {} as Record<string, string> })

  it("adds org header", async () => {
    const { hook } = await setup({ orgOptions: [], auth: credentialAuth({ orgId: "org-1" }) })
    const e = request()
    hook("model.request").cb(e)
    expect(e.headers["X-KiloCode-OrganizationId"]).toBe("org-1")
  })

  it("no header for personal", async () => {
    const { hook } = await setup({ orgOptions: [], auth: credentialAuth() })
    const e = request()
    hook("model.request").cb(e)
    expect(e.headers).toEqual({})
  })

  it("no header without auth", async () => {
    const { hook } = await setup({ orgOptions: [] })
    const e = request()
    hook("model.request").cb(e)
    expect(e.headers).toEqual({})
  })

  it("env org", async () => {
    const { hook } = await setup({ orgOptions: [], auth: credentialAuth({ source: "env", orgId: "o" }) })
    const e = request()
    hook("model.request").cb(e)
    expect(e.headers["X-KiloCode-OrganizationId"]).toBe("o")
  })

  it("reads state at call time", async () => {
    const state: KiloState = { orgOptions: [] }
    const { hook } = await setup(state)
    state.auth = credentialAuth({ orgId: "late" })
    const e = request()
    hook("model.request").cb(e)
    expect(e.headers["X-KiloCode-OrganizationId"]).toBe("late")
  })
})

describe("http.request hook", () => {
  const make = () => ({
    request: new Request("https://gw.example/api/openrouter/chat/completions", {
      method: "POST",
      headers: { authorization: "Bearer prefixed-token" },
    }),
  })

  it("rewrites Authorization only for embedded URL tokens", async () => {
    const { hook } = await setup({
      orgOptions: [],
      auth: credentialAuth({ token: "plain-token", embeddedBaseUrl: true, apiBase: "https://gw.example" }),
    })
    const e = make()
    hook("http.request").cb(e)
    expect(e.request.headers.get("authorization")).toBe("Bearer plain-token")
  })

  it("leaves Authorization alone for non-embedded tokens", async () => {
    const { hook } = await setup({ orgOptions: [], auth: credentialAuth({ token: "plain-token" }) })
    const e = make()
    hook("http.request").cb(e)
    expect(e.request.headers.get("authorization")).toBe("Bearer prefixed-token")
  })

  it("leaves Authorization alone without auth", async () => {
    const { hook } = await setup({ orgOptions: [] })
    const e = make()
    hook("http.request").cb(e)
    expect(e.request.headers.get("authorization")).toBe("Bearer prefixed-token")
  })
})

describe("registration", () => {
  it("hooks registered with { providerID: 'kilo' }", async () => {
    const { hooks, transforms } = await setup({ orgOptions: [] })
    expect(transforms).toHaveLength(1)
    expect(hooks.map((h) => h.name).sort()).toEqual(["http.request", "model.request"])
    for (const h of hooks) expect(h.options).toEqual({ providerID: "kilo" })
  })
})
