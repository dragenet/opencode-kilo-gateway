import { describe, expect, it, vi } from "vitest"
import { buildLoginMethod, buildSwitchOrgMethod } from "../src/auth"

describe("buildLoginMethod", () => {
  it("runs the device flow, resolves the default org, and returns a success callback", async () => {
    const fetchImpl = vi
      .fn()
      // POST /api/device-auth/codes
      .mockResolvedValueOnce({
        status: 200,
        ok: true,
        json: async () => ({ code: "ABCD", verificationUrl: "https://kilo.ai/device", expiresIn: 600 }),
      })
      // GET /api/device-auth/codes/ABCD -> approved
      .mockResolvedValueOnce({
        status: 200,
        ok: true,
        json: async () => ({ status: "approved", token: "tok_abc" }),
      })
      // GET /api/profile
      .mockResolvedValueOnce({
        status: 200,
        ok: true,
        json: async () => ({
          user: { email: "dev@example.com" },
          organizations: [{ id: "org_1", name: "Acme", role: "member" }],
          selectedOrganizationId: "org_1",
          hasPersonalAccount: true,
        }),
      })

    const method = buildLoginMethod("https://api.kilo.ai", fetchImpl as unknown as typeof fetch, {
      pollIntervalMs: 0,
      sleep: async () => {},
    })

    expect(method.type).toBe("oauth")
    expect(method.label).toBe("Login with Kilo")

    const authorization = await method.authorize()
    expect(authorization.url).toBe("https://kilo.ai/device")
    expect(authorization.method).toBe("auto")

    const result = await (authorization as { callback: () => Promise<unknown> }).callback()
    expect(result).toEqual({
      type: "success",
      provider: "kilo",
      refresh: "tok_abc",
      access: "tok_abc",
      expires: expect.any(Number),
      accountId: "org_1",
    })
  })

  it("returns a failed callback when the device code is denied", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce({
        status: 200,
        ok: true,
        json: async () => ({ code: "ABCD", verificationUrl: "https://kilo.ai/device", expiresIn: 600 }),
      })
      .mockResolvedValueOnce({ status: 403, ok: false, json: async () => ({}) })

    const method = buildLoginMethod("https://api.kilo.ai", fetchImpl as unknown as typeof fetch, {
      pollIntervalMs: 0,
      sleep: async () => {},
    })
    const authorization = await method.authorize()
    const result = await (authorization as { callback: () => Promise<unknown> }).callback()
    expect(result).toEqual({ type: "failed" })
  })
})

describe("buildSwitchOrgMethod", () => {
  it("returns undefined when there is no existing token", () => {
    const method = buildSwitchOrgMethod(
      "https://api.kilo.ai",
      [{ label: "Personal account", value: "" }],
      undefined,
      undefined,
    )
    expect(method).toBeUndefined()
  })

  it("returns undefined when there is only the personal-account option", () => {
    const method = buildSwitchOrgMethod(
      "https://api.kilo.ai",
      [{ label: "Personal account", value: "" }],
      "tok_abc",
      Date.now() + 1000,
    )
    expect(method).toBeUndefined()
  })

  it("exposes a native select prompt and reuses the existing token on authorize", async () => {
    const options = [
      { label: "Personal account", value: "" },
      { label: "Acme", value: "org_1", hint: "member" },
    ]
    const method = buildSwitchOrgMethod("https://api.kilo.ai", options, "tok_abc", 1234)
    expect(method).toBeDefined()
    expect(method?.label).toBe("Kilo · Switch organization")
    expect(method?.prompts).toEqual([
      { type: "select", key: "accountId", message: "Select organization", options },
    ])

    const authorization = await method!.authorize({ accountId: "org_1" })
    expect(authorization.method).toBe("auto")
    const result = await (authorization as { callback: () => Promise<unknown> }).callback()
    expect(result).toEqual({
      type: "success",
      provider: "kilo",
      refresh: "tok_abc",
      access: "tok_abc",
      expires: 1234,
      accountId: "org_1",
    })
  })

  it("treats the empty personal-account value as no accountId", async () => {
    const options = [
      { label: "Personal account", value: "" },
      { label: "Acme", value: "org_1", hint: "member" },
    ]
    const method = buildSwitchOrgMethod("https://api.kilo.ai", options, "tok_abc", 1234)
    const authorization = await method!.authorize({ accountId: "" })
    const result = await (authorization as { callback: () => Promise<unknown> }).callback()
    expect((result as { accountId?: string }).accountId).toBeUndefined()
  })
})
