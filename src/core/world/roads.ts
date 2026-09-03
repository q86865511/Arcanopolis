import type { GameState } from './state';

// 與 save.ts 的 TERRAIN_OVERRIDE_KEY_PATTERN 同義：非負整數且不接受前導零。
const ROAD_KEY_PATTERN = /^(0|[1-9]\d*),(0|[1-9]\d*)$/;

export function roadKey(x: number, y: number): string {
  return `${x},${y}`;
}

export function parseRoadKey(key: string): { x: number; y: number } | null {
  const match = ROAD_KEY_PATTERN.exec(key);
  if (match === null) return null;
  return { x: Number(match[1]), y: Number(match[2]) };
}

export function hasRoad(state: GameState, x: number, y: number): boolean {
  // 數字座標產生的鍵不會撞原型成員，仍比照 state.ts 資源 helper 與 terrain.ts ownOverride。
  return Object.prototype.hasOwnProperty.call(state.roads, roadKey(x, y));
}

export function placeRoad(state: GameState, x: number, y: number): boolean {
  if (
    !Number.isInteger(x) ||
    !Number.isInteger(y) ||
    x < 0 ||
    y < 0 ||
    x >= state.worldSize ||
    y >= state.worldSize ||
    hasRoad(state, x, y)
  ) {
    return false;
  }

  // 不驗地形：terrainGeneratorVersion 升版後同格可能變水；追溯拒收會讓原本合法的存檔變壞檔。
  state.roads[roadKey(x, y)] = 1;
  return true;
}

export function removeRoad(state: GameState, x: number, y: number): boolean {
  if (!hasRoad(state, x, y)) return false;
  delete state.roads[roadKey(x, y)];
  return true;
}

export function roadCount(state: GameState): number {
  return Object.keys(state.roads).length;
}

export function roadTiles(state: GameState): { x: number; y: number }[] {
  return Object.keys(state.roads).map((key) => parseRoadKey(key)!);
}
