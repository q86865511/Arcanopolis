// GameState：純資料（可 JSON round-trip），不含任何方法或類別實例——存檔即序列化本物件。

import { createRng } from '../sim/rng';

export interface Building {
  id: string;
  type: string;
  /** 格座標 */
  x: number;
  y: number;
}

export interface GameState {
  tick: number;
  /** RNG 目前狀態，每 tick 由 Simulation 寫回，使存檔可完整還原隨機序列 */
  rngState: number;
  resources: Record<string, number>;
  buildings: Building[];
}

export function createInitialState(seed: number): GameState {
  return {
    tick: 0,
    rngState: createRng(seed).getState(),
    resources: {},
    buildings: [],
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
