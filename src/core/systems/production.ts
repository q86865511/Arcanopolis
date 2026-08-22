// 生產 system：每 tick 依 state.buildings 的 type 對應 BuildingDef.production 累加資源。
// 原料先按全體消費者的名目需求比例分配，再依 jobRatio、inputRatio 與地形實產比例扣料；
// 因分配係數固定於 tick 開頭計算，結果不受建築陣列先後順序影響。
// 純資料驅動、不消耗 rng——生產量由資料表與在職人數決定，不涉及隨機性。

import type { BuildingDef, TerrainEconomy } from '../../data/types';
import { addResource, getResource } from '../world/state';
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

      // 同一 tick 先彙總所有消費者的名目需求。供給不足時，同資源的每位消費者共用
      // supply/totalDemand 係數；多原料建築再取其中最嚴格者，避免先擺放者吃光庫存。
      const jobRatios: number[] = [];
      const totalDemandByResource = new Map<string, number>();
      for (const [index, building] of state.buildings.entries()) {
        const def = defsByType.get(building.type)!;
        const jobRatio = def.jobs === 0 ? 1 : Math.min(employed.get(building.id) ?? 0, def.jobs) / def.jobs;
        jobRatios[index] = jobRatio;
        for (const [resourceId, amount] of Object.entries(def.inputs ?? {})) {
          const nominalDemand = amount * jobRatio;
          totalDemandByResource.set(
            resourceId,
            (totalDemandByResource.get(resourceId) ?? 0) + nominalDemand,
          );
        }
      }

      const allocationByResource = new Map<string, number>();
      for (const [resourceId, totalDemand] of totalDemandByResource) {
        const availableRatio = totalDemand === 0 ? 1 : getResource(state, resourceId) / totalDemand;
        allocationByResource.set(resourceId, Math.min(Math.max(availableRatio, 0), 1));
      }

      for (const [index, building] of state.buildings.entries()) {
        const def = defsByType.get(building.type)!;
        const jobRatio = jobRatios[index];
        const inputEntries = Object.entries(def.inputs ?? {});
        let inputRatio = 1;
        for (const [resourceId] of inputEntries) {
          inputRatio = Math.min(inputRatio, allocationByResource.get(resourceId) ?? 1);
        }

        const outputEntries = Object.entries(def.production);
        let totalDesired = 0;
        let totalActual = 0;
        for (const [resourceId, amount] of outputEntries) {
          const desired = amount * jobRatio * inputRatio;
          totalDesired += desired;
          if (def.terrain?.consumes === undefined) {
            addResource(state, resourceId, desired);
            totalActual += desired;
            continue;
          }

          const source = findTerrainSource(state, def, building.x, building.y, economy);
          if (source === null) continue;

          const actual = consumeTerrainResource(state, source.x, source.y, desired, economy);
          totalActual += actual;
          if (actual <= 0) continue;
          addResource(state, resourceId, actual);

          if (getTerrainResource(state, source.x, source.y, economy) === 0) {
            state.terrainOverrides[`${source.x},${source.y}`].depletedDay = ctx.time.totalDay;
          }
        }

        // 純消耗型建築（production 為空）仍會正常扣料；有產出欄位時則按「總實產／總名目」
        // 加權，避免多產出建築只成功一小項卻扣滿全部 inputs。名目產出為 0 時不扣料。
        const actualRatio = outputEntries.length === 0
          ? 1
          : totalDesired === 0
            ? 0
            : Math.min(Math.max(totalActual / totalDesired, 0), 1);
        for (const [resourceId, amount] of inputEntries) {
          const consumption = amount * jobRatio * inputRatio * actualRatio;
          // 浮點乘除可能讓 consumption 比庫存多數個 ulp；此 clamp 是資源非負不變量的最後防線。
          addResource(state, resourceId, -Math.min(getResource(state, resourceId), consumption));
        }
      }
    },
  };
}
