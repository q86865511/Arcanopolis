import { describe, expect, it } from 'vitest';
import {
  createBalanceWorld,
  playerStrategy,
  runBalanceSimulation,
  type BalanceSample,
} from '../../src/tools/balance';

function longestZeroFoodStreak(samples: BalanceSample[]): number {
  let longest = 0;
  let current = 0;
  for (const sample of samples) {
    current = sample.resources.food === 0 ? current + 1 : 0;
    longest = Math.max(longest, current);
  }
  return longest;
}

const firstRun = runBalanceSimulation({ seed: 1, days: 30 });
const secondRun = runBalanceSimulation({ seed: 1, days: 30 });

describe('自動化平衡模擬', () => {
  it('玩家策略是只讀且決定論的純函式', () => {
    const { state } = createBalanceWorld(17);
    const before = structuredClone(state);

    expect(playerStrategy(state)).toEqual(playerStrategy(state));
    expect(state).toEqual(before);
  });

  it('同 seed 與策略跑兩次會得到完全相同的最終 state', () => {
    expect(secondRun.finalState).toEqual(firstRun.finalState);
  });

  it('30 天曲線留在現況目標帶內', () => {
    const { finalState, samples } = firstRun;
    const foodValues = samples.map((sample) => sample.resources.food);
    const goldValues = samples.map((sample) => sample.resources.gold);
    const foodIntermediates = samples.map((sample) => sample.resources.grain + sample.resources.flour);
    const intermediateDecreases = foodIntermediates
      .slice(1)
      .filter((value, index) => value < foodIntermediates[index]).length;

    // 這條帶是描述現況的護欄，不是設計目標；資料表變動造成約 30% 以上偏移時應立即報警。
    expect(finalState.citizens.length).toBeGreaterThan(0);
    expect(finalState.citizens.length).toBeGreaterThanOrEqual(25);
    expect(finalState.citizens.length).toBeLessThanOrEqual(47);
    expect(Math.min(...foodValues)).toBeGreaterThanOrEqual(750);
    expect(Math.min(...foodValues)).toBeLessThanOrEqual(1_410);
    expect(longestZeroFoodStreak(samples)).toBe(0);
    expect(Math.max(...goldValues)).toBeGreaterThanOrEqual(116);
    expect(Math.max(...goldValues)).toBeLessThanOrEqual(216);
    expect(Math.max(...foodIntermediates)).toBeGreaterThanOrEqual(7_400);
    expect(Math.max(...foodIntermediates)).toBeLessThanOrEqual(13_850);
    expect(intermediateDecreases).toBeGreaterThanOrEqual(5);
    expect(intermediateDecreases).toBeLessThanOrEqual(11);
    expect(finalState.buildings.length).toBeGreaterThan(6);
    expect(finalState.buildings.length).toBeGreaterThanOrEqual(31);
    expect(finalState.buildings.length).toBeLessThanOrEqual(58);
  });
});
