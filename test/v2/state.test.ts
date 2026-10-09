import { describe, expect, it, vi } from "vitest"
import type { KiloRawModel } from "../../src/models"
import { createKiloState, PERSONAL, type ConnectionApi } from "../../src/v2/state"

const toolModel: KiloRawModel = {
  id: "z-ai/glm-5.1",
  name: "GLM 5.1",
  context_length: 160_000,
  pricing: { prompt: "0.000003", completion: "0.000015" },
  architecture: { input_modalities: ["text"], output_modalities: ["text"] },
  supported_parameters: ["tools"],
}

const noToolsModel: KiloRawModel = {
  ...toolModel,
  id: "some/no-tools",
  supported_parameters: ["temperature"],
}

const profileBody = {
  user: { email: "a@b.c" },
  organizations: [
    { id: "a", name: "Org A", role: "owner" },
    { id: "b", name: "Org B", role: "member" },
  ],
  hasPersonalAccount: true,
}

function json(body: unknown, status = 200) {
  return { status, ok: status >= 200 && status < 300, json: async () => body }
}

function okFetch(profile: unknown = profileBody, models: KiloRawModel[] = [toolModel, noToolsModel]) {
  return vi.fn(async (url: string) => (url.endsWith("/api/profile") ? json(profile) : json({ data: models })))
}

function connection(
  resolved: Awaited<ReturnType<ConnectionApi["resolve"]>> | (() => Awaited<ReturnType<ConnectionApi["resolve"]>>),
): ConnectionApi {
  return {
    active: vi.fn(async () => (resolved === undefined ? undefined : { id: "c1" })),
    resolve: vi.fn(async () => (typeof resolved === "function" ? resolved() : resolved)),
  }
}

function setup(opts: {
  env?: Record<string, string | undefined>
  conn?: ConnectionApi
  fetchImpl?: ReturnType<typeof vi.fn>
}) {
  const onChange = vi.fn(async () => {})
  const fetchImpl = opts.fetchImpl ?? okFetch()
  const kilo = createKiloState({
    connection: opts.conn ?? connection(undefined),
    env: opts.env ?? {},
    fetchImpl: fetchImpl as unknown as typeof fetch,
    onChange,
  })
  return { ...kilo, onChange, fetchImpl }
}

