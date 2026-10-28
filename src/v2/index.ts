import type { Plugin } from "@opencode/plugin"
import { PROVIDER_ID } from "../config.js"
import { registerIntegration } from "./integration.js"
import { registerProvider } from "./provider.js"
import { createKiloState } from "./state.js"

function hasFunction(target: unknown, key: string): boolean {
  return typeof (target as Record<string, unknown> | undefined)?.[key] === "function"
}

function isV2Context(ctx: unknown): ctx is Plugin.Context {
  const c = ctx as { integration?: unknown; provider?: unknown; session?: unknown } | null | undefined
  return hasFunction(c?.integration, "transform") && hasFunction(c?.provider, "transform") && hasFunction(c?.session, "hook")
}

/** OpenCode v2 plugin entry: registers the Kilo integration and provider, and keeps them in sync with the active credential. */
export async function setup(ctx: unknown): Promise<(() => void) | void> {
  if (!isV2Context(ctx)) return

  const { state, refresh } = createKiloState({
    connection: ctx.integration.connection,
    env: process.env,
    onChange: async () => {
      await ctx.integration.reload()
      await ctx.provider.reload()
    },
  })

  await registerIntegration(ctx, state)
  await registerProvider(ctx, state)

  const controller = new AbortController()
  void (async () => {
    try {
      for await (const event of ctx.event.subscribe({ signal: controller.signal })) {
        if (controller.signal.aborted) return
        const { type, data } = event as { type: string; data?: { integrationID?: string } }
        if (type === "credential.switched" && data?.integrationID === PROVIDER_ID) void refresh()
      }
    } catch {
      // Aborted or the event stream failed: the subscription simply ends.
    }
  })()

  void refresh()
  return () => controller.abort()
}
