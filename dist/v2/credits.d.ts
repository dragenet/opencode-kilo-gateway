/** Body Kilo returns for `402 usage_limit_exceeded` when a paid model is requested without credits. */
export interface KiloCreditsErrorBody {
    error?: {
        title?: string;
        message?: string;
        balance?: number;
        buyCreditsUrl?: string;
    };
    error_type?: string;
}
export interface KiloCreditsDetails {
    balance?: number;
    buyCreditsUrl: string;
}
/**
 * Recognises Kilo's "paid model, no credits" response.
 *
 * Only that exact error is claimed: other 402s (upstream providers report
 * their own credit problems with the same status) and every other status stay
 * untouched, because rewriting a message the plugin does not understand would
 * hide the real cause.
 */
export declare function parseKiloCreditsError(body: unknown): KiloCreditsDetails | undefined;
/** Names the model, the remaining balance and the two ways out: top up, or switch to a free model. */
export declare function creditsMessage(modelID: string | undefined, details: KiloCreditsDetails): string;
/** The parts of the v2 `http.response` hook payload this module relies on. */
export interface CreditsResponseEvent {
    readonly model?: {
        readonly id?: string;
    };
    response: Response;
}
/**
 * Rewrites Kilo's credits 402 so the failure is actionable.
 *
 * The status code, headers and body shape stay as the gateway sent them:
 * only `error.message` is replaced. Nothing is retried, downgraded or
 * swallowed — a turn that ran out of credits still fails, it just says why.
 */
export declare function renderCreditsError(event: CreditsResponseEvent): Promise<void>;
