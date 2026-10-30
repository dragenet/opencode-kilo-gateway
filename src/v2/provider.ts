import type { Model, Plugin } from "@opencode/plugin"
import { DEFAULT_KILO_API_URL, HEADER_ORGANIZATION_ID, PACKAGE_VERSION, PROVIDER_ID } from "../config.js"
import { buildKiloHeaders } from "../headers.js"
import { parseApiPrice, type KiloRawModel } from "../models.js"
import { renderCreditsError } from "./credits.js"
import type { KiloState } from "./state.js"

type V2Model = Model.Info

// Model.Info limits are integers: floor finite non-negative numbers, otherwise use the fallback.
function toInt(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : fallback
}

function resolveOutputLimit(raw: KiloRawModel, context: number): number {
  if (typeof raw.max_completion_tokens === "number") return toInt(raw.max_completion_tokens, context)
  if (typeof raw.top_provider?.max_completion_tokens === "number") {
    return toInt(raw.top_provider.max_completion_tokens, context)
  }
  return context
}

function modalities(values: string[] | undefined): string[] {
  // Kilo reports PDFs as "file"; v2 matches capabilities by "pdf".
  const mapped = (values ?? []).map((value) => (value === "file" ? "pdf" : value))
  return mapped.length > 0 ? [...new Set(mapped)] : ["text"]
}

/** Maps a raw Kilo model into a v2 `Model.Info`; all branded-type casts live here. */
export function toV2Model(raw: KiloRawModel): V2Model {
  const price = (value: Parameters<typeof parseApiPrice>[0]) => Math.max(0, parseApiPrice(value))
  const context = toInt(raw.context_length, 0)
  const info = {
    id: raw.id,
    modelID: raw.id,
    providerID: PROVIDER_ID,
    name: raw.name ?? raw.id,
    capabilities: {
      tools: true,
      input: modalities(raw.architecture?.input_modalities),
      output: modalities(raw.architecture?.output_modalities),
    },
    variants: [],
    time: { released: 0 },
    cost: [
      {
        input: price(raw.pricing?.prompt),
        output: price(raw.pricing?.completion),
        cache: {
          read: price(raw.pricing?.input_cache_read),
          write: price(raw.pricing?.input_cache_write),
        },
      },
    ],
    status: "active",
    enabled: true,
    limit: { context, output: resolveOutputLimit(raw, context) },
  }
  return info as unknown as V2Model
}

export async function registerProvider(
  ctx: Pick<Plugin.Context, "provider" | "session">,
  state: KiloState,
): Promise<void> {
  await ctx.provider.transform((editor) => {
    editor.update(PROVIDER_ID, (provider) => {
      provider.settings = {
        ...provider.settings,
        baseURL: (state.auth?.apiBase ?? DEFAULT_KILO_API_URL) + "/api/openrouter",
      }
      provider.headers = { ...provider.headers, ...buildKiloHeaders({ version: PACKAGE_VERSION }) }
    })
    if (state.models) editor.models.set(PROVIDER_ID, state.models.map(toV2Model))
  })

  await ctx.session.hook(
    "model.request",
    (event) => {
      if (state.auth?.orgId) event.headers[HEADER_ORGANIZATION_ID] = state.auth.orgId
    },
    { providerID: PROVIDER_ID },
  )

  await ctx.session.hook(
    "http.request",
    (event) => {
      // Core injects the apiKey of the active connection; our env/org-aware token must win.
      if (state.auth) event.request.headers.set("authorization", "Bearer " + state.auth.token)
    },
    { providerID: PROVIDER_ID },
  )

  // Runs after the gateway answered: a "paid model, no credits" 402 is rewritten
  // so the failure names the model, the balance and where to top up.
  await ctx.session.hook("http.response", (event) => renderCreditsError(event), { providerID: PROVIDER_ID })
}
