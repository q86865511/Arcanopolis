import { describe, expect, it } from 'vitest';
import { createDefaultSystems, type SystemStackConfig } from '../../src/core/sim/systemStack';

function config(): SystemStackConfig {
  return {
    buildingDefs: [],
    terrainEconomy: {
      forestWoodCapacity: 100,
      rockStoneCapacity: 100,
      forestRegrowDays: 10,
    },
    populationConfig: {
      foodPerCitizenPerDay: 1,
      growthPerDay: 1,
      growthFoodReserveDays: 1,
      starvationDeathsPerDay: 1,
      maxCommuteDistance: 24,
    },
    economyConfig: {
      taxPerEmployedCitizenPerDay: 1,
      marketBuyMarkup: 0.25,
    },
    bounds: { w: 20, h: 20 },
  };
}

describe('createDefaultSystems', () => {
  it('回傳固定順序的 6 個 system', () => {
    expect(createDefaultSystems(config()).map((system) => system.id)).toEqual([
      'jobs',
      'production',
      'population',
      'tax',
      'regrowth',
      'movement',
    ]);
  });

  it('每次呼叫都建立新陣列與新 system 實例', () => {
    const sharedConfig = config();
    const first = createDefaultSystems(sharedConfig);
    const second = createDefaultSystems(sharedConfig);

    expect(first).not.toBe(second);
    for (let index = 0; index < first.length; index += 1) {
      expect(first[index]).not.toBe(second[index]);
    }
  });
});
