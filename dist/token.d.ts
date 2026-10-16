export interface ParsedKiloToken {
    baseUrl?: string;
    token: string;
}
/**
 * A Kilo access token may embed a base-URL override in the form
 * `https://host[:port][/path]:<token>` (used for self-hosted gateways).
 * This extracts the base URL prefix (if present) and the underlying token.
 *
 * Known limitation: if the base URL itself contains a port AND a path with
 * no further colon, the first colon after the host is used as the
 * separator — a self-hosted URL that combines a custom port with a path
 * segment containing a colon is not supported.
 */
export declare function parseKiloToken(raw: string): ParsedKiloToken;
