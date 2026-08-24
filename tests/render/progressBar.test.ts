// 建築進度條算式（src/render/progressBar.ts）
import { describe, expect, it } from 'vitest';
import { BAR_H, BAR_W, barRect, filledWidth, progressRatio } from '../../src/render/progressBar';
import type { BuildingDef } from '../../src/data/types';

const BATCHED: BuildingDef = {
  id: 'batched',
  name: '分批工坊',
  size: { w: 1, h: 1 },
  cost: {},
  production: { wood: 2 },
  housing: 0,
  jobs: 1,
  workTicks: 50,
};

const CONTINUOUS: BuildingDef = { ...BATCHED, id: 'continuous', workTicks: undefined };
const NO_OUTPUT: BuildingDef = { ...BATCHED, id: 'house', production: {} };

describe('progressRatio', () => {
  it('依 progress／workTicks 換算成 0~1', () => {
    expect(progressRatio({ progress: 0 }, BATCHED)).toBe(0);
    expect(progressRatio({ progress: 25 }, BATCHED)).toBe(0.5);
    expect(progressRatio({ progress: 50 }, BATCHED)).toBe(1);
  });

  it('progress 省略等同 0', () => {
    expect(progressRatio({}, BATCHED)).toBe(0);
  });

  it('超過一批的殘留進度夾在 1，不會畫出超出框的條', () => {
    expect(progressRatio({ progress: 999 }, BATCHED)).toBe(1);
  });

  it('不分批的建築回 null＝不畫條：對它們而言「一批」不存在', () => {
    expect(progressRatio({ progress: 10 }, CONTINUOUS)).toBeNull();
  });

  it('沒有產出的建築（民居、市場）回 null', () => {
    expect(progressRatio({ progress: 10 }, NO_OUTPUT)).toBeNull();
  });

  it('查不到 def 回 null 而不是 throw', () => {
    expect(progressRatio({ progress: 10 }, undefined)).toBeNull();
  });

  it('workTicks 為 0 或負數回 null，不會除以零', () => {
    expect(progressRatio({ progress: 5 }, { ...BATCHED, workTicks: 0 })).toBeNull();
    expect(progressRatio({ progress: 5 }, { ...BATCHED, workTicks: -1 })).toBeNull();
  });
});

describe('barRect', () => {
  it('水平置中於錨點', () => {
    const rect = barRect(100, 200, 0);
    expect(rect.x + rect.w / 2).toBe(100);
    expect(rect.w).toBe(BAR_W);
    expect(rect.h).toBe(BAR_H);
  });

  it('建築越高，條掛得越高（不會壓在建築身上）', () => {
    expect(barRect(100, 200, 80).y).toBeLessThan(barRect(100, 200, 20).y);
  });

  it('座標取整，避免半像素造成閃爍', () => {
    const rect = barRect(100.4, 200.6, 33.3);
    expect(Number.isInteger(rect.x)).toBe(true);
    expect(Number.isInteger(rect.y)).toBe(true);
  });
});

describe('filledWidth', () => {
  it('比例對應到寬度', () => {
    expect(filledWidth(0)).toBe(0);
    expect(filledWidth(1)).toBe(BAR_W);
    expect(filledWidth(0.5)).toBe(Math.round(BAR_W / 2));
  });

  it('超出 0~1 的輸入一律夾住，不會畫出負寬或超長的條', () => {
    expect(filledWidth(-5)).toBe(0);
    expect(filledWidth(5)).toBe(BAR_W);
  });
});
