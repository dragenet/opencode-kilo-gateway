import { describe, expect, it } from "vitest"
import { buildKiloHeaders } from "../src/headers"

describe("buildKiloHeaders", () => {
  it("includes the base attribution and content-type headers", () => {
    const headers = buildKiloHeaders({ version: "0.1.0" })
    expect(headers["Content-Type"]).toBe("application/json")
    expect(headers["HTTP-Referer"]).toBe("https://kilo.ai/")
    expect(headers["X-Title"]).toBe("Kilo Code")
    expect(headers["User-Agent"]).toBe("opencode-kilo-gateway/0.1.0")
    expect(headers["X-KILOCODE-EDITORNAME"]).toBe("opencode-kilo-gateway/0.1.0")
  })

  it("omits the organization header when no accountId is given", () => {
    const headers = buildKiloHeaders({ version: "0.1.0" })
    expect(headers["X-KiloCode-OrganizationId"]).toBeUndefined()
  })

  it("includes the organization header when an accountId is given", () => {
    const headers = buildKiloHeaders({ version: "0.1.0", accountId: "org_123" })
    expect(headers["X-KiloCode-OrganizationId"]).toBe("org_123")
  })
})