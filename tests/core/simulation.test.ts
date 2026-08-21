// R6：Simulation（src/core/sim/simulation.ts）
// R7：決定論（同 seed + 同指令序列 → 結果相同；不同 seed → 結果不同）
import { describe, expect, it } from 'vitest';
import type { System } from '../../src/core/sim/system';
import type { GameState } from '../../src/core/world/state';
import { createInitialState } from '../../src/core/world/state';
import { timeFromTick } from '../../src/core/sim/time';
import { Simulation } from '../../src/core/sim/simulation';

describe('Simulation：基本 tick 行為（R6）', () => {
  it('tick() 使 state.tick 加 1', () => {
    const state = createInitialState(1);
    const sim = new Simulation(state, []);
    sim.tick();
    expect(state.tick).toBe(1);
    sim.tick();
    expect(state.tick).toBe(2);
  });

  it('tick() 以當下 tick 的 GameTime 組 ctx 傳給 system', () => {
    let seenTime: ReturnType<typeof timeFromTick> | undefined;
    const sys: System = {
      id: 'time-capture',
      update: (_state, ctx) => {
        seenTime = ctx.time;
      },
    };
    const state = createInitialState(1);
    const sim = new Simulation(state, [sys]);
    sim.tick();

    expect(seenTime).toEqual(timeFromTick(state.tick));
  });

  it('run(n) 執行 n 次 tick', () => {
    const state = createInitialState(1);
    const sim = new Simulation(state, []);
    sim.run(10);
    expect(state.tick).toBe(10);
  });
});

describe('Simulation：決定論（R7）', () => {
  function buildDeterministicSim(seed: number): { sim: Simulation; state: GameState } {
    const state = createInitialState(seed);
    state.resources.wood = 0;
    const sys: System = {
      id: 'noop-tracker',
      update: (s) => {
        s.resources.ticksSeen = (s.resources.ticksSeen ?? 0) + 1;
      },
    };
    const sim = new Simulation(state, [sys]);
    return { sim, state };
  }

  it('同 seed + 同指令序列（相同 tick 時點 enqueue）→ 兩個獨立 Simulation run(200) 後 state 深相等', () => {
    const a = buildDeterministicSim(777);
    const b = buildDeterministicSim(777);

    for (let i = 0; i < 5; i++) {
      a.sim.enqueue({ type: 'addResource', resource: 'wood', amount: 1 });
      b.sim.enqueue({ type: 'addResource', resource: 'wood', amount: 1 });
    }

    a.sim.run(200);
    b.sim.run(200);

    expect(a.state).toEqual(b.state);
  });

  function buildRngConsumingSim(seed: number): { sim: Simulation; state: GameState } {
    const state = createInitialState(seed);
    state.resources.rngSample = 0;
    const sys: System = {
      id: 'rng-consumer',
      update: (s, ctx) => {
        s.resources.rngSample = (s.resources.rngSample ?? 0) + ctx.rng.next();
      },
    };
    const sim = new Simulation(state, [sys]);
    return { sim, state };
  }

  it('不同 seed → 消耗 rng 的 system 使 state 不同', () => {
    const a = buildRngConsumingSim(1);
    const b = buildRngConsumingSim(2);

    a.sim.run(200);
    b.sim.run(200);

    expect(a.state).not.toEqual(b.state);
  });

  it('同 seed + 消耗 rng 的 system → 深相等，且 rngState 確實被推進（攔截「未寫回」回歸）', () => {
    const a = buildRngConsumingSim(777);
    const b = buildRngConsumingSim(777);
    const initialRngState = a.state.rngState;

    a.sim.run(200);
    b.sim.run(200);

    expect(a.state).toEqual(b.state);
    expect(a.state.rngState).not.toBe(initialRngState);
  });

  it('存檔續跑：跑 80 tick → JSON round-trip → 續跑 120 tick ＝ 連續跑 200 tick', () => {
    const continuous = buildRngConsumingSim(4242);
    continuous.sim.run(200);

    const first = buildRngConsumingSim(4242);
    first.sim.run(80);
    const snapshot: GameState = JSON.parse(JSON.stringify(first.state));
    const resumed = new Simulation(snapshot, [
      {
        id: 'rng-consumer',
        update: (s, ctx) => {
          s.resources.rngSample = (s.resources.rngSample ?? 0) + ctx.rng.next();
        },
      },
    ]);
    resumed.run(120);

    expect(snapshot).toEqual(continuous.state);
    // 續跑路徑本身也必須推進 rngState，避免「兩條路徑同樣退化」時測試仍綠
    expect(snapshot.rngState).not.toBe(createInitialState(4242).rngState);
  });
});
