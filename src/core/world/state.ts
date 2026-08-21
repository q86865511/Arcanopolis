// GameState：純資料（可 JSON round-trip），不含任何方法或類別實例——存檔即序列化本物件。

import { createRng } from '../sim/rng';
import type { Command } from '../sim/commands';

/** 存檔格式版本。新增/變更欄位時遞增，並在 src/core/save/save.ts 補對應 Migration。 */
export const SAVE_SCHEMA_VERSION = 1;

export interface Building {
  id: string;
  type: string;
  /** 格座標 */
  x: number;
  y: number;
}

export interface GameState {
  schemaVersion: number;
  tick: number;
  /** RNG 目前狀態，每 tick 由 Simulation 寫回，使存檔可完整還原隨機序列 */
  rngState: number;
  resources: Record<string, number>;
  buildings: Building[];
  /** 尚未套用的指令佇列，隨 state 一併存檔，避免存檔遺失 pending 指令 */
  pendingCommands: Command[];
}

export function createInitialState(seed: number): GameState {
  return {
    schemaVersion: SAVE_SCHEMA_VERSION,
    tick: 0,
    rngState: createRng(seed).getState(),
    resources: {},
    buildings: [],
    pendingCommands: [],
  };
}

// resources 是 plain object，資源 id 可能與 Object.prototype 成員同名（constructor、__proto__…）：
// 直接索引會讀到繼承值或觸發 __proto__ setter。所有讀寫一律走以下 helper（own-property 語義）。

export function getResource(state: GameState, id: string): number {
  return Object.prototype.hasOwnProperty.call(state.resources, id) ? state.resources[id] : 0;
}

export function addResource(state: GameState, id: string, amount: number): void {
  if (!Number.isFinite(amount)) {
    throw new Error(`addResource: amount 必須是有限數值，收到 ${amount}`);
  }
  Object.defineProperty(state.resources, id, {
    value: getResource(state, id) + amount,
    enumerable: true,
    writable: true,
    configurable: true,
  });
}
