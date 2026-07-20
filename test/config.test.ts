import { describe, expect, it } from "vitest"
import {
  DEFAULT_KILO_API_URL,
  HEADER_EDITOR_NAME,
  HEADER_ORGANIZATION_ID,
  MODELS_FETCH_TIMEOUT_MS,
  PACKAGE_VERSION,
  POLL_INTERVAL_MS,
  PROVIDER_ID,
  resolveApiBase,
} from "../src/config"

describe("configuration constants", () => {
  it("exports the expected literal values", () => {
    expect(PROVIDER_ID).toBe("kilo")
    expect(DEFAULT_KILO_API_URL).toBe("https://api.kilo.ai")
    expect(POLL_INTERVAL_MS).toBe(3000)
    expect(MODELS_FETCH_TIMEOUT_MS).toBe(10000)
    expect(PACKAGE_VERSION).toBe("0.1.0")
    expect(HEADER_ORGANIZATION_ID).toBe("X-KiloCode-OrganizationId")
    expect(HEADER_EDITOR_NAME).toBe("X-KILOCODE-EDITORNAME")
  })
})

describe("resolveApiBase", () => {
  it("falls back to the literal default when the override is absent, empty, or whitespace-only", () => {
    expect(resolveApiBase(undefined)).toBe("https://api.kilo.ai")
    expect(resolveApiBase("")).toBe("https://api.kilo.ai")
    expect(resolveApiBase("   ")).toBe("https://api.kilo.ai")
  })

  it("returns a trimmed supplied override", () => {
    expect(resolveApiBase("  https://custom.kilo.internal  ")).toBe("https://custom.kilo.internal")
  })
})