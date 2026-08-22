// 建築可建性判定：世界邊界、基礎可建地形、建築地形限制與既有佔格。

import type { BuildingDef } from '../../data/types';
import { footprintTiles, isAreaFree } from './occupancy';
import type { GameState } from './state';
import { isBuildable, terrainAt } from './terrain';

/** near 的決定性掃描順序：北、東、南、西。 */
const NEAR_OFFSETS: ReadonlyArray<readonly [number, number]> = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
];

export function canBuildAt(
  state: GameState,
  def: BuildingDef,
  x: number,
  y: number,
  defs: BuildingDef[],
): boolean {
  const tiles = footprintTiles(x, y, def.size.w, def.size.h);

  for (const tile of tiles) {
    if (tile.x < 0 || tile.y < 0 || tile.x >= state.worldSize || tile.y >= state.worldSize) {
      return false;
    }
    const type = terrainAt(state, tile.x, tile.y);
    if (!isBuildable(type)) return false;
    if (def.terrain?.on !== undefined && !def.terrain.on.includes(type)) return false;
  }

  if (def.terrain?.near !== undefined) {
    let matches = false;
    for (const [dx, dy] of NEAR_OFFSETS) {
      if (def.terrain.near.includes(terrainAt(state, x + dx, y + dy))) {
        matches = true;
        break;
      }
    }
    if (!matches) return false;
  }

  return isAreaFree(state, tiles, defs);
}
