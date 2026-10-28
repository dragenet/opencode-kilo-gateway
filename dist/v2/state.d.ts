import { type KiloRawModel } from "../models.js";
export declare const PERSONAL = "personal";
export interface OrgOption {
    value: string;
    label: string;
}
export interface KiloAuth {
    token: string;
    apiBase: string;
    embeddedBaseUrl: boolean;
    orgId?: string;
    orgName?: string;
    source: "env" | "credential";
    credential?: {
        access: string;
        refresh: string;
        expires: number;
    };
}
export interface KiloState {
    auth?: KiloAuth;
    orgOptions: OrgOption[];
    models?: KiloRawModel[];
}
export interface ConnectionApi<C = unknown> {
    active(integrationID: string): Promise<C | undefined>;
    resolve(connection: C): Promise<{
        type: string;
        access?: string;
        refresh?: string;
        expires?: number;
        key?: string;
        metadata?: Record<string, unknown>;
    } | undefined>;
}
export interface KiloStateDeps<C = unknown> {
    connection: ConnectionApi<C>;
    env: Record<string, string | undefined>;
    fetchImpl?: typeof fetch;
    onChange: () => Promise<void>;
}
export declare function createKiloState<C>(deps: KiloStateDeps<C>): {
    state: KiloState;
    refresh(): Promise<void>;
};
