import type { Plugin } from "@opencode/plugin";
import { type WaitForDeviceAuthOptions } from "../device-auth.js";
import { type KiloState } from "./state.js";
export declare const LOGIN_METHOD_ID = "oauth";
export declare const ORG_METHOD_ID = "organization";
export interface IntegrationDeps {
    fetchImpl?: typeof fetch;
    waitOptions?: WaitForDeviceAuthOptions;
    now?: () => number;
    env?: Record<string, string | undefined>;
}
export declare function credentialLabel(credential: {
    metadata?: Record<string, unknown>;
}): string;
export declare function registerIntegration(ctx: Pick<Plugin.Context, "integration">, state: KiloState, deps?: IntegrationDeps): Promise<void>;
