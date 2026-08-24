// 建築可建性判定：世界邊界、基礎可建地形、建築地形限制與既有佔格。

import type { BuildingDef } from '../../data/types';
import { footprintTiles, isAreaFree, type Tile } from './occupancy';
import type { GameState } from './state';
import { isBuildable, isWalkable, terrainAt } from './terrain';

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

  if (!isAreaFree(state, tiles, defs)) return false;

  return !wouldTrapAnyBuilding(state, tiles, defs);
}

/**
 * 這次放置會不會把某棟既有建築從「出得來」變成「四面封死」。
 *
 * 格子被建築佔住即不可通行，所以四面都被佔滿的建築等於與世隔絕：住在裡面的居民永遠走不出來，
 * 被指派到那裡的工人也永遠到不了，而「到崗才算數」之後這代表產能恆為 0。
 * 最糟的是畫面上毫無徵兆——建築好端端立在那裡，只是再也沒有人動。
 * 這種一旦造成就無法從遊戲內察覺、也無法復原的狀態，寧可在放置當下就擋下來。
 *
 * 判準刻意是「這次放置造成的變化」而不是「放置後是否封死」：本來就被地形圍住的建築
 * （例如水中央的一格草地）在這條規則之前就蓋得起來，不該因為新增這條規則而追溯變成非法。
 *
 * 只檢查正交四鄰而非完整連通性：完整連通要對整張地圖做搜尋，成本與這條規則要防的實際情境
 * 不成比例——真正會發生的是隨手把房子四周填滿，不是刻意圍出一塊飛地。
 */
function wouldTrapAnyBuilding(state: GameState, placedTiles: Tile[], defs: BuildingDef[]): boolean {
  if (state.buildings.length === 0) return false;

  const occupiedBefore = new Set<string>();
  for (const building of state.buildings) {
    const def = defs.find((candidate) => candidate.id === building.type);
    const size = def ? def.size : { w: 1, h: 1 };
    for (const tile of footprintTiles(building.x, building.y, size.w, size.h)) {
      occupiedBefore.add(`${tile.x},${tile.y}`);
    }
  }
  const occupiedAfter = new Set(occupiedBefore);
  for (const tile of placedTiles) occupiedAfter.add(`${tile.x},${tile.y}`);

  const escapable = (tiles: Tile[], occupied: Set<string>): boolean => {
    const own = new Set(tiles.map((tile) => `${tile.x},${tile.y}`));
    for (const tile of tiles) {
      for (const [dx, dy] of NEAR_OFFSETS) {
        const nx = tile.x + dx;
        const ny = tile.y + dy;
        const key = `${nx},${ny}`;
        if (own.has(key)) continue;
        if (nx < 0 || ny < 0 || nx >= state.worldSize || ny >= state.worldSize) continue;
        if (occupied.has(key)) continue;
        if (isWalkable(terrainAt(state, nx, ny))) return true;
      }
    }
    return false;
  };

  for (const building of state.buildings) {
    const def = defs.find((candidate) => candidate.id === building.type);
    const size = def ? def.size : { w: 1, h: 1 };
    const tiles = footprintTiles(building.x, building.y, size.w, size.h);
    if (escapable(tiles, occupiedBefore) && !escapable(tiles, occupiedAfter)) return true;
  }
  return false;
}
