// W2 經濟：稅收 system（src/core/systems/tax.ts）與市場交易指令（src/core/sim/commands.ts 的 trade）
import { describe, expect, it } from 'vitest';
import { applyCommand, validateCommand, type Command, type TradeContext } from '../../src/core/sim/commands';
import { createRng } from '../../src/core/sim/rng';
import { timeFromTick } from '../../src/core/sim/time';
import { createTaxSystem } from '../../src/core/systems/tax';
import { addResource, createInitialState, getResource, type GameState } from '../../src/core/world/state';
import type { BuildingDef, EconomyConfig, ResourceDef } from '../../src/data/types';

const ECONOMY: EconomyConfig = { taxPerEmployedCitizenPerDay: 2, marketBuyMarkup: 0.5 };

const RESOURCES: ResourceDef[] = [
  { id: 'gold', name: '金幣' },
  { id: 'wood', name: '木材', basePrice: 2 },
  { id: 'tools', name: '工具', basePrice: 30 },
];

const MARKET_DEF: BuildingDef = {
  id: 'market',
  name: '市場',
  size: { w: 1, h: 1 },
  cost: {},
  production: {},
  housing: 0,
  jobs: 0,
  enablesTrade: true,
};

const HOUSE_DEF: BuildingDef = {
  id: 'house',
  name: '民居',
  size: { w: 1, h: 1 },
  cost: {},
  production: {},
  housing: 4,
  jobs: 0,
};

const TRADE_CTX: TradeContext = { resourceDefs: RESOURCES, economy: ECONOMY };

function stateWithCitizens(employed: number, unemployed: number): GameState {
  const state = createInitialState(1);
  for (let i = 0; i < employed; i++) {
    state.citizens.push({ id: `e${i}`, home: 'h', job: 'workplace', x: 0, y: 0 });
  }
  for (let i = 0; i < unemployed; i++) {
    state.citizens.push({ id: `u${i}`, home: 'h', job: null, x: 0, y: 0 });
  }
  return state;
}

function runTax(state: GameState, tick: number): void {
  createTaxSystem(ECONOMY).update(state, { rng: createRng(1), time: timeFromTick(tick) });
}

describe('稅收 system', () => {
  it('日界（tickOfDay===0）依就業人數課稅', () => {
    const state = stateWithCitizens(5, 0);
    runTax(state, 600);
    expect(getResource(state, 'gold')).toBe(10);
  });

  it('非日界完全不動金幣', () => {
    const state = stateWithCitizens(5, 0);
    runTax(state, 599);
    expect(getResource(state, 'gold')).toBe(0);
  });

  it('只對有工作的居民課稅：無業居民不計入', () => {
    const state = stateWithCitizens(3, 7);
    runTax(state, 600);
    expect(getResource(state, 'gold')).toBe(6);
  });

  it('全城無人就業 → 金幣不變（不會因 0 人而寫入 0 或 NaN）', () => {
    const state = stateWithCitizens(0, 4);
    addResource(state, 'gold', 100);
    runTax(state, 600);
    expect(getResource(state, 'gold')).toBe(100);
  });

  it('決定論：不消耗 rng，同輸入跑兩次結果相同', () => {
    const rng = createRng(1);
    const before = rng.getState();
    const state = stateWithCitizens(4, 0);
    createTaxSystem(ECONOMY).update(state, { rng, time: timeFromTick(600) });
    expect(rng.getState()).toBe(before);

    const again = stateWithCitizens(4, 0);
    runTax(again, 600);
    expect(getResource(again, 'gold')).toBe(getResource(state, 'gold'));
  });
});

describe('trade 指令驗證', () => {
  const base = { type: 'trade', direction: 'sell', resource: 'wood', amount: 1 } as const;

  it('合法指令通過驗證', () => {
    expect(() => validateCommand({ ...base })).not.toThrow();
    expect(() => validateCommand({ ...base, direction: 'buy' })).not.toThrow();
  });

  it('direction 非 buy/sell → throw', () => {
    expect(() => validateCommand({ ...base, direction: 'give' } as unknown as Command)).toThrow(/direction/);
  });

  it('resource 為空字串或非字串 → throw', () => {
    expect(() => validateCommand({ ...base, resource: '' })).toThrow(/resource/);
    expect(() => validateCommand({ ...base, resource: 7 } as unknown as Command)).toThrow(/resource/);
  });

  it('amount 非正整數（0、負數、小數）→ throw', () => {
    expect(() => validateCommand({ ...base, amount: 0 })).toThrow(/amount/);
    expect(() => validateCommand({ ...base, amount: -3 })).toThrow(/amount/);
    expect(() => validateCommand({ ...base, amount: 1.5 })).toThrow(/amount/);
  });

  it('amount 超過上限 → throw（防不受信任 JSON 餵爆下游）', () => {
    expect(() => validateCommand({ ...base, amount: 1_000_001 })).toThrow(/amount/);
  });
});

