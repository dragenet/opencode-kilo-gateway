import { describe, expect, it } from "vitest"
import { parseKiloToken } from "../src/token"

describe("parseKiloToken", () => {
  it("returns the raw value as the token when there is no embedded URL", () => {
    expect(parseKiloToken("plain-token-123")).toEqual({ token: "plain-token-123" })
  })

  it("extracts a bare host base URL and the token after the colon", () => {
    expect(parseKiloToken("https://custom.kilo.internal:abc123token")).toEqual({
      baseUrl: "https://custom.kilo.internal",
      token: "abc123token",
    })
  })

  it("extracts a base URL with a path and the token after the colon", () => {
    expect(parseKiloToken("https://custom.kilo.internal/api:abc123token")).toEqual({
      baseUrl: "https://custom.kilo.internal/api",
      token: "abc123token",
    })
  })

  it("falls back to treating the whole string as the token when there is no separator", () => {
    expect(parseKiloToken("https://custom.kilo.internal")).toEqual({
      token: "https://custom.kilo.internal",
    })
  })
})