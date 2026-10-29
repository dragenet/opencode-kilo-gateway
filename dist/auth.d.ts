import { type WaitForDeviceAuthOptions } from "./device-auth.js";
import { type SelectOption } from "./profile.js";
interface AuthorizeSuccess {
    type: "success";
    provider: "kilo";
    refresh: string;
    access: string;
    expires: number;
    accountId?: string;
}
interface AuthorizeFailed {
    type: "failed";
}
type CallbackResult = AuthorizeSuccess | AuthorizeFailed;
interface OAuthAuthorization {
    url: string;
    instructions: string;
    method: "auto";
    callback(): Promise<CallbackResult>;
}
export interface OAuthMethod {
    type: "oauth";
    label: string;
    prompts?: Array<{
        type: "select";
        key: string;
        message: string;
        options: SelectOption[];
    }>;
    authorize(inputs?: Record<string, string>): Promise<OAuthAuthorization>;
}
/**
 * Builds the primary "Login with Kilo" auth method: runs the device
 * authorization grant, then resolves and stores the default organization
 * from the user's profile.
 */
export declare function buildLoginMethod(apiBase: string, fetchImpl?: typeof fetch, waitOptions?: WaitForDeviceAuthOptions): OAuthMethod;
/**
 * Builds the "Switch organization" auth method: a native `select` prompt
 * (populated at plugin-load time with the user's organizations) that, on
 * selection, reuses the existing token — no browser flow — and persists
 * the newly chosen `accountId`.
 *
 * Returns `undefined` when there is no existing token to reuse, or when
 * there is nothing to choose between (personal account only).
 */
export declare function buildSwitchOrgMethod(apiBase: string, options: SelectOption[], existingToken: string | undefined, existingExpires: number | undefined): OAuthMethod | undefined;
export {};
