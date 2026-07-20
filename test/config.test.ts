import { describe, expect, it } from "vitest"
import { DEFAULT_KILO_API_URL, resolveApiBase } from "../src/config"

describe("resolveApiBase", () => {
  it("falls back when the override is absent, empty, or whitespace-only", () => {
    expect(resolveApiBase(undefined)).toBe(DEFAULT_KILO_API_URL)
    expect(resolveApiBase("")).toBe(DEFAULT_KILO_API_URL)
    expect(resolveApiBase("   ")).toBe(DEFAULT_KILO_API_URL)
  })

  it("returns a trimmed supplied override", () => {
    expect(resolveApiBase("  https://custom.kilo.internal  ")).toBe("https://custom.kilo.internal")
  })
})