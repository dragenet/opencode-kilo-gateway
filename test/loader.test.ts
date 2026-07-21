// test/loader.test.ts
import { describe, expect, it } from "vitest"
import { buildLoaderResult, createLoader } from "../src/loader"

describe("buildLoaderResult", () => {
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

  it("scopes the base URL to the organization endpoint when accountId is set", () => {
    const result = buildLoaderResult(
      { type: "oauth", access: "tok_abc", refresh: "tok_abc", expires: 1, accountId: "org_1" },
      "0.1.0",
    )
    expect(result.baseURL).toBe("https://api.kilo.ai/api/organizations/org_1")
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
})

describe("createLoader", () => {
  it("wraps buildLoaderResult around an async getAuth", async () => {
    const loader = createLoader("0.1.0")
    const result = await loader(async () => ({ type: "oauth", access: "tok_abc", refresh: "tok_abc", expires: 1 }))
    expect(result.baseURL).toBe("https://api.kilo.ai/api/openrouter")
  })
})