describe("createKiloState", () => {
  it("env key wins over credential", async () => {
    const conn = connection({ type: "oauth", access: "cred", refresh: "r", expires: 1 })
    const { state, refresh } = setup({ env: { KILO_API_KEY: "k", KILO_ORG_ID: "o" }, conn })
    await refresh()
    expect(state.auth).toMatchObject({ token: "k", orgId: "o", source: "env", apiBase: "https://api.kilo.ai" })
    expect(state.auth?.credential).toBeUndefined()
    expect(conn.active).not.toHaveBeenCalled()
  })

  it("imported v1 credential", async () => {
    const conn = connection({
      type: "oauth",
      access: "https://gw.example:tok",
      refresh: "ref",
      expires: 1,
      metadata: { accountID: "org1" },
    })
    const { state, refresh } = setup({ conn })
    await refresh()
    expect(state.auth).toMatchObject({
      token: "tok",
      apiBase: "https://gw.example",
      embeddedBaseUrl: true,
      orgId: "org1",
      source: "credential",
      credential: { access: "https://gw.example:tok", refresh: "ref", expires: 1 },
    })
  })

  it("KILO_ORG_ID overrides metadata org", async () => {
    const conn = connection({ type: "oauth", access: "tok", refresh: "r", expires: 1, metadata: { accountID: "org1" } })
    const { state, refresh } = setup({ env: { KILO_ORG_ID: "envorg" }, conn })
    await refresh()
    expect(state.auth?.orgId).toBe("envorg")
    expect(state.auth?.embeddedBaseUrl).toBe(false)
  })

  it("key credential has no org and no credential copy", async () => {
    const conn = connection({ type: "key", key: "kk", metadata: { accountID: "ignored" } })
    const { state, refresh } = setup({ conn })
    await refresh()
    expect(state.auth).toMatchObject({ token: "kk", source: "credential" })
    expect(state.auth?.orgId).toBeUndefined()
    expect(state.auth?.credential).toBeUndefined()
  })

  it('orgOptions maps personal to "personal"', async () => {
    const conn = connection({ type: "oauth", access: "tok", refresh: "r", expires: 1 })
    const { state, refresh } = setup({ conn })
    await refresh()
    expect(state.orgOptions).toEqual([
      { value: PERSONAL, label: "Personal account" },
      { value: "a", label: "Org A" },
      { value: "b", label: "Org B" },
    ])
  })

  it("orgName resolved from profile", async () => {
    const conn = connection({ type: "oauth", access: "tok", refresh: "r", expires: 1, metadata: { accountID: "b" } })
    const { state, refresh } = setup({ conn })
    await refresh()
    expect(state.auth?.orgName).toBe("Org B")
  })

  it("orgName falls back to metadata when profile unavailable", async () => {
    const conn = connection({
      type: "oauth",
      access: "tok",
      refresh: "r",
      expires: 1,
      metadata: { accountID: "b", orgName: "Stored B" },
    })
    const fetchImpl = vi.fn(async (url: string) =>
      url.endsWith("/api/profile") ? json({}, 500) : json({ data: [toolModel] }),
    )
    const { state, refresh } = setup({ conn, fetchImpl })
    await refresh()
    expect(state.auth?.orgName).toBe("Stored B")
  })

  it("models stored raw and tool-filtered", async () => {
    const conn = connection({ type: "oauth", access: "tok", refresh: "r", expires: 1 })
    const { state, refresh, onChange } = setup({ conn })
    await refresh()
    expect(state.models).toEqual([toolModel])
    expect(onChange).toHaveBeenCalledTimes(1)
  })

  it("profile failure keeps models; models failure keeps previous models", async () => {
    const conn = connection({ type: "oauth", access: "tok", refresh: "r", expires: 1 })
    let profileOk = true
    let modelsOk = true
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.endsWith("/api/profile")) {
        if (!profileOk) throw new Error("profile down")
        return json(profileBody)
      }
      if (!modelsOk) return json({}, 500)
      return json({ data: [toolModel] })
    })
    const { state, refresh } = setup({ conn, fetchImpl })
    await refresh()
    expect(state.models).toEqual([toolModel])
    expect(state.orgOptions).toHaveLength(3)

    profileOk = false
    await refresh()
    expect(state.models).toEqual([toolModel])
    expect(state.orgOptions).toHaveLength(3)

    profileOk = true
    modelsOk = false
    await refresh()
    expect(state.models).toEqual([toolModel])
    expect(state.orgOptions).toHaveLength(3)
  })

  it("network down: refresh resolves, state unchanged, onChange not called", async () => {
    const conn = connection({ type: "oauth", access: "tok", refresh: "r", expires: 1, metadata: { accountID: "a" } })
    let down = false
    const fetchImpl = vi.fn(async (url: string) => {
      if (down) throw new Error("network down")
      return url.endsWith("/api/profile") ? json(profileBody) : json({ data: [toolModel] })
    })
    const { state, refresh, onChange } = setup({ conn, fetchImpl })
    await refresh()
    expect(onChange).toHaveBeenCalledTimes(1)
    const before = JSON.stringify(state)

    down = true
    await expect(refresh()).resolves.toBeUndefined()
    expect(JSON.stringify(state)).toBe(before)
    expect(state.auth?.orgName).toBe("Org A")
    expect(onChange).toHaveBeenCalledTimes(1)
  })

  it("connection failure resolves without touching state", async () => {
    const conn: ConnectionApi = {
      active: vi.fn(async () => {
        throw new Error("boom")
      }),
      resolve: vi.fn(),
    }
    const { state, refresh, onChange } = setup({ conn })
    await expect(refresh()).resolves.toBeUndefined()
    expect(state.auth).toBeUndefined()
    expect(onChange).not.toHaveBeenCalled()
  })

  it("onChange failure does not reject refresh", async () => {
    const conn = connection({ type: "oauth", access: "tok", refresh: "r", expires: 1 })
    const { refresh, onChange } = setup({ conn })
    onChange.mockRejectedValueOnce(new Error("reload failed"))
    await expect(refresh()).resolves.toBeUndefined()
  })

  it("stale refresh discarded", async () => {
    let current = "first"
    const conn = connection(() => ({
      type: "oauth",
      access: `tok-${current}`,
      refresh: "r",
      expires: 1,
      metadata: { accountID: current },
    }))
    let releaseFirst!: () => void
    const gate = new Promise<void>((resolve) => (releaseFirst = resolve))
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes("/api/organizations/first/")) await gate
      return url.endsWith("/api/profile") ? json(profileBody) : json({ data: [toolModel] })
    })
    const { state, refresh, onChange } = setup({ conn, fetchImpl })

    const first = refresh()
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalled())
    current = "second"
    await refresh()
    expect(state.auth?.orgId).toBe("second")
    expect(onChange).toHaveBeenCalledTimes(1)

    releaseFirst()
    await first
    expect(state.auth?.orgId).toBe("second")
    expect(onChange).toHaveBeenCalledTimes(1)
  })

  describe("account binding", () => {
    function switching(opts: { profileFailsOnB?: boolean; modelsFailOnB?: boolean; orgB?: string }) {
      let current = "A"
      const conn = connection(() => ({
        type: "oauth",
        access: `tok-${current}`,
        refresh: "r",
        expires: 1,
        metadata: { accountID: current === "A" ? "a" : (opts.orgB ?? "a") },
      }))
      const fetchImpl = vi.fn(async (url: string, init?: { headers?: Record<string, string> }) => {
        const onB = init?.headers?.Authorization === "Bearer tok-B"
        if (url.endsWith("/api/profile")) {
          if (onB && opts.profileFailsOnB) throw new Error("profile down")
          return json(profileBody)
        }
        if (onB && opts.modelsFailOnB) return json({}, 500)
        return json({ data: [toolModel] })
      })
      const kilo = setup({ conn, fetchImpl })
      return { ...kilo, switchToB: () => (current = "B") }
    }

    it("token change + profile failure clears orgOptions", async () => {
      const { state, refresh, switchToB } = switching({ profileFailsOnB: true })
      await refresh()
      expect(state.orgOptions).toHaveLength(3)
      switchToB()
      await refresh()
      expect(state.auth?.token).toBe("tok-B")
      expect(state.orgOptions).toEqual([])
    })

    it("same token + profile failure keeps orgOptions", async () => {
      const conn = connection({ type: "oauth", access: "tok", refresh: "r", expires: 1 })
      let down = false
      const fetchImpl = vi.fn(async (url: string) => {
        if (url.endsWith("/api/profile") && down) throw new Error("down")
        return url.endsWith("/api/profile") ? json(profileBody) : json({ data: [toolModel] })
      })
      const { state, refresh } = setup({ conn, fetchImpl })
      await refresh()
      down = true
      await refresh()
      expect(state.orgOptions).toHaveLength(3)
    })

    it("authed → no auth clears orgOptions and models without fetching the public catalog", async () => {
      let signedIn = true
      const conn: ConnectionApi = {
        active: vi.fn(async () => (signedIn ? { id: "c1" } : undefined)),
        resolve: vi.fn(async () => ({ type: "oauth", access: "tok", refresh: "r", expires: 1 })),
      }
      const fetchImpl = okFetch(profileBody, [toolModel])
      const { state, refresh } = setup({ conn, fetchImpl })
      await refresh()
      expect(state.models).toEqual([toolModel])
      signedIn = false
      fetchImpl.mockClear()
      await refresh()
      expect(state.auth).toBeUndefined()
      expect(state.orgOptions).toEqual([])
      expect(state.models).toBeUndefined()
      expect(fetchImpl).not.toHaveBeenCalled()
    })

    it("no auth at all never fetches models", async () => {
      const { state, refresh, fetchImpl } = setup({})
      await refresh()
      expect(fetchImpl).not.toHaveBeenCalled()
      expect(state.models).toBeUndefined()
    })

    it("token change + models failure clears models", async () => {
      const { state, refresh, switchToB } = switching({ modelsFailOnB: true })
      await refresh()
      expect(state.models).toEqual([toolModel])
      switchToB()
      await refresh()
      expect(state.models).toBeUndefined()
    })

    it("org change (same token) + models failure clears models", async () => {
      let org = "a"
      const conn = connection(() => ({
        type: "oauth",
        access: "tok",
        refresh: "r",
        expires: 1,
        metadata: { accountID: org },
      }))
      const fetchImpl = vi.fn(async (url: string) => {
        if (url.includes("/api/organizations/b/")) return json({}, 500)
        return url.endsWith("/api/profile") ? json(profileBody) : json({ data: [toolModel] })
      })
      const { state, refresh } = setup({ conn, fetchImpl })
      await refresh()
      expect(state.models).toEqual([toolModel])
      org = "b"
      await refresh()
      expect(state.auth?.orgId).toBe("b")
      expect(state.models).toBeUndefined()
    })

    it("same token & org + models failure keeps previous models", async () => {
      const conn = connection({ type: "oauth", access: "tok", refresh: "r", expires: 1, metadata: { accountID: "a" } })
      let down = false
      const fetchImpl = vi.fn(async (url: string) => {
        if (down && !url.endsWith("/api/profile")) return json({}, 500)
        return url.endsWith("/api/profile") ? json(profileBody) : json({ data: [toolModel] })
      })
      const { state, refresh } = setup({ conn, fetchImpl })
      await refresh()
      down = true
      await refresh()
      expect(state.models).toEqual([toolModel])
    })
  })

  it("identical successful refreshes call onChange once", async () => {
    const conn = connection({ type: "oauth", access: "tok", refresh: "r", expires: 1, metadata: { accountID: "a" } })
    const { refresh, onChange } = setup({ conn })
    await refresh()
    await refresh()
    expect(onChange).toHaveBeenCalledTimes(1)
  })

  it("no credential and no env → auth undefined, orgOptions []", async () => {
    const { state, refresh } = setup({})
    await refresh()
    expect(state.auth).toBeUndefined()
    expect(state.orgOptions).toEqual([])
  })
})
