// 人口 system：只在日界 tick（tickOfDay===0）動作，處理糧食消耗、飢餓致死、人口成長。
// 純資料驅動、不消耗 rng——成長/死亡人數與對象皆由決定論規則決定，不涉及隨機性。

import type { BuildingDef, PopulationConfig } from '../../data/types';
import { addResource, getResource } from '../world/state';
import type { Citizen, GameState } from '../world/state';
import type { System, SimContext } from '../sim/system';

export function createPopulationSystem(defs: BuildingDef[], config: PopulationConfig): System {
  const defsByType = new Map<string, BuildingDef>(defs.map((def) => [def.id, def]));

  return {
    id: 'population',
    update(state: GameState, ctx: SimContext): void {
      if (ctx.time.tickOfDay !== 0) return;

      const available = getResource(state, 'food');
      const needed = state.citizens.length * config.foodPerCitizenPerDay;
      const consumed = Math.min(needed, available);
      addResource(state, 'food', -consumed);

      if (needed > available) {
        // 糧食不足：不足日從陣列尾端餓死 starvationDeathsPerDay 人，本日不成長
        const deaths = Math.min(config.starvationDeathsPerDay, state.citizens.length);
        state.citizens.splice(state.citizens.length - deaths, deaths);
        return;
      }

      // 成長門檻：扣除當日消耗後的剩餘糧食需達 reserve 天數需求。
      // 人口基數至少視為 1 人份——citizens.length===0 時若不設下限，needed 與 reserveRequirement
      // 皆退化為 0，空城會在「憑空生 1 人→隔日餓死→再憑空生 1 人」間無限循環（永遠不會真正滅城）。
      const remaining = available - consumed;
      const reserveRequirement =
        Math.max(1, state.citizens.length) * config.foodPerCitizenPerDay * config.growthFoodReserveDays;
      if (remaining < reserveRequirement) return;

      // 依 buildings 陣列序填滿住房空位，總成長人數上限為 growthPerDay
      let toAdd = config.growthPerDay;
      let seq = 0;
      for (const building of state.buildings) {
        if (toAdd <= 0) break;
        const housing = defsByType.get(building.type)?.housing ?? 0;
        if (housing <= 0) continue;
        let vacancy = housing - state.citizens.filter((c) => c.home === building.id).length;
        while (vacancy > 0 && toAdd > 0) {
          const newCitizen: Citizen = {
            id: `citizen#${state.tick}-${seq}`,
            home: building.id,
            job: null,
            x: building.x,
            y: building.y,
          };
          state.citizens.push(newCitizen);
          seq += 1;
          vacancy -= 1;
          toAdd -= 1;
        }
      }
    },
  };
}