describe('trade 指令套用', () => {
  function marketState(gold: number, wood: number): GameState {
    const state = createInitialState(1);
    state.buildings.push({ id: 'm1', type: 'market', x: 0, y: 0 });
    addResource(state, 'gold', gold);
    addResource(state, 'wood', wood);
    return state;
  }

  const defs = [MARKET_DEF, HOUSE_DEF];

  it('賣出：扣資源、依 basePrice 進帳金幣', () => {
    const state = marketState(0, 10);
    applyCommand(state, { type: 'trade', direction: 'sell', resource: 'wood', amount: 10 }, defs, TRADE_CTX);
    expect(getResource(state, 'wood')).toBe(0);
    expect(getResource(state, 'gold')).toBe(20);
  });

  it('買入：依 basePrice×(1+markup) 扣金幣、進資源', () => {
    const state = marketState(100, 0);
    applyCommand(state, { type: 'trade', direction: 'buy', resource: 'wood', amount: 10 }, defs, TRADE_CTX);
    expect(getResource(state, 'wood')).toBe(10);
    expect(getResource(state, 'gold')).toBe(70); // 2 × 1.5 × 10 = 30
  });

  it('沒有任何 enablesTrade 建築 → 整筆跳過（市場未蓋就不能交易）', () => {
    const state = createInitialState(1);
    state.buildings.push({ id: 'h1', type: 'house', x: 0, y: 0 });
    addResource(state, 'wood', 10);
    applyCommand(state, { type: 'trade', direction: 'sell', resource: 'wood', amount: 10 }, defs, TRADE_CTX);
    expect(getResource(state, 'wood')).toBe(10);
    expect(getResource(state, 'gold')).toBe(0);
  });

  it('未注入 TradeContext → 整筆跳過，不 throw', () => {
    const state = marketState(0, 10);
    applyCommand(state, { type: 'trade', direction: 'sell', resource: 'wood', amount: 10 }, defs);
    expect(getResource(state, 'wood')).toBe(10);
    expect(getResource(state, 'gold')).toBe(0);
  });

  it('庫存不足 → 整筆跳過，不做部分成交', () => {
    const state = marketState(0, 3);
    applyCommand(state, { type: 'trade', direction: 'sell', resource: 'wood', amount: 10 }, defs, TRADE_CTX);
    expect(getResource(state, 'wood')).toBe(3);
    expect(getResource(state, 'gold')).toBe(0);
  });

  it('金幣不足 → 整筆跳過，不做部分成交', () => {
    const state = marketState(10, 0);
    applyCommand(state, { type: 'trade', direction: 'buy', resource: 'wood', amount: 10 }, defs, TRADE_CTX);
    expect(getResource(state, 'wood')).toBe(0);
    expect(getResource(state, 'gold')).toBe(10);
  });

  it('無 basePrice 的資源（gold 自身）不可交易 → 跳過，不能用金幣買金幣', () => {
    const state = marketState(100, 0);
    applyCommand(state, { type: 'trade', direction: 'buy', resource: 'gold', amount: 10 }, defs, TRADE_CTX);
    expect(getResource(state, 'gold')).toBe(100);
  });

  it('資源不在資源表中 → 跳過，不憑空生資源', () => {
    const state = marketState(1000, 0);
    applyCommand(state, { type: 'trade', direction: 'buy', resource: 'unobtainium', amount: 1 }, defs, TRADE_CTX);
    expect(getResource(state, 'unobtainium')).toBe(0);
    expect(getResource(state, 'gold')).toBe(1000);
  });

  it('賣掉再買回必定虧損：價差杜絕零成本套利迴圈', () => {
    const state = marketState(0, 100);
    for (let i = 0; i < 5; i++) {
      applyCommand(state, { type: 'trade', direction: 'sell', resource: 'wood', amount: 100 }, defs, TRADE_CTX);
      applyCommand(state, { type: 'trade', direction: 'buy', resource: 'wood', amount: 100 }, defs, TRADE_CTX);
    }
    // 每輪賣得 200、買回要 300，金幣不足時買入整筆跳過 → 木材必然一去不回，不可能越滾越多
    expect(getResource(state, 'wood')).toBeLessThanOrEqual(100);
    expect(getResource(state, 'wood') * 2 + getResource(state, 'gold')).toBeLessThanOrEqual(200);
  });
});
