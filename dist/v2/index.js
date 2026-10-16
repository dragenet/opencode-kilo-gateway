import { PROVIDER_ID } from "../config";
import { registerIntegration } from "./integration";
import { registerProvider } from "./provider";
import { createKiloState } from "./state";
function hasFunction(target, key) {
    return typeof target?.[key] === "function";
}
function isV2Context(ctx) {
    const c = ctx;
    return hasFunction(c?.integration, "transform") && hasFunction(c?.provider, "transform") && hasFunction(c?.session, "hook");
}
/** OpenCode v2 plugin entry: registers the Kilo integration and provider, and keeps them in sync with the active credential. */
export async function setup(ctx) {
    if (!isV2Context(ctx))
        return;
    const { state, refresh } = createKiloState({
        connection: ctx.integration.connection,
        env: process.env,
        onChange: async () => {
            await ctx.integration.reload();
            await ctx.provider.reload();
        },
    });
    await registerIntegration(ctx, state);
    await registerProvider(ctx, state);
    const controller = new AbortController();
    void (async () => {
        try {
            for await (const event of ctx.event.subscribe({ signal: controller.signal })) {
                if (controller.signal.aborted)
                    return;
                const { type, data } = event;
                if (type === "credential.switched" && data?.integrationID === PROVIDER_ID)
                    void refresh();
            }
        }
        catch {
            // Aborted or the event stream failed: the subscription simply ends.
        }
    })();
    void refresh();
    return () => controller.abort();
}
