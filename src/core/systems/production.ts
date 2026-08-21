// 生產 system：每 tick 依 state.buildings 的 type 對應 BuildingDef.production 累加資源。
// 純資料驅動、不消耗 rng——生產量由資料表決定，不涉及隨機性。

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
      for (const building of state.buildings) {
        const def = defsByType.get(building.type)!;
        for (const [resourceId, amount] of Object.entries(def.production)) {
          addResource(state, resourceId, amount);
        }
      }
    },
  };
}
