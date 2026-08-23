import { describe, expect, it } from 'vitest';
import populationJson from '../../data/population.json';
import { TICKS_PER_DAY } from '../../src/core/sim/time';
import { parsePopulationConfig } from '../../src/data/loader';

// 與 movement system 的居民速度契約一致；理論值必須由速度與半日 tick 預算推導。
const SPEED = 0.1;

describe('population maxCommuteDistance', () => {
  it('嚴格小於半日直線移動的理論極限', () => {
    const config = parsePopulationConfig(populationJson);
    const theoreticalCommuteLimit = SPEED * (TICKS_PER_DAY / 2);

    expect(config.maxCommuteDistance).toBe(24);
    expect(config.maxCommuteDistance).toBeLessThan(theoreticalCommuteLimit);
  });

  it.each([0, -1, 1.5])('非正整數 %s 會被 loader 拒絕', (maxCommuteDistance) => {
    expect(() =>
      parsePopulationConfig({ ...populationJson, maxCommuteDistance }),
    ).toThrow(/maxCommuteDistance/);
  });
});
