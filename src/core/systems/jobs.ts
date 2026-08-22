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
      const buildingsById = new Map(state.buildings.map((b) => [b.id, b]));

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

      // 依 citizens 陣列序指派待業者，各自依 buildings 陣列序找第一個有空缺的建築
      for (const citizen of state.citizens) {
        if (citizen.job !== null) continue;
        for (const building of state.buildings) {
          const capacity = defsByType.get(building.type)?.jobs ?? 0;
          const current = occupancy.get(building.id) ?? 0;
          if (current < capacity) {
            citizen.job = building.id;
            occupancy.set(building.id, current + 1);
            break;
          }
        }
      }
    },
  };
}
