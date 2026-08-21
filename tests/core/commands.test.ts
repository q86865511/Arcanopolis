// R5：指令佇列（src/core/sim/commands.ts）
import { describe, expect, it } from 'vitest';
import type { Command } from '../../src/core/sim/commands';
import { createInitialState } from '../../src/core/world/state';
import { Simulation } from '../../src/core/sim/simulation';

describe('指令佇列：enqueue 於下一次 tick 開頭依 FIFO 套用後清空', () => {
  it('addResource 指令使 state.resources[resource] 增加 amount', () => {
    const state = createInitialState(1);
    state.resources.wood = 10;
    const sim = new Simulation(state, []);

    const cmd: Command = { type: 'addResource', resource: 'wood', amount: 5 };
    sim.enqueue(cmd);
    sim.tick();

    expect(state.resources.wood).toBe(15);
  });

  it('同 tick 內兩道指令依序套用（FIFO）', () => {
    const state = createInitialState(1);
    state.resources.wood = 0;
    const sim = new Simulation(state, []);

    sim.enqueue({ type: 'addResource', resource: 'wood', amount: 5 });
    sim.enqueue({ type: 'addResource', resource: 'wood', amount: 3 });
    sim.tick();

    expect(state.resources.wood).toBe(8);
  });

  it('指令套用後佇列即清空，下一次 tick 不會重複套用', () => {
    const state = createInitialState(1);
    state.resources.wood = 0;
    const sim = new Simulation(state, []);

    sim.enqueue({ type: 'addResource', resource: 'wood', amount: 5 });
    sim.tick();
    expect(state.resources.wood).toBe(5);

    sim.tick(); // 沒有新指令，佇列應已清空
    expect(state.resources.wood).toBe(5);
  });

  it('FIFO 真序：以寫入攔截記錄中間值，+5 先於 +3（LIFO 會先看到 3）', () => {
    const writes: number[] = [];
    const state = createInitialState(1);
    state.resources = new Proxy<Record<string, number>>(
      {},
      {
        set(target, prop, value) {
          if (typeof value === 'number') writes.push(value);
          return Reflect.set(target, prop, value);
        },
        defineProperty(target, prop, desc) {
          if (typeof desc.value === 'number') writes.push(desc.value);
          return Reflect.defineProperty(target, prop, desc);
        },
      },
    );
    const sim = new Simulation(state, []);

    sim.enqueue({ type: 'addResource', resource: 'wood', amount: 5 });
    sim.enqueue({ type: 'addResource', resource: 'wood', amount: 3 });
    sim.tick();

    expect(writes).toEqual([5, 8]);
  });

  it('指令於 systems 之前套用：system 在同一 tick 內看得到指令效果', () => {
    let seenDuringTick: number | undefined;
    const state = createInitialState(1);
    const sim = new Simulation(state, [
      {
        id: 'observer',
        update: (s) => {
          seenDuringTick = s.resources.wood;
        },
      },
    ]);

    sim.enqueue({ type: 'addResource', resource: 'wood', amount: 5 });
    sim.tick();

    expect(seenDuringTick).toBe(5);
  });

  it('system 於 update 內 enqueue 的指令延到下一 tick 才生效', () => {
    const state = createInitialState(1);
    let sim: Simulation;
    sim = new Simulation(state, [
      {
        id: 'self-enqueue',
        update: (s) => {
          if (s.tick === 1) sim.enqueue({ type: 'addResource', resource: 'stone', amount: 7 });
        },
      },
    ]);

    sim.tick();
    expect(state.resources.stone).toBeUndefined();
    sim.tick();
    expect(state.resources.stone).toBe(7);
  });

  it('與 Object.prototype 同名的資源名不會腐化狀態，且 JSON round-trip 保留', () => {
    const state = createInitialState(1);
    const sim = new Simulation(state, []);

    sim.enqueue({ type: 'addResource', resource: 'constructor', amount: 5 });
    sim.enqueue({ type: 'addResource', resource: '__proto__', amount: 3 });
    sim.tick();

    expect(Object.getOwnPropertyDescriptor(state.resources, 'constructor')?.value).toBe(5);
    expect(Object.getOwnPropertyDescriptor(state.resources, '__proto__')?.value).toBe(3);

    const roundTripped = JSON.parse(JSON.stringify(state));
    expect(Object.getOwnPropertyDescriptor(roundTripped.resources, 'constructor')?.value).toBe(5);
    expect(Object.getOwnPropertyDescriptor(roundTripped.resources, '__proto__')?.value).toBe(3);
  });

  it('amount 非有限數值（NaN/Infinity）→ enqueue 入口即 throw，批次保持原子', () => {
    const state = createInitialState(1);
    const sim = new Simulation(state, []);

    expect(() => sim.enqueue({ type: 'addResource', resource: 'wood', amount: Number.NaN })).toThrow();
    expect(() => sim.enqueue({ type: 'addResource', resource: 'wood', amount: Infinity })).toThrow();

    // 被拒收的指令不影響同批合法指令：後續 tick 正常套用
    sim.enqueue({ type: 'addResource', resource: 'wood', amount: 5 });
    sim.tick();
    expect(state.resources.wood).toBe(5);
  });
});
