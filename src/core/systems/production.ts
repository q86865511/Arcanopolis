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

/**
 * 居民是否站在該建築的佔格上。座標採精確相等：movement 前進時把座標正規化到 0.1 網格，
 * 且剩餘距離 <= SPEED 時直接貼齊格中心，因此「已抵達」必然是精確值——這與 movement 自己
 * 判斷「已在目標格」用的是同一個條件，兩邊不會對同一個居民有不同看法。
 */
function isAtWorkplace(
  citizen: { x: number; y: number },
  building: { x: number; y: number },
  def: BuildingDef,
): boolean {
  for (const tile of footprintTiles(building.x, building.y, def.size.w, def.size.h)) {
    if (citizen.x === tile.x && citizen.y === tile.y) return true;
  }
  return false;
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

      // 各建築目前在職數：只計入「已經走到工作地」的 citizen。
      //
      // 為什麼要看座標而不是只看 job：被指派到工作不等於人在現場。居民每天上半日往工作地走、
      // 下半日返家（見 movement system），若只數 job，一名還在路上的居民就已經讓建築滿產能運轉，
      // 走路動畫變成純裝飾，通勤距離也完全不影響產出。到崗才算數之後，
      // 有效工時＝上半日扣掉通勤時間，佈局遠近才真正影響經濟。
      //
      // 重複 building id 一律保留陣列中第一筆，與 jobs/movement 的解析一致。
      const buildingById = new Map<string, (typeof state.buildings)[number]>();
      for (const building of state.buildings) {
        if (!buildingById.has(building.id)) buildingById.set(building.id, building);
      }
      const employed = new Map<string, number>();
      for (const citizen of state.citizens) {
        if (citizen.job === null) continue;
        const workplace = buildingById.get(citizen.job);
        if (workplace === undefined) continue; // job 懸空：交給 jobs system 於下一 tick 重設
        const def = defsByType.get(workplace.type);
        if (def === undefined) continue;
        if (!isAtWorkplace(citizen, workplace, def)) continue;
        employed.set(citizen.job, (employed.get(citizen.job) ?? 0) + 1);
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

        // 產出改為整批入帳（M4.5-W2）：每 tick 照常按 jobRatio/inputRatio/地形實產算出
        // 「這一 tick 做了多少」，但不直接進資源池，而是累積成工時進度；滿一批才一次產出。
        //
        // 進度增量以「實產／滿載名目產量」表示，因此一 tick 最多前進 1，一批至少要
        // workTicks 個 tick。原料與地形仍逐 tick 扣除，所以中斷不會浪費已投入的資源、
        // 也不會發生「做完整批才發現沒料」；平均產率與逐 tick 產出時完全相同。
        const outputEntries = Object.entries(def.production);
        const nominalPerTick = outputEntries.reduce((sum, [, amount]) => sum + amount, 0);
        // 逐產出項各自算實產（地形建築要各自扣地形），不合併後再分攤——
        // 合併分攤會讓多產出建築的各項比例被抹平，與分批前的行為不一致。
        const actuals: number[] = [];
        let terrainBlocked = false;
        let totalDesired = 0;
        let totalActual = 0;
        for (const [index, [, amount]] of outputEntries.entries()) {
          const desired = amount * jobRatio * inputRatio;
          totalDesired += desired;
          if (def.terrain?.consumes === undefined) {
            actuals[index] = desired;
            totalActual += desired;
            continue;
          }

          const source = findTerrainSource(state, def, building.x, building.y, economy);
          if (source === null) {
            actuals[index] = 0;
            terrainBlocked = true;
            continue;
          }

          const actual = consumeTerrainResource(state, source.x, source.y, desired, economy);
          actuals[index] = actual;
          totalActual += actual;
          if (actual <= 0) continue;

          if (getTerrainResource(state, source.x, source.y, economy) === 0) {
            state.terrainOverrides[`${source.x},${source.y}`].depletedDay = ctx.time.totalDay;
          }
        }

        // 未宣告 workTicks ＝ 不分批：照舊逐 tick 把（可能是分數的）實產直接入帳。
        // 一批多長屬於各建築的設計數值，依資料驅動鐵則寫在 datauildings.json，
        // 程式端不預設一個「大家都分批」的常數。
        const workTicks = def.workTicks;
        if (workTicks === undefined) {
          for (const [index, [resourceId]] of outputEntries.entries()) {
            if (actuals[index] > 0) addResource(state, resourceId, actuals[index]);
          }
        } else if (nominalPerTick > 0) {
          // 進度上限夾在一批：存檔可能帶進超出範圍的值（手改存檔，或資料表把 workTicks 調小後
          // 載入舊檔），不夾住的話每個 tick 都會結算一批，等於憑空印資源。
          const prior = Math.min(Math.max(building.progress ?? 0, 0), workTicks);
          const progress = prior + totalActual / nominalPerTick;
          building.progress = progress;
          if (progress >= workTicks) {
            building.progress = progress - workTicks;
            for (const [resourceId, amount] of outputEntries) {
              addResource(state, resourceId, amount * workTicks);
            }
          } else if (progress > 0 && terrainBlocked) {
            // 地形資源採乾了（找不到任何可用來源），而且不會自己回來（森林再生要數天）。
            // 把未完成的進度按比例結算出去並歸零：那些樹已經砍掉了，若一直留在進度裡等一批
            // 湊滿，玩家會看到「最後幾棵樹憑空消失」——那是資源被吃掉，不是還沒做完。
            //
            // 判定只看「地形有沒有被擋住」，不再附帶在崗率與原料是否充足的條件：
            // 那兩者為 0 時同樣採不到地形，卻會讓已挖出的量永遠卡在進度裡出不來。
            building.progress = 0;
            for (const [resourceId, amount] of outputEntries) {
              addResource(state, resourceId, amount * progress);
            }
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
