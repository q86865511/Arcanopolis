// R4：System 介面與執行順序（src/core/sim/system.ts）
// System 本身只是型別（interface System { id; update }、SimContext { rng; time }），
// 無執行期匯出可測；其「依註冊順序執行」的行為透過 Simulation（R6）驗證。
import { describe, expect, it } from 'vitest';
import type { System, SimContext } from '../../src/core/sim/system';
import { createInitialState } from '../../src/core/world/state';
import { Simulation } from '../../src/core/sim/simulation';

describe('System 介面：依註冊順序執行', () => {
  it('兩個 system 依註冊順序、每 tick 依序被呼叫', () => {
    const order: string[] = [];
    const sysA: System = { id: 'A', update: () => order.push('A') };
    const sysB: System = { id: 'B', update: () => order.push('B') };

    const state = createInitialState(1);
    const sim = new Simulation(state, [sysA, sysB]);
    sim.tick();

    expect(order).toEqual(['A', 'B']);
  });

  it('多 tick 下每次都依同樣的註冊順序執行', () => {
    const order: string[] = [];
    const sysA: System = { id: 'A', update: () => order.push('A') };
    const sysB: System = { id: 'B', update: () => order.push('B') };
    const sysC: System = { id: 'C', update: () => order.push('C') };

    const state = createInitialState(1);
    const sim = new Simulation(state, [sysA, sysB, sysC]);
    sim.run(2);

    expect(order).toEqual(['A', 'B', 'C', 'A', 'B', 'C']);
  });

  it('system.update 收到的 ctx 具備 rng（可呼叫 next()）與 time（GameTime）', () => {
    // ctx 僅在該 tick 內有效（見 simulation.ts 註解），一律在 update 內取樣、不外洩 ctx
    let rngSample: number | undefined;
    let totalDayType: string | undefined;
    let tickOfDayType: string | undefined;
    const sys: System = {
      id: 'capture',
      update: (_state, ctx: SimContext) => {
        rngSample = ctx.rng.next();
        totalDayType = typeof ctx.time.totalDay;
        tickOfDayType = typeof ctx.time.tickOfDay;
      },
    };

    const state = createInitialState(1);
    const sim = new Simulation(state, [sys]);
    sim.tick();

    expect(typeof rngSample).toBe('number');
    expect(totalDayType).toBe('number');
    expect(tickOfDayType).toBe('number');
  });

  it('async update 會繞過 rngState 寫回破壞決定論 → tick 直接 throw', () => {
    // 不加任何轉型：TS 本來就允許 async update 指派給回傳 void 的介面，守衛必須在執行期擋
    const asyncSys: System = {
      id: 'async-offender',
      update: async () => {},
    };

    const state = createInitialState(1);
    const sim = new Simulation(state, [asyncSys]);

    expect(() => sim.tick()).toThrow(/Promise|thenable|同步/);
  });

  it('thenable（非真 Promise）同樣被擋下', () => {
    const thenableSys: System = {
      id: 'thenable-offender',
      update: (() => ({ then: (f: () => void) => f() })) as unknown as System['update'],
    };

    const state = createInitialState(1);
    const sim = new Simulation(state, [thenableSys]);

    expect(() => sim.tick()).toThrow(/Promise|thenable|同步/);
  });
});
