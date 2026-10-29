import type { Model, Plugin } from "@opencode/plugin";
import { type KiloRawModel } from "../models.js";
import type { KiloState } from "./state.js";
type V2Model = Model.Info;
/** Maps a raw Kilo model into a v2 `Model.Info`; all branded-type casts live here. */
export declare function toV2Model(raw: KiloRawModel): V2Model;
export declare function registerProvider(ctx: Pick<Plugin.Context, "provider" | "session">, state: KiloState): Promise<void>;
export {};
