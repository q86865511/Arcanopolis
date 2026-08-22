// 職業指派 system：每 tick 把待業（job===null）的 citizen 指派到有空缺的建築。
// 純資料驅動、不消耗 rng——指派順序由 citizens/buildings 陣列序決定，不涉及隨機性。

import type { BuildingDef } from '../../data/types';
import type { GameState } from '../world/state';
import type { System, SimContext } from '../sim/system';

export function createJobsSystem(defs: BuildingDef[]): System {
  const defsByType = new Map<string, BuildingDef>(defs.map((def) => [def.id, def]));

  return {
    id: 'jobs',
    update(state: GameState, _ctx: SimContext): void {
      // 重複 building id 一律保留陣列中第一筆，與 movement 的導航目標解析一致。
      const buildingsById = new Map<string, (typeof state.buildings)[number]>();
      for (const building of state.buildings) {
        if (!buildingsById.has(building.id)) buildingsById.set(building.id, building);
      }

      // home 指向不存在的建築 → citizen 整個移除
      state.citizens = state.citizens.filter((c) => buildingsById.has(c.home));

      // job 指向不存在的建築 → 重設為 null，讓下方指派迴圈重新分配
      for (const citizen of state.citizens) {
        if (citizen.job !== null && !buildingsById.has(citizen.job)) {
          citizen.job = null;
        }
      }

      // 各建築目前在職數（含既有在職者），並在此順道處理超額釋放：
      // 建築的 def.jobs 被資料表調降（含調成 0）或存檔異常導致在職數超過容量時，
      // 依 citizens 陣列序只保留前 def.jobs 名，其餘釋放回待業池（job 設 null），
      // 讓下方指派迴圈或下次 update 有機會把他們填進別的空缺。
      const occupancy = new Map<string, number>();
      for (const citizen of state.citizens) {
        if (citizen.job === null) continue;
        const building = buildingsById.get(citizen.job)!;
        const capacity = defsByType.get(building.type)?.jobs ?? 0;
        const current = occupancy.get(citizen.job) ?? 0;
        if (current >= capacity) {
          citizen.job = null;
          continue;
        }
        occupancy.set(citizen.job, current + 1);
      }

      // 依 citizens 陣列序指派待業者；選離 home 最近的空缺，距離相同時保留 buildings 陣列序。
      for (const citizen of state.citizens) {
        if (citizen.job !== null) continue;
        const home = buildingsById.get(citizen.home)!;
        let nearestBuildingId: string | null = null;
        let nearestDistance = Infinity;
        for (const building of buildingsById.values()) {
          const capacity = defsByType.get(building.type)?.jobs ?? 0;
          const current = occupancy.get(building.id) ?? 0;
          if (current >= capacity) continue;
          // 這是直線 Manhattan 估算，不考慮障礙；實際可達性由 movement 的有界搜尋負責。
          const distance = Math.abs(home.x - building.x) + Math.abs(home.y - building.y);
          if (distance >= nearestDistance) continue;
          nearestBuildingId = building.id;
          nearestDistance = distance;
        }
        if (nearestBuildingId !== null) {
          citizen.job = nearestBuildingId;
          occupancy.set(nearestBuildingId, (occupancy.get(nearestBuildingId) ?? 0) + 1);
        }
      }
    },
  };
}
