import { PROVIDER_ID } from "./config.js";
export const KILO_AI_SDK_NPM = "@ai-sdk/openai-compatible";
/** Converts a Kilo `$/token` price string into `$` per million tokens. */
export function parseApiPrice(value) {
    if (!value)
        return 0;
    const price = Number.parseFloat(value);
    if (Number.isNaN(price))
        return 0;
    return price * 1_000_000;
}
/** Kilo requires tool-calling support; models without it are unusable. */
export function supportsTools(model) {
    return (model.supported_parameters ?? []).includes("tools");
}
/** Maps a raw Kilo/OpenRouter-shaped model into an opencode `Model`. */
export function mapKiloModel(model, apiUrl) {
    const inputModalities = model.architecture?.input_modalities ?? [];
    const outputModalities = model.architecture?.output_modalities ?? [];
    const supportedParameters = model.supported_parameters ?? [];
    const hasImage = inputModalities.includes("image");
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
    };
}
function resolveOutputLimit(model) {
    if (typeof model.max_completion_tokens === "number")
        return model.max_completion_tokens;
    if (typeof model.top_provider?.max_completion_tokens === "number")
        return model.top_provider.max_completion_tokens;
    return undefined;
}
function modelsEndpoint(baseUrl, accountId) {
    return accountId
        ? `${baseUrl}/api/organizations/${encodeURIComponent(accountId)}/models`
        : `${baseUrl}/api/openrouter/models`;
}
/** Returns the chat-completions base URL (always the public endpoint, org scoping via header). */
function chatBaseUrl(baseUrl) {
    return `${baseUrl}/api/openrouter`;
}
/**
 * Fetches the dynamic Kilo model list, org-scoped when an organization is
 * selected. Falls back to the public (unauthenticated) list on a 401, and
 * drops any model that does not support tool-calling.
 */
export async function fetchKiloModels(options) {
    const raws = await fetchRawKiloModels(options);
    const result = {};
    for (const raw of raws) {
        result[raw.id] = mapKiloModel(raw, chatBaseUrl(options.baseUrl));
    }
    return result;
}
/**
 * Fetches the raw Kilo model list (org-scoped when an organization is
 * selected), falling back to the public list on a 401 and dropping any model
 * that does not support tool-calling.
 */
export async function fetchRawKiloModels(options) {
    const { baseUrl, accountId, token, fetchImpl = fetch, timeoutMs = 10_000 } = options;
    const headers = { "Content-Type": "application/json" };
    if (token)
        headers.Authorization = `Bearer ${token}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res;
    try {
        res = await fetchImpl(modelsEndpoint(baseUrl, accountId), { headers, signal: controller.signal });
    }
    finally {
        clearTimeout(timer);
    }
    if (res.status === 401 && (accountId || token)) {
        return fetchRawKiloModels({ baseUrl, fetchImpl, timeoutMs });
    }
    if (!res.ok) {
        throw new Error(`Failed to fetch Kilo models: HTTP ${res.status}`);
    }
    const body = (await res.json());
    return body.data.filter(supportsTools);
}
