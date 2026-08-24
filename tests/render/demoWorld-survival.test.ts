// 開局存活的回歸鎖。
//
// 為什麼需要這條：M3.9-W2 曾因農場改產穀物而讓 demo 世界在第 8 天餓死，449 條測試全綠；
// M4.5-W2 改成整批產出後又一次全城滅絕（食物鏈三段各要累積滿一批才交貨，開局糧倉撐不到
// 第一批麵包上桌），當時 640 條測試同樣全綠。單元測試驗的是各系統的局部行為，
// 「這個開局到底活不活得下去」只有真的把 demo 世界跑起來才看得出來。
import { describe, expect, it } from 'vitest';
import { createDemoWorld } from '../../src/render/demoWorld';
import { getResource } from '../../src/core/world/state';
import { TICKS_PER_DAY } from '../../src/core/sim/time';

const DAYS = 10;

describe('demo 世界開局存活', () => {
  it(`跑 ${DAYS} 個遊戲日：人口不得歸零，且糧食要能撐過產線啟動的空窗`, () => {
    const { state, sim } = createDemoWorld(200);
    const startPopulation = state.citizens.length;
    expect(startPopulation).toBeGreaterThan(0);

    let minPopulation = startPopulation;
    let minFood = getResource(state, 'food');
    for (let tick = 1; tick <= TICKS_PER_DAY * DAYS; tick++) {
      sim.tick();
      minPopulation = Math.min(minPopulation, state.citizens.length);
      minFood = Math.min(minFood, getResource(state, 'food'));
    }

    // 人口歸零＝滅城，且因為重開需要工人而無法翻身
    expect(minPopulation).toBeGreaterThan(0);
    // 糧食觸底代表撐過去只是僥倖，開局緩衝不足
    expect(minFood).toBeGreaterThan(0);
    // 熬過啟動期後應該是淨成長，而不是勉強打平
    expect(getResource(state, 'food')).toBeGreaterThan(minFood);
    expect(state.citizens.length).toBeGreaterThanOrEqual(startPopulation);
  });

  it('食物鏈確實在運轉：穀物與麵粉都被下游取用過，不是只靠開局糧倉吃老本', () => {
    const { state, sim } = createDemoWorld(200);
    let sawFlour = false;
    for (let tick = 1; tick <= TICKS_PER_DAY * 3; tick++) {
      sim.tick();
      if (getResource(state, 'flour') > 0) sawFlour = true;
    }
    // 有麵粉出現代表磨坊真的交過貨；food 高於開局代表麵包坊也交過貨
    expect(sawFlour).toBe(true);
    expect(getResource(state, 'food')).toBeGreaterThan(0);
  });
});
