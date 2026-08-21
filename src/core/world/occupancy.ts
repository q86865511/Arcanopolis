// 佔格工具：建築 footprint 的格清單計算，與範圍是否自由（無與既有建築重疊）的判定。

import type { GameState } from './state';
import type { BuildingDef } from '../../data/types';

export interface Tile {
  x: number;
  y: number;
}

/** footprint 面積上限：防 OOM 的最後一道防線——即使呼叫端繞過 loader.ts 的 size 上限
 *  （如測試 fixture、未來的直接呼叫），這裡仍擋住誇張面積撐爆記憶體。 */
const MAX_FOOTPRINT_AREA = 1024;

/** 回傳以 (x,y) 為左上角、寬 w、高 h 的 footprint 涵蓋的格清單 */
export function footprintTiles(x: number, y: number, w: number, h: number): Tile[] {
  if (!Number.isInteger(w) || !Number.isInteger(h) || w <= 0 || h <= 0) {
    throw new Error(`footprintTiles: w/h 必須是正整數，收到 w=${JSON.stringify(w)}, h=${JSON.stringify(h)}`);
  }
  if (w * h > MAX_FOOTPRINT_AREA) {
    throw new Error(`footprintTiles: w*h 不可超過 ${MAX_FOOTPRINT_AREA}，收到 w=${w}, h=${h}`);
  }
  const tiles: Tile[] = [];
  for (let dy = 0; dy < h; dy++) {
    for (let dx = 0; dx < w; dx++) {
      tiles.push({ x: x + dx, y: y + dy });
    }
  }
  return tiles;
}

/** 給定的格清單是否與 state.buildings 中任何既有建築的 footprint 重疊；defs 用於查既有建築的 size */
export function isAreaFree(state: GameState, tiles: Tile[], defs: BuildingDef[]): boolean {
  const tileSet = new Set(tiles.map((t) => `${t.x},${t.y}`));
  for (const building of state.buildings) {
    const def = defs.find((d) => d.id === building.type);
    const size = def ? def.size : { w: 1, h: 1 };
    for (const occupied of footprintTiles(building.x, building.y, size.w, size.h)) {
      if (tileSet.has(`${occupied.x},${occupied.y}`)) {
        return false;
      }
    }
  }
  return true;
}
