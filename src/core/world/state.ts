// GameState：純資料（可 JSON round-trip），不含任何方法或類別實例——存檔即序列化本物件。

import { createRng } from '../sim/rng';
import type { Command } from '../sim/commands';
import { TERRAIN_GENERATOR_VERSION, type TerrainOverride } from './terrain';

/** 存檔格式版本。新增/變更欄位時遞增，並在 src/core/save/save.ts 補對應 Migration。 */
export const SAVE_SCHEMA_VERSION = 5;

/** 世界邊長（格）預設值。地形本身不進存檔——由 worldSeed + worldSize 程序生成，
 *  只有玩家改動過的格子記在 terrainOverrides，故放大世界不會放大存檔。 */
export const DEFAULT_WORLD_SIZE = 200;

export interface Building {
  id: string;
  type: string;
  /** 格座標 */
  x: number;
  y: number;
  /**
   * 本批生產的累積工時（tick 為單位）。滿 def.workTicks 時整批產出並扣掉該值。
   * 省略等同 0——存為選填讓 v4 舊檔不必補欄即可載入，也讓不生產的建築不必帶這個欄位。
   */
  progress?: number;
}

export interface Citizen {
  id: string;
  /** 居住建築的 Building.id */
  home: string;
  /** 工作建築的 Building.id；失業為 null */
  job: string | null;
  /** 世界座標（非格座標），可為浮點數——居民在格與格之間移動 */
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
  citizens: Citizen[];
  /** 尚未套用的指令佇列，隨 state 一併存檔，避免存檔遺失 pending 指令 */
  pendingCommands: Command[];
  /** 地形生成用的 seed，與 rngState 分開——rngState 每 tick 都變，地形必須整局不變 */
  worldSeed: number;
  /** 世界邊長（格）：世界為 worldSize × worldSize 的方形，範圍外一律視為海 */
  worldSize: number;
  /** 玩家改動過的格子，鍵為 `${x},${y}`；未列出的格子由 baseTerrainAt 即時算出 */
  terrainOverrides: Record<string, TerrainOverride>;
  /** 存檔當下的地形演算法版本（見 terrain.ts 的 TERRAIN_GENERATOR_VERSION） */
  terrainGeneratorVersion: number;
}

export function createInitialState(seed: number): GameState {
  // hashNoise/mulberry32 皆以 32 位元整數運算：負 seed 是其 uint32 別名
  // （baseTerrainAt(-5,...) === baseTerrainAt(4294967291,...)）。正規化成 uint32，
  // 使 worldSeed 恆落在 deserializeGameState 要求的 0~4294967295 範圍內，
  // 而不改變地形/RNG 序列本身的結果。
  const normalizedSeed = seed >>> 0;
  return {
    schemaVersion: SAVE_SCHEMA_VERSION,
    tick: 0,
    rngState: createRng(normalizedSeed).getState(),
    resources: {},
    buildings: [],
    citizens: [],
    pendingCommands: [],
    worldSeed: normalizedSeed,
    worldSize: DEFAULT_WORLD_SIZE,
    terrainOverrides: {},
    terrainGeneratorVersion: TERRAIN_GENERATOR_VERSION,
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
