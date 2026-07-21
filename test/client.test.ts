import { describe, expect, it, vi, afterEach } from "vitest"

vi.mock("node:fs/promises", () => ({
  readFile: vi.fn(),
}))

import { readFile } from "node:fs/promises"
import { getStoredAuth } from "../src/client"

afterEach(() => {
  vi.clearAllMocks()
})

describe("getStoredAuth", () => {
  it("uses the SDK client accessor when available", async () => {
    const client = {
      auth: {
        get: vi.fn().mockResolvedValue({ data: { type: "oauth", access: "tok", refresh: "tok", expires: 1, accountId: "org_1" } }),
      },
    }

    const result = await getStoredAuth(client, "kilo")

    expect(result).toEqual({ type: "oauth", access: "tok", refresh: "tok", expires: 1, accountId: "org_1" })
    expect(client.auth.get).toHaveBeenCalledWith({ path: { id: "kilo" } })
    expect(readFile).not.toHaveBeenCalled()
  })

  it("falls back to reading auth.json when the client has no accessor", async () => {
    vi.mocked(readFile).mockResolvedValue(
      JSON.stringify({ kilo: { type: "oauth", access: "tok", refresh: "tok", expires: 1 } }),
    )

    const result = await getStoredAuth({}, "kilo")

    expect(result).toEqual({ type: "oauth", access: "tok", refresh: "tok", expires: 1 })
  })

  it("falls back to reading auth.json when the SDK accessor throws", async () => {
    const client = { auth: { get: vi.fn().mockRejectedValue(new Error("not found")) } }
    vi.mocked(readFile).mockResolvedValue(JSON.stringify({ kilo: { type: "oauth", access: "tok", refresh: "tok", expires: 1 } }))

    const result = await getStoredAuth(client, "kilo")

    expect(result).toEqual({ type: "oauth", access: "tok", refresh: "tok", expires: 1 })
  })

  it("returns undefined when neither source has a credential", async () => {
    vi.mocked(readFile).mockRejectedValue(new Error("ENOENT"))
    const result = await getStoredAuth({}, "kilo")
    expect(result).toBeUndefined()
  })
})
