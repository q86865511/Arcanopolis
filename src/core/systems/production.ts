// 生產 system：每 tick 依 state.buildings 的 type 對應 BuildingDef.production 累加資源，
// 產出乘以在職率（def.jobs===0 視為 1，否則為 min(在職人數, jobs) / jobs）。
// 純資料驅動、不消耗 rng——生產量由資料表與在職人數決定，不涉及隨機性。

import type { BuildingDef } from '../../data/types';
import { addResource } from '../world/state';
import type { GameState } from '../world/state';
import type { System, SimContext } from '../sim/system';

export function createProductionSystem(defs: BuildingDef[]): System {
  const defsByType = new Map<string, BuildingDef>(defs.map((def) => [def.id, def]));

  return {
    id: 'production',
    update(state: GameState, _ctx: SimContext): void {
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
          addResource(state, resourceId, amount * ratio);
        }
      }
    },
  };
}
