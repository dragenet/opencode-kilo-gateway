const CREDITS_ERROR_TYPE = "usage_limit_exceeded";
const CREDITS_TITLE = "Paid Model - Credits Required";
const DEFAULT_BUY_CREDITS_URL = "https://app.kilo.ai/profile";
const FREE_MODEL_HINT = "kilo-auto/free";
/** Response headers that describe the original body encoding and must not survive a rewrite. */
const BODY_ENCODING_HEADERS = ["content-encoding", "content-length", "transfer-encoding"];
/**
 * Recognises Kilo's "paid model, no credits" response.
 *
 * Only that exact error is claimed: other 402s (upstream providers report
 * their own credit problems with the same status) and every other status stay
 * untouched, because rewriting a message the plugin does not understand would
 * hide the real cause.
 */
export function parseKiloCreditsError(body) {
    if (typeof body !== "object" || body === null)
        return undefined;
    const { error, error_type } = body;
    if (error_type !== CREDITS_ERROR_TYPE)
        return undefined;
    if (!error || error.title !== CREDITS_TITLE)
        return undefined;
    return {
        ...(typeof error.balance === "number" ? { balance: error.balance } : {}),
        buyCreditsUrl: str(error.buyCreditsUrl) ?? DEFAULT_BUY_CREDITS_URL,
    };
}
function str(value) {
    return typeof value === "string" && value ? value : undefined;
}
/** Names the model, the remaining balance and the two ways out: top up, or switch to a free model. */
export function creditsMessage(modelID, details) {
    const model = modelID ? `"${modelID}"` : "this model";
    const balance = details.balance === undefined ? "" : ` (balance ${details.balance})`;
    return (`Kilo credits required for ${model}${balance}: add credits at ${details.buyCreditsUrl} ` +
        `or switch to a free model such as ${FREE_MODEL_HINT}.`);
}
/**
 * Rewrites Kilo's credits 402 so the failure is actionable.
 *
 * The status code, headers and body shape stay as the gateway sent them:
 * only `error.message` is replaced. Nothing is retried, downgraded or
 * swallowed — a turn that ran out of credits still fails, it just says why.
 */
export async function renderCreditsError(event) {
    if (event.response.status !== 402)
        return;
    const body = await readJson(event.response);
    const details = parseKiloCreditsError(body);
    if (!details)
        return;
    const original = body;
    const rewritten = {
        ...original,
        error: { ...original.error, message: creditsMessage(event.model?.id, details) },
    };
    const headers = new Headers(event.response.headers);
    for (const name of BODY_ENCODING_HEADERS)
        headers.delete(name);
    event.response = new Response(JSON.stringify(rewritten), {
        status: event.response.status,
        statusText: event.response.statusText,
        headers,
    });
}
/** Reads the body without consuming it; a non-JSON body simply is not a Kilo credits error. */
async function readJson(response) {
    try {
        return JSON.parse(await response.clone().text());
    }
    catch {
        return undefined;
    }
}
