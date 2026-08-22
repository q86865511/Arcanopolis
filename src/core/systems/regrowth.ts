// 森林再生 system：只在日界檢查已耗盡的原生森林，不使用 rng。

import type { System } from '../sim/system';
import { baseTerrainAt } from '../world/terrain';
import type { TerrainEconomy } from '../../data/types';

export function createRegrowthSystem(economy: TerrainEconomy): System {
  if (!Number.isInteger(economy.forestRegrowDays) || economy.forestRegrowDays <= 0) {
    throw new Error(
      `createRegrowthSystem: forestRegrowDays 必須是正整數，收到 ${JSON.stringify(economy.forestRegrowDays)}`,
    );
  }

  return {
    id: 'regrowth',
    update(state, ctx): void {
      if (ctx.time.tickOfDay !== 0) return;

      for (const [key, override] of Object.entries(state.terrainOverrides)) {
        if (
          override.type !== 'grass' ||
          override.resource !== 0 ||
          override.depletedDay === undefined ||
          ctx.time.totalDay - override.depletedDay < economy.forestRegrowDays
        ) {
          continue;
        }

        const separator = key.indexOf(',');
        const x = Number(key.slice(0, separator));
        const y = Number(key.slice(separator + 1));
        if (!Number.isInteger(x) || !Number.isInteger(y)) continue;
        if (baseTerrainAt(state.worldSeed, state.worldSize, x, y) !== 'forest') continue;

        delete state.terrainOverrides[key];
      }
    },
  };
}
