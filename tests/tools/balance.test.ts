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
    // 基準重訂於 2026-08-24：修掉腳本玩家的建址缺陷後（見 balance.ts 的 findBuildSite），
    // 曲線與修正前完全不同——舊基準量到的是「多數建築沒人到得了」的假象。
    // 實測值：人口 36、建築 27、最低糧食 1080、金幣峰值 1165、中間產物峰值 10948、回落 5 次。
    expect(finalState.citizens.length).toBeGreaterThan(0);
    expect(finalState.citizens.length).toBeGreaterThanOrEqual(25);
    expect(finalState.citizens.length).toBeLessThanOrEqual(47);
    expect(Math.min(...foodValues)).toBeGreaterThanOrEqual(750);
    expect(Math.min(...foodValues)).toBeLessThanOrEqual(1_410);
    expect(longestZeroFoodStreak(samples)).toBe(0);
    expect(Math.max(...goldValues)).toBeGreaterThanOrEqual(815);
    expect(Math.max(...goldValues)).toBeLessThanOrEqual(1_515);
    expect(Math.max(...foodIntermediates)).toBeGreaterThanOrEqual(7_660);
    expect(Math.max(...foodIntermediates)).toBeLessThanOrEqual(14_240);
    expect(intermediateDecreases).toBeGreaterThanOrEqual(3);
    expect(intermediateDecreases).toBeLessThanOrEqual(9);
    expect(finalState.buildings.length).toBeGreaterThan(6);
    expect(finalState.buildings.length).toBeGreaterThanOrEqual(19);
    expect(finalState.buildings.length).toBeLessThanOrEqual(36);

    // 建址修正的回歸鎖：石材與鐵礦在 30 天內必須真的被生產出來。
    // 修正前這兩條產線的建築都蓋在通勤範圍外，永遠沒人到得了，石材第 27 天歸零、
    // 鐵礦全程為 0——當時卻被誤讀成「資料表的數值需要調整」。
    expect(finalState.resources.stone).toBeGreaterThan(0);
    expect(finalState.resources['iron-ore']).toBeGreaterThan(0);
  });
});
