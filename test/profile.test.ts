// test/profile.test.ts
import { describe, expect, it, vi } from "vitest"
import { defaultOrganizationId, fetchProfile, organizationSelectOptions, type KiloProfile } from "../src/profile"

describe("fetchProfile", () => {
  it("maps the raw profile response and sends a bearer token", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      status: 200,
      ok: true,
      json: async () => ({
        user: { email: "dev@example.com", name: "Dev" },
        organizations: [{ id: "org_1", name: "Acme", role: "member" }],
        selectedOrganizationId: "org_1",
        hasPersonalAccount: true,
      }),
    })

    const profile = await fetchProfile("https://api.kilo.ai", "tok_abc", fetchImpl as unknown as typeof fetch)

    expect(profile).toEqual({
      email: "dev@example.com",
      name: "Dev",
      organizations: [{ id: "org_1", name: "Acme", role: "member" }],
      selectedOrganizationId: "org_1",
      hasPersonalAccount: true,
    })
    expect(fetchImpl).toHaveBeenCalledWith("https://api.kilo.ai/api/profile", {
      headers: { Authorization: "Bearer tok_abc", "Content-Type": "application/json" },
    })
  })

  it("throws a clear error on 401", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ status: 401, ok: false, json: async () => ({}) })
    await expect(
      fetchProfile("https://api.kilo.ai", "bad-token", fetchImpl as unknown as typeof fetch),
    ).rejects.toThrow("Invalid or expired Kilo token")
  })
})

describe("defaultOrganizationId", () => {
  it("prefers selectedOrganizationId when it is a known organization", () => {
    const profile: KiloProfile = {
      email: "a@b.com",
      organizations: [{ id: "org_1", name: "Acme", role: "member" }],
      selectedOrganizationId: "org_1",
      hasPersonalAccount: true,
    }
    expect(defaultOrganizationId(profile)).toBe("org_1")
  })

  it("falls back to the first organization when there is no personal account", () => {
    const profile: KiloProfile = {
      email: "a@b.com",
      organizations: [{ id: "org_1", name: "Acme", role: "member" }],
      hasPersonalAccount: false,
    }
    expect(defaultOrganizationId(profile)).toBe("org_1")
  })

  it("returns undefined (personal account) when there is no usable organization", () => {
    const profile: KiloProfile = { email: "a@b.com", organizations: [], hasPersonalAccount: true }
    expect(defaultOrganizationId(profile)).toBeUndefined()
  })
})

describe("organizationSelectOptions", () => {
  it("includes a personal-account option plus one entry per organization", () => {
    const profile: KiloProfile = {
      email: "a@b.com",
      organizations: [
        { id: "org_1", name: "Acme", role: "admin" },
        { id: "org_2", name: "Widgets Inc", role: "member" },
      ],
    }
    expect(organizationSelectOptions(profile)).toEqual([
      { label: "Personal account", value: "" },
      { label: "Acme", value: "org_1", hint: "admin" },
      { label: "Widgets Inc", value: "org_2", hint: "member" },
    ])
  })
})