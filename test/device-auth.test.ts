// test/device-auth.test.ts
import { describe, expect, it, vi } from "vitest"
import { initiateDeviceAuth, pollDeviceAuthOnce, waitForDeviceAuthApproval } from "../src/device-auth"

describe("initiateDeviceAuth", () => {
  it("returns the device auth init payload", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      status: 200,
      ok: true,
      json: async () => ({ code: "ABCD", verificationUrl: "https://kilo.ai/device", expiresIn: 600 }),
    })
    const result = await initiateDeviceAuth("https://api.kilo.ai", fetchImpl as unknown as typeof fetch)
    expect(result).toEqual({ code: "ABCD", verificationUrl: "https://kilo.ai/device", expiresIn: 600 })
    expect(fetchImpl).toHaveBeenCalledWith("https://api.kilo.ai/api/device-auth/codes", { method: "POST" })
  })

  it("throws a clear error on 429", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ status: 429, ok: false, json: async () => ({}) })
    await expect(
      initiateDeviceAuth("https://api.kilo.ai", fetchImpl as unknown as typeof fetch),
    ).rejects.toThrow("Too many pending authorization requests")
  })
})

describe("pollDeviceAuthOnce", () => {
  it("maps 202 to pending", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ status: 202, ok: false, json: async () => ({}) })
    expect(await pollDeviceAuthOnce("https://api.kilo.ai", "ABCD", fetchImpl as unknown as typeof fetch)).toEqual({
      status: "pending",
    })
  })

  it("maps 403 to denied", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ status: 403, ok: false, json: async () => ({}) })
    expect(await pollDeviceAuthOnce("https://api.kilo.ai", "ABCD", fetchImpl as unknown as typeof fetch)).toEqual({
      status: "denied",
    })
  })

  it("maps 410 to expired", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ status: 410, ok: false, json: async () => ({}) })
    expect(await pollDeviceAuthOnce("https://api.kilo.ai", "ABCD", fetchImpl as unknown as typeof fetch)).toEqual({
      status: "expired",
    })
  })

  it("maps a 200 approved response to the token payload", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      status: 200,
      ok: true,
      json: async () => ({ status: "approved", token: "tok_123", userEmail: "a@b.com" }),
    })
    expect(await pollDeviceAuthOnce("https://api.kilo.ai", "ABCD", fetchImpl as unknown as typeof fetch)).toEqual({
      status: "approved",
      token: "tok_123",
      userEmail: "a@b.com",
    })
  })
})

describe("waitForDeviceAuthApproval", () => {
  it("polls until approved", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce({ status: 202, ok: false, json: async () => ({}) })
      .mockResolvedValueOnce({ status: 202, ok: false, json: async () => ({}) })
      .mockResolvedValueOnce({ status: 200, ok: true, json: async () => ({ status: "approved", token: "tok_123" }) })

    const result = await waitForDeviceAuthApproval(
      "https://api.kilo.ai",
      { code: "ABCD", verificationUrl: "https://kilo.ai/device", expiresIn: 600 },
      fetchImpl as unknown as typeof fetch,
      { pollIntervalMs: 0, sleep: async () => {} },
    )

    expect(result).toEqual({ status: "approved", token: "tok_123" })
    expect(fetchImpl).toHaveBeenCalledTimes(3)
  })

  it("gives up as expired after exhausting attempts", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ status: 202, ok: false, json: async () => ({}) })

    const result = await waitForDeviceAuthApproval(
      "https://api.kilo.ai",
      { code: "ABCD", verificationUrl: "https://kilo.ai/device", expiresIn: 0.003 },
      fetchImpl as unknown as typeof fetch,
      { pollIntervalMs: 1, sleep: async () => {} },
    )

    expect(result).toEqual({ status: "expired" })
  })
})
