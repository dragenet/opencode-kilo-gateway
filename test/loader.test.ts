// test/loader.test.ts
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { buildLoaderResult, createLoader } from "../src/loader"

describe("buildLoaderResult", () => {
  beforeEach(() => {
    delete process.env.KILO_API_KEY
    delete process.env.KILO_ORG_ID
  })
  afterEach(() => {
    delete process.env.KILO_API_KEY
    delete process.env.KILO_ORG_ID
  })

  it("returns an empty object when there is no oauth credential", () => {
    expect(buildLoaderResult(undefined, "0.1.0")).toEqual({})
    expect(buildLoaderResult({ type: "api", key: "k" }, "0.1.0")).toEqual({})
  })

  it("scopes the base URL to the public endpoint when there is no accountId", () => {
    const result = buildLoaderResult({ type: "oauth", access: "tok_abc", refresh: "tok_abc", expires: 1 }, "0.1.0")
    expect(result).toEqual({
      baseURL: "https://api.kilo.ai/api/openrouter",
      apiKey: "tok_abc",
      headers: expect.objectContaining({ "User-Agent": "opencode-kilo-gateway/0.1.0" }),
    })
  })

  it("uses the public endpoint as the chat base when accountId is set, scoping via header instead", () => {
    const result = buildLoaderResult(
      { type: "oauth", access: "tok_abc", refresh: "tok_abc", expires: 1, accountId: "org_1" },
      "0.1.0",
    )
    expect(result.baseURL).toBe("https://api.kilo.ai/api/openrouter")
    expect(result.headers?.["X-KiloCode-OrganizationId"]).toBe("org_1")
  })

  it("honors an embedded base URL in the token over the env override", () => {
    const result = buildLoaderResult(
      { type: "oauth", access: "https://custom.kilo.internal:tok_abc", refresh: "tok_abc", expires: 1 },
      "0.1.0",
      "https://env-override.example.com",
    )
    expect(result.baseURL).toBe("https://custom.kilo.internal/api/openrouter")
    expect(result.apiKey).toBe("tok_abc")
  })

  it("honors the env override when there is no embedded URL", () => {
    const result = buildLoaderResult(
      { type: "oauth", access: "tok_abc", refresh: "tok_abc", expires: 1 },
      "0.1.0",
      "https://env-override.example.com",
    )
    expect(result.baseURL).toBe("https://env-override.example.com/api/openrouter")
  })

  it("uses KILO_API_KEY env var as bearer token, bypassing stored auth entirely", () => {
    const result = buildLoaderResult(undefined, "0.1.0", undefined, "env_key_abc")
    expect(result).toEqual({
      baseURL: "https://api.kilo.ai/api/openrouter",
      apiKey: "env_key_abc",
      headers: expect.objectContaining({ "User-Agent": "opencode-kilo-gateway/0.1.0" }),
    })
    expect(result.headers?.["X-KiloCode-OrganizationId"]).toBeUndefined()
  })

  it("uses KILO_API_KEY + KILO_ORG_ID together, bypassing stored auth", () => {
    const result = buildLoaderResult(undefined, "0.1.0", undefined, "env_key_abc", "org_env")
    expect(result.apiKey).toBe("env_key_abc")
    expect(result.headers?.["X-KiloCode-OrganizationId"]).toBe("org_env")
  })

  it("prefers KILO_ORG_ID over stored accountId when both are present", () => {
    const result = buildLoaderResult(
      { type: "oauth", access: "tok_abc", refresh: "tok_abc", expires: 1, accountId: "org_stored" },
      "0.1.0",
      undefined,
      undefined,
      "org_env",
    )
    expect(result.apiKey).toBe("tok_abc")
    expect(result.headers?.["X-KiloCode-OrganizationId"]).toBe("org_env")
  })

  it("treats an empty-string KILO_API_KEY as unset, falling through to stored OAuth", () => {
    const result = buildLoaderResult(
      { type: "oauth", access: "tok_stored", refresh: "tok_stored", expires: 1 },
      "0.1.0",
      undefined,
      "",
    )
    expect(result.apiKey).toBe("tok_stored")
  })
})

describe("createLoader", () => {
  it("wraps buildLoaderResult around an async getAuth", async () => {
    const loader = createLoader("0.1.0")
    const result = await loader(async () => ({ type: "oauth", access: "tok_abc", refresh: "tok_abc", expires: 1 }))
    expect(result.baseURL).toBe("https://api.kilo.ai/api/openrouter")
  })
})
