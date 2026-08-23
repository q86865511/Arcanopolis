// 稅收 system：只在日界 tick（tickOfDay===0）動作，依「有工作的居民數」徵收金幣。
// 純資料驅動、不消耗 rng——稅額由就業人數與常數表決定，不涉及隨機性。
//
// 為什麼只對就業居民課稅：金幣是建築成本的共同門檻，若無業居民也繳稅，玩家蓋房增加人口
// 就能穩定生金，生產鏈的安排便與收入脫鉤。綁在就業上，收入才反映「城市真的在運轉」。

import type { EconomyConfig } from '../../data/types';
import { addResource } from '../world/state';
import type { GameState } from '../world/state';
import type { System, SimContext } from '../sim/system';

export function createTaxSystem(config: EconomyConfig): System {
  return {
    id: 'tax',
    update(state: GameState, ctx: SimContext): void {
      if (ctx.time.tickOfDay !== 0) return;

      let employed = 0;
      for (const citizen of state.citizens) {
        if (citizen.job !== null) employed += 1;
      }
      if (employed === 0) return;

      addResource(state, 'gold', employed * config.taxPerEmployedCitizenPerDay);
    },
  };
}
