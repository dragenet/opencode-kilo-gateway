import { afterEach, describe, expect, it, vi } from "vitest"
import setupDefault, { KiloGateway } from "../../src/index"
import { setup } from "../../src/v2/index"

type Event = { type: string; data: Record<string, unknown> }

function flush() {
  return new Promise<void>((resolve) => setTimeout(resolve, 0))
}

function fakeCtx(options: { activeImpl?: () => Promise<unknown>; resolveImpl?: () => Promise<unknown> } = {}) {
  const queue: Event[] = []
  let wake: (() => void) | undefined
  let signal: AbortSignal | undefined
  const calls = {
    integrationTransform: 0,
    providerTransform: 0,
    hooks: 0,
    integrationReload: 0,
    providerReload: 0,
    active: 0,
  }
  const ctx = {
    integration: {
      transform: async () => {
        calls.integrationTransform++
        return { dispose: async () => {} }
      },
      reload: async () => {
        calls.integrationReload++
      },
      connection: {
        active: async () => {
          calls.active++
          return options.activeImpl ? options.activeImpl() : undefined
        },
        resolve: async () => (options.resolveImpl ? options.resolveImpl() : undefined),
      },
    },
    provider: {
      transform: async () => {
        calls.providerTransform++
        return { dispose: async () => {} }
      },
      reload: async () => {
        calls.providerReload++
      },
    },
    session: {
      hook: async () => {
        calls.hooks++
        return { dispose: async () => {} }
      },
    },
    event: {
      subscribe: (opts?: { signal?: AbortSignal }) => {
        signal = opts?.signal
        return {
          async *[Symbol.asyncIterator]() {
            while (!signal?.aborted) {
              if (queue.length) {
                yield queue.shift()!
                continue
              }
              await new Promise<void>((resolve) => {
                wake = resolve
                signal?.addEventListener("abort", () => resolve(), { once: true })
              })
            }
          },
        }
      },
    },
  }
  return {
    ctx: ctx as any,
    calls,
    emit(event: Event) {
      queue.push(event)
      wake?.()
    },
    get signal() {
      return signal
    },
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
  delete process.env.KILO_API_KEY
})

describe("setup", () => {
  it("guard: v1-shaped ctx → resolves undefined, nothing registered", async () => {
    const v1 = { client: {}, directory: "/x", $: () => {} }
    await expect(setup(v1)).resolves.toBeUndefined()
    await expect(setup(undefined)).resolves.toBeUndefined()
    await expect(setup({ integration: {}, provider: {}, session: {} })).resolves.toBeUndefined()
  })

  it("registers integration, provider transform and two session hooks", async () => {
    const f = fakeCtx()
    const cleanup = await setup(f.ctx)
    expect(typeof cleanup).toBe("function")
    expect(f.calls.integrationTransform).toBe(1)
    expect(f.calls.providerTransform).toBe(1)
    expect(f.calls.hooks).toBe(2)
    cleanup!()
  })

  it("initial refresh runs in background", async () => {
    process.env.KILO_API_KEY = "env-key"
    let release!: () => void
    const gate = new Promise<void>((resolve) => (release = resolve))
    const fetchMock = vi.fn(async () => {
      await gate
      return new Response(JSON.stringify({ data: [] }), { status: 200 })
    })
    vi.stubGlobal("fetch", fetchMock)
    const f = fakeCtx()
    const cleanup = await setup(f.ctx)
    await flush()
    expect(fetchMock).toHaveBeenCalled()
    release()
    await flush()
    cleanup!()
  })

  it("credential.switched for kilo triggers refresh + integration.reload + provider.reload; other integration ignored", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ data: [] }), { status: 200 })))
    let resolves = 0
    const f = fakeCtx({
      activeImpl: async () => ({ id: "c1" }),
      resolveImpl: async () => ({ type: "key", key: ++resolves === 1 ? "key-1" : "key-2" }),
    })
    const cleanup = await setup(f.ctx)
    await vi.waitFor(() => {
      expect(f.calls.integrationReload).toBe(1)
      expect(f.calls.providerReload).toBe(1)
    })
    await flush()
    const baseActive = f.calls.active

    f.emit({ type: "credential.switched", data: { integrationID: "other", credentialID: "c1" } })
    f.emit({ type: "credential.updated", data: {} })
    await flush()
    await flush()
    expect(f.calls.active).toBe(baseActive)
    expect(f.calls.integrationReload).toBe(1)
    expect(f.calls.providerReload).toBe(1)

    f.emit({ type: "credential.switched", data: { integrationID: "kilo", credentialID: "c2" } })
    await vi.waitFor(() => {
      expect(f.calls.integrationReload).toBe(2)
      expect(f.calls.providerReload).toBe(2)
    })
    expect(f.calls.active).toBe(baseActive + 1)
    cleanup!()
  })

  it("reload hooks fire when refresh changes state", async () => {
    process.env.KILO_API_KEY = "env-key"
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ data: [] }), { status: 200 })))
    const f = fakeCtx()
    const cleanup = await setup(f.ctx)
    await vi.waitFor(() => {
      expect(f.calls.integrationReload).toBeGreaterThan(0)
      expect(f.calls.providerReload).toBeGreaterThan(0)
    })
    cleanup!()
  })

  it("cleanup aborts subscription", async () => {
    const f = fakeCtx()
    const cleanup = await setup(f.ctx)
    await flush()
    const before = f.calls.active
    cleanup!()
    expect(f.signal?.aborted).toBe(true)
    f.emit({ type: "credential.switched", data: { integrationID: "kilo", credentialID: "c" } })
    await flush()
    await flush()
    expect(f.calls.active).toBe(before)
  })

  it("setup with fetch rejecting → resolves; no unhandled rejection", async () => {
    process.env.KILO_API_KEY = "env-key"
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new Error("network down"))))
    const seen: unknown[] = []
    const onUnhandled = (reason: unknown) => seen.push(reason)
    process.on("unhandledRejection", onUnhandled)
    try {
      const f = fakeCtx()
      const cleanup = await setup(f.ctx)
      await flush()
      await flush()
      cleanup!()
      expect(seen).toEqual([])
    } finally {
      process.off("unhandledRejection", onUnhandled)
    }
  })

  it("subscription errors end the loop silently", async () => {
    const seen: unknown[] = []
    const onUnhandled = (reason: unknown) => seen.push(reason)
    process.on("unhandledRejection", onUnhandled)
    try {
      const f = fakeCtx()
      f.ctx.event.subscribe = () => ({
        async *[Symbol.asyncIterator]() {
          throw new Error("stream broke")
        },
      })
      const cleanup = await setup(f.ctx)
      await flush()
      await flush()
      cleanup!()
      expect(seen).toEqual([])
    } finally {
      process.off("unhandledRejection", onUnhandled)
    }
  })
})

describe("default export", () => {
  it("has the dual shape", () => {
    expect(setupDefault.id).toBe("kilo-gateway")
    expect(setupDefault.server).toBe(KiloGateway)
    expect(typeof setupDefault.setup).toBe("function")
    expect(setupDefault.setup).toBe(setup)
    expect(Object.keys(setupDefault).sort()).toEqual(["id", "server", "setup"])
  })
})
