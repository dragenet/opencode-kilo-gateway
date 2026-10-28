import type { Plugin } from "@opencode-ai/plugin";
import { setup } from "./v2/index.js";
/**
 * The Kilo gateway opencode plugin: device-auth login, cross-surface
 * organization selection, and dynamic org-scoped model listing for the
 * `kilo` provider.
 */
export declare const KiloGateway: Plugin;
declare const _default: {
    id: string;
    server: Plugin;
    setup: typeof setup;
};
export default _default;
