import { PROVIDER_ID } from "./config"

export const KILO_AI_SDK_NPM = "@ai-sdk/openai-compatible"

export interface KiloModelPricing {
  prompt: string
  completion: string
  input_cache_read?: string
  input_cache_write?: string
}

export interface KiloModelArchitecture {
  input_modalities: string[]
  output_modalities: string[]
  tokenizer?: string
}

export interface KiloRawModel {
  id: string
  name: string
  description?: string
  context_length: number
  max_completion_tokens?: number | null
  pricing: KiloModelPricing
  architecture: KiloModelArchitecture
  top_provider?: { max_completion_tokens?: number | null }
  supported_parameters?: string[]
}

export interface OpencodeModelCost {
  input: number
  output: number
  cache: { read: number; write: number }
}

export interface OpencodeModelLimit {
  context: number
  output: number
}

export interface OpencodeModelCapabilities {
  temperature: boolean
  reasoning: boolean
  attachment: boolean
  toolcall: boolean
  input: { text: boolean; audio: boolean; image: boolean; video: boolean; pdf: boolean }
  output: { text: boolean; audio: boolean; image: boolean; video: boolean; pdf: boolean }
  interleaved: boolean
}

export interface OpencodeModel {
  id: string
  providerID: string
  api: { id: string; url: string; npm: string }
  name: string
  status: "active"
  capabilities: OpencodeModelCapabilities
  cost: OpencodeModelCost
  limit: OpencodeModelLimit
  options: Record<string, unknown>
  headers: Record<string, string>
  release_date: string
}

/** Converts a Kilo `$/token` price string into `$` per million tokens. */
export function parseApiPrice(value: string | undefined): number {
  if (!value) return 0
  const price = Number.parseFloat(value)
  if (Number.isNaN(price)) return 0
  return price * 1_000_000
}

/** Kilo requires tool-calling support; models without it are unusable. */
export function supportsTools(model: KiloRawModel): boolean {
  return (model.supported_parameters ?? []).includes("tools")
}

/** Maps a raw Kilo/OpenRouter-shaped model into an opencode `Model`. */
export function mapKiloModel(model: KiloRawModel, apiUrl: string): OpencodeModel {
  const inputModalities = model.architecture?.input_modalities ?? []
  const outputModalities = model.architecture?.output_modalities ?? []
  const supportedParameters = model.supported_parameters ?? []
  const hasImage = inputModalities.includes("image")

  return {
    id: model.id,
    providerID: PROVIDER_ID,
    api: { id: model.id, url: apiUrl, npm: KILO_AI_SDK_NPM },
    name: model.name ?? model.id,
    status: "active",
    capabilities: {
      temperature: supportedParameters.includes("temperature"),
      reasoning: supportedParameters.includes("reasoning"),
      attachment: hasImage,
      toolcall: true,
      input: {
        text: inputModalities.length === 0 || inputModalities.includes("text"),
        audio: inputModalities.includes("audio"),
        image: hasImage,
        video: inputModalities.includes("video"),
        pdf: inputModalities.includes("file"),
      },
      output: {
        text: outputModalities.length === 0 || outputModalities.includes("text"),
        audio: outputModalities.includes("audio"),
        image: outputModalities.includes("image"),
        video: outputModalities.includes("video"),
        pdf: false,
      },
      interleaved: false,
    },
    cost: {
      input: parseApiPrice(model.pricing?.prompt),
      output: parseApiPrice(model.pricing?.completion),
      cache: {
        read: parseApiPrice(model.pricing?.input_cache_read),
        write: parseApiPrice(model.pricing?.input_cache_write),
      },
    },
    limit: {
      context: model.context_length,
      // Kilo doesn't always report an explicit output token limit; fall back
      // to the model's context length as a reasonable default in that case.
      output: resolveOutputLimit(model) ?? model.context_length,
    },
    options: {},
    headers: {},
    release_date: "",
  }
}

function resolveOutputLimit(model: KiloRawModel): number | undefined {
  if (typeof model.max_completion_tokens === "number") return model.max_completion_tokens
  if (typeof model.top_provider?.max_completion_tokens === "number") return model.top_provider.max_completion_tokens
  return undefined
}

export interface FetchModelsOptions {
  baseUrl: string
  accountId?: string
  token?: string
  fetchImpl?: typeof fetch
  timeoutMs?: number
}

function modelsEndpoint(baseUrl: string, accountId?: string): string {
  return accountId
    ? `${baseUrl}/api/organizations/${encodeURIComponent(accountId)}/models`
    : `${baseUrl}/api/openrouter/models`
}

/** Returns the chat-completions base URL (always the public endpoint, org scoping via header). */
function chatBaseUrl(baseUrl: string): string {
  return `${baseUrl}/api/openrouter`
}

/**
 * Fetches the dynamic Kilo model list, org-scoped when an organization is
 * selected. Falls back to the public (unauthenticated) list on a 401, and
 * drops any model that does not support tool-calling.
 */
export async function fetchKiloModels(options: FetchModelsOptions): Promise<Record<string, OpencodeModel>> {
  const { baseUrl, accountId, token, fetchImpl = fetch, timeoutMs = 10_000 } = options
  const headers: Record<string, string> = { "Content-Type": "application/json" }
  if (token) headers.Authorization = `Bearer ${token}`

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  let res: Response
  try {
    res = await fetchImpl(modelsEndpoint(baseUrl, accountId), { headers, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }

  if (res.status === 401 && (accountId || token)) {
    return fetchKiloModels({ baseUrl, fetchImpl, timeoutMs })
  }
  if (!res.ok) {
    throw new Error(`Failed to fetch Kilo models: HTTP ${res.status}`)
  }

  const body = (await res.json()) as { data: KiloRawModel[] }
  const result: Record<string, OpencodeModel> = {}
  for (const raw of body.data) {
    if (!supportsTools(raw)) continue
    result[raw.id] = mapKiloModel(raw, chatBaseUrl(baseUrl))
  }
  return result
}