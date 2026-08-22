// 生產 system：每 tick 依 state.buildings 的 type 對應 BuildingDef.production 累加資源，
// 產出乘以在職率（def.jobs===0 視為 1，否則為 min(在職人數, jobs) / jobs）。
// 純資料驅動、不消耗 rng——生產量由資料表與在職人數決定，不涉及隨機性。

import type { BuildingDef, TerrainEconomy } from '../../data/types';
import { addResource } from '../world/state';
import type { GameState } from '../world/state';
import type { System, SimContext } from '../sim/system';
import { footprintTiles } from '../world/occupancy';
import {
  consumeTerrainResource,
  DEFAULT_TERRAIN_ECONOMY,
  getTerrainResource,
  terrainAt,
  type TerrainType,
} from '../world/terrain';

/** 與 movement.ts 相同的固定順序：北、東、南、西。 */
const TERRAIN_SOURCE_OFFSETS: ReadonlyArray<readonly [number, number]> = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
];

interface TerrainSource {
  x: number;
  y: number;
}

function isUsableSource(
  state: GameState,
  x: number,
  y: number,
  allowed: TerrainType[],
  economy: TerrainEconomy,
): boolean {
  return allowed.includes(terrainAt(state, x, y)) && getTerrainResource(state, x, y, economy) > 0;
}

/** 每次產出都重新找來源，耗盡後下一 tick 會自然改採下一格。 */
function findTerrainSource(
  state: GameState,
  def: BuildingDef,
  x: number,
  y: number,
  economy: TerrainEconomy,
): TerrainSource | null {
  const consumedTerrains = def.terrain?.consumes;
  if (consumedTerrains === undefined) return null;

  for (const tile of footprintTiles(x, y, def.size.w, def.size.h)) {
    if (isUsableSource(state, tile.x, tile.y, consumedTerrains, economy)) {
      return tile;
    }
  }

  for (const [dx, dy] of TERRAIN_SOURCE_OFFSETS) {
    const sourceX = x + dx;
    const sourceY = y + dy;
    if (isUsableSource(state, sourceX, sourceY, consumedTerrains, economy)) {
      return { x: sourceX, y: sourceY };
    }
  }
  return null;
}

export function createProductionSystem(
  defs: BuildingDef[],
  economy: TerrainEconomy = DEFAULT_TERRAIN_ECONOMY,
): System {
  const defsByType = new Map<string, BuildingDef>(defs.map((def) => [def.id, def]));

  return {
    id: 'production',
    update(state: GameState, ctx: SimContext): void {
      // 兩段式：先全量檢查再套用產出，未知 type 在任何資源入帳前就 fail fast，不留半套用的撕裂狀態。
      for (const building of state.buildings) {
        if (!defsByType.has(building.type)) {
          throw new Error(
            `production system: 建築 "${building.id}" 的 type "${building.type}" 沒有對應的 BuildingDef`,
          );
        }
      }

      // 各建築目前在職數，僅計入 job 指向該建築 id 的 citizen
      const employed = new Map<string, number>();
      for (const citizen of state.citizens) {
        if (citizen.job !== null) {
          employed.set(citizen.job, (employed.get(citizen.job) ?? 0) + 1);
        }
      }

      for (const building of state.buildings) {
        const def = defsByType.get(building.type)!;
        const ratio = def.jobs === 0 ? 1 : Math.min(employed.get(building.id) ?? 0, def.jobs) / def.jobs;
        for (const [resourceId, amount] of Object.entries(def.production)) {
          const nominalAmount = amount * ratio;
          if (def.terrain?.consumes === undefined) {
            addResource(state, resourceId, nominalAmount);
            continue;
          }

          const source = findTerrainSource(state, def, building.x, building.y, economy);
          if (source === null) continue;

          const produced = consumeTerrainResource(state, source.x, source.y, nominalAmount, economy);
          if (produced <= 0) continue;
          addResource(state, resourceId, produced);

          if (getTerrainResource(state, source.x, source.y, economy) === 0) {
            state.terrainOverrides[`${source.x},${source.y}`].depletedDay = ctx.time.totalDay;
          }
        }
      }
    },
  };
}
