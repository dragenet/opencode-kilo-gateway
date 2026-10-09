import type { Model, Plugin } from "@opencode/plugin"
import { DEFAULT_KILO_API_URL, HEADER_ORGANIZATION_ID, PACKAGE_VERSION, PROVIDER_ID } from "../config"
import { buildKiloHeaders } from "../headers"
import { parseApiPrice, type KiloRawModel } from "../models"
import type { KiloState } from "./state"

type V2Model = Model.Info

function resolveOutputLimit(raw: KiloRawModel): number {
  if (typeof raw.max_completion_tokens === "number") return raw.max_completion_tokens
  if (typeof raw.top_provider?.max_completion_tokens === "number") return raw.top_provider.max_completion_tokens
  return raw.context_length
}

function modalities(values: string[] | undefined): string[] {
  return values && values.length > 0 ? [...values] : ["text"]
}

/** Maps a raw Kilo model into a v2 `Model.Info`; all branded-type casts live here. */
export function toV2Model(raw: KiloRawModel): V2Model {
  const price = parseApiPrice
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
    limit: { context: raw.context_length, output: resolveOutputLimit(raw) },
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
      if (state.auth?.embeddedBaseUrl) event.request.headers.set("authorization", "Bearer " + state.auth.token)
    },
    { providerID: PROVIDER_ID },
  )
}
