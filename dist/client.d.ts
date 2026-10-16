export interface StoredOAuthAuth {
    type: "oauth";
    access: string;
    refresh: string;
    expires: number;
    accountId?: string;
}
export interface StoredApiAuth {
    type: "api";
    key: string;
}
export interface StoredWellKnownAuth {
    type: "wellknown";
    key: string;
    token: string;
}
export type StoredAuth = StoredOAuthAuth | StoredApiAuth | StoredWellKnownAuth | undefined;
/**
 * Reads the currently stored credential for a provider.
 *
 * Tries a duck-typed SDK client auth accessor first, for forward
 * compatibility if a future `@opencode-ai/sdk` version adds one. As of the
 * currently pinned SDK version, no such accessor exists on the real client
 * type — this branch is a no-op today, and every call falls through to
 * reading `auth.json` directly, the same file opencode writes to for
 * plugin credentials.
 */
export declare function getStoredAuth(client: unknown, providerId: string): Promise<StoredAuth>;
