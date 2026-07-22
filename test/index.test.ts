import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../src/client", () => ({ getStoredAuth: vi.fn() }))
vi.mock("../src/profile", async () => {
  const actual = await vi.importActual<typeof import("../src/profile")>("../src/profile")
  return { ...actual, fetchProfile: vi.fn() }
})
vi.mock("../src/models", async () => {
  const actual = await vi.importActual<typeof import("../src/models")>("../src/models")
  return { ...actual, fetchKiloModels: vi.fn() }
})

import { getStoredAuth } from "../src/client"
import { fetchProfile } from "../src/profile"
import { fetchKiloModels } from "../src/models"
import { KiloGateway } from "../src/index"

describe("KiloGateway", () => {
  beforeEach(() => {
    delete process.env.KILO_API_KEY
    delete process.env.KILO_ORG_ID
  })
  afterEach(() => {
    delete process.env.KILO_API_KEY
    delete process.env.KILO_ORG_ID
  })

  it("registers only the login method when there is no stored credential", async () => {
    vi.mocked(getStoredAuth).mockResolvedValue(undefined)

    const hooks = await KiloGateway({ client: {} } as never)

    expect(hooks.auth?.provider).toBe("kilo")
    expect(hooks.auth?.methods).toHaveLength(1)
    expect(hooks.auth?.methods[0]?.label).toBe("Login with Kilo")
    expect(hooks.provider?.id).toBe("kilo")
    expect(fetchProfile).not.toHaveBeenCalled()
  })

  it("adds the switch-organization method when a token with multiple orgs is stored", async () => {
    vi.mocked(getStoredAuth).mockResolvedValue({
      type: "oauth",
      access: "tok_abc",
      refresh: "tok_abc",
      expires: 999,
    })
    vi.mocked(fetchProfile).mockResolvedValue({
      email: "dev@example.com",
      organizations: [{ id: "org_1", name: "Acme", role: "member" }],
    })

    const hooks = await KiloGateway({ client: {} } as never)

    expect(hooks.auth?.methods).toHaveLength(2)
    expect(hooks.auth?.methods[1]?.label).toBe("Kilo · Switch organization")
  })

  it("delegates models() to fetchKiloModels with the auth's token and accountId", async () => {
    vi.mocked(getStoredAuth).mockResolvedValue(undefined)
    vi.mocked(fetchKiloModels).mockResolvedValue({})

    const hooks = await KiloGateway({ client: {} } as never)
    await hooks.provider?.models?.({} as never, {
      auth: { type: "oauth", access: "tok_xyz", refresh: "tok_xyz", expires: 1, accountId: "org_2" },
    } as never)

    expect(fetchKiloModels).toHaveBeenCalledWith(
      expect.objectContaining({ token: "tok_xyz", accountId: "org_2" }),
    )
  })

  it("fetches the public model list when there is no auth in context", async () => {
    vi.mocked(getStoredAuth).mockResolvedValue(undefined)
    vi.mocked(fetchKiloModels).mockResolvedValue({})

    const hooks = await KiloGateway({ client: {} } as never)
    await hooks.provider?.models?.({} as never, {} as never)

    expect(fetchKiloModels).toHaveBeenCalledWith(
      expect.objectContaining({ token: undefined, accountId: undefined }),
    )
  })

  it("prefers KILO_API_KEY and KILO_ORG_ID env vars over stored auth", async () => {
    process.env.KILO_API_KEY = "env_key_xyz"
    process.env.KILO_ORG_ID = "org_env"
    vi.mocked(getStoredAuth).mockResolvedValue(undefined)
    vi.mocked(fetchKiloModels).mockResolvedValue({})

    const hooks = await KiloGateway({ client: {} } as never)
    await hooks.provider?.models?.({} as never, {
      auth: { type: "oauth", access: "tok_stored", refresh: "tok_stored", expires: 1, accountId: "org_stored" },
    } as never)

    expect(fetchKiloModels).toHaveBeenCalledWith(
      expect.objectContaining({ token: "env_key_xyz", accountId: "org_env" }),
    )
  })

  it("treats an empty-string KILO_API_KEY as unset, falling through to stored OAuth", async () => {
    process.env.KILO_API_KEY = ""
    vi.mocked(getStoredAuth).mockResolvedValue(undefined)
    vi.mocked(fetchKiloModels).mockResolvedValue({})

    const hooks = await KiloGateway({ client: {} } as never)
    await hooks.provider?.models?.({} as never, {
      auth: { type: "oauth", access: "tok_stored", refresh: "tok_stored", expires: 1, accountId: "org_stored" },
    } as never)

    expect(fetchKiloModels).toHaveBeenCalledWith(
      expect.objectContaining({ token: "tok_stored" }),
    )
  })

  it("treats an empty-string KILO_ORG_ID as unset, falling through to stored accountId", async () => {
    process.env.KILO_ORG_ID = ""
    vi.mocked(getStoredAuth).mockResolvedValue(undefined)
    vi.mocked(fetchKiloModels).mockResolvedValue({})

    const hooks = await KiloGateway({ client: {} } as never)
    await hooks.provider?.models?.({} as never, {
      auth: { type: "oauth", access: "tok_stored", refresh: "tok_stored", expires: 1, accountId: "org_stored" },
    } as never)

    expect(fetchKiloModels).toHaveBeenCalledWith(
      expect.objectContaining({ accountId: "org_stored" }),
    )
  })
})
