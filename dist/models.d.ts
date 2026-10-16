export declare const KILO_AI_SDK_NPM = "@ai-sdk/openai-compatible";
export interface KiloModelPricing {
    prompt: string;
    completion: string;
    input_cache_read?: string;
    input_cache_write?: string;
}
export interface KiloModelArchitecture {
    input_modalities: string[];
    output_modalities: string[];
    tokenizer?: string;
}
export interface KiloRawModel {
    id: string;
    name: string;
    description?: string;
    context_length: number;
    max_completion_tokens?: number | null;
    pricing: KiloModelPricing;
    architecture: KiloModelArchitecture;
    top_provider?: {
        max_completion_tokens?: number | null;
    };
    supported_parameters?: string[];
}
export interface OpencodeModelCost {
    input: number;
    output: number;
    cache: {
        read: number;
        write: number;
    };
}
export interface OpencodeModelLimit {
    context: number;
    output: number;
}
export interface OpencodeModelCapabilities {
    temperature: boolean;
    reasoning: boolean;
    attachment: boolean;
    toolcall: boolean;
    input: {
        text: boolean;
        audio: boolean;
        image: boolean;
        video: boolean;
        pdf: boolean;
    };
    output: {
        text: boolean;
        audio: boolean;
        image: boolean;
        video: boolean;
        pdf: boolean;
    };
    interleaved: boolean;
}
export interface OpencodeModel {
    id: string;
    providerID: string;
    api: {
        id: string;
        url: string;
        npm: string;
    };
    name: string;
    status: "active";
    capabilities: OpencodeModelCapabilities;
    cost: OpencodeModelCost;
    limit: OpencodeModelLimit;
    options: Record<string, unknown>;
    headers: Record<string, string>;
    release_date: string;
}
/** Converts a Kilo `$/token` price string into `$` per million tokens. */
export declare function parseApiPrice(value: string | undefined): number;
/** Kilo requires tool-calling support; models without it are unusable. */
export declare function supportsTools(model: KiloRawModel): boolean;
/** Maps a raw Kilo/OpenRouter-shaped model into an opencode `Model`. */
export declare function mapKiloModel(model: KiloRawModel, apiUrl: string): OpencodeModel;
export interface FetchModelsOptions {
    baseUrl: string;
    accountId?: string;
    token?: string;
    fetchImpl?: typeof fetch;
    timeoutMs?: number;
}
/**
 * Fetches the dynamic Kilo model list, org-scoped when an organization is
 * selected. Falls back to the public (unauthenticated) list on a 401, and
 * drops any model that does not support tool-calling.
 */
export declare function fetchKiloModels(options: FetchModelsOptions): Promise<Record<string, OpencodeModel>>;
/**
 * Fetches the raw Kilo model list (org-scoped when an organization is
 * selected), falling back to the public list on a 401 and dropping any model
 * that does not support tool-calling.
 */
export declare function fetchRawKiloModels(options: FetchModelsOptions): Promise<KiloRawModel[]>;
