import { describe, expect, it } from 'vitest';
import { applyCommand, type Command } from '../../src/core/sim/commands';
import { Simulation } from '../../src/core/sim/simulation';
import { hasRoad, placeRoad, roadCount } from '../../src/core/world/roads';
import { addResource, createInitialState, getResource, type GameState } from '../../src/core/world/state';
import { terrainAt } from '../../src/core/world/terrain';
import type { BuildingDef, RoadsConfig } from '../../src/data/types';

const ROADS: RoadsConfig = {
  nonRoadStepCost: 3,
  speedMultiplierOnRoad: 1,
  cost: { stone: 1 },
};

const workshopDef: BuildingDef = {
  id: 'workshop',
  name: '工坊',
  size: { w: 2, h: 2 },
  cost: {},
  production: {},
  housing: 0,
  jobs: 0,
};

function grass(state: GameState, x: number, y: number): void {
  state.terrainOverrides[`${x},${y}`] = { type: 'grass' };
}

describe('M6-W2：道路指令', () => {
  it('經 Simulation.enqueue + tick 鋪路成功並扣一單位 stone；重複鋪設不再扣費', () => {
    const state = createInitialState(1);
    grass(state, 4, 5);
    addResource(state, 'stone', 2);
    const sim = new Simulation(state, [], [], undefined, ROADS);

    sim.enqueue({ type: 'placeRoad', x: 4, y: 5 });
    sim.tick();

    expect(hasRoad(state, 4, 5)).toBe(true);
    expect(getResource(state, 'stone')).toBe(1);

    sim.enqueue({ type: 'placeRoad', x: 4, y: 5 });
    sim.tick();

    expect(roadCount(state)).toBe(1);
    expect(getResource(state, 'stone')).toBe(1);
  });

  it('越界座標不鋪路、不扣費', () => {
    const state = createInitialState(2);
    addResource(state, 'stone', 2);

    applyCommand(state, { type: 'placeRoad', x: -1, y: 0 }, [], undefined, ROADS);
    applyCommand(state, { type: 'placeRoad', x: state.worldSize, y: 0 }, [], undefined, ROADS);

    expect(state.roads).toEqual({});
    expect(getResource(state, 'stone')).toBe(2);
  });

  it('預設世界 (0,0) 的水面不鋪路、不扣費', () => {
    const state = createInitialState(1);
    addResource(state, 'stone', 2);
    expect(terrainAt(state, 0, 0)).toBe('water');

    applyCommand(state, { type: 'placeRoad', x: 0, y: 0 }, [], undefined, ROADS);

    expect(state.roads).toEqual({});
    expect(getResource(state, 'stone')).toBe(2);
  });

  it('既有建築 footprint 佔格不鋪路、不扣費', () => {
    const state = createInitialState(3);
    grass(state, 3, 3);
    addResource(state, 'stone', 2);
    state.buildings.push({ id: 'workshop@2,2#0', type: 'workshop', x: 2, y: 2 });

    applyCommand(state, { type: 'placeRoad', x: 3, y: 3 }, [workshopDef], undefined, ROADS);

    expect(state.roads).toEqual({});
    expect(getResource(state, 'stone')).toBe(2);
  });

  it('任一成本不足時不鋪路，且不部分扣款', () => {
    const state = createInitialState(4);
    grass(state, 6, 6);
    addResource(state, 'stone', 0);
    addResource(state, 'wood', 5);
    const multiCostRoads: RoadsConfig = { ...ROADS, cost: { stone: 1, wood: 2 } };

    applyCommand(state, { type: 'placeRoad', x: 6, y: 6 }, [], undefined, multiCostRoads);

    expect(state.roads).toEqual({});
    expect(getResource(state, 'stone')).toBe(0);
    expect(getResource(state, 'wood')).toBe(5);
  });

  it('未注入 roads 時 placeRoad 與 removeRoad 都靜默跳過', () => {
    const state = createInitialState(5);
    grass(state, 7, 7);
    addResource(state, 'stone', 2);
    expect(placeRoad(state, 8, 8)).toBe(true);
    const sim = new Simulation(state, []);

    sim.enqueue({ type: 'placeRoad', x: 7, y: 7 });
    sim.enqueue({ type: 'removeRoad', x: 8, y: 8 });
    sim.tick();

    expect(hasRoad(state, 7, 7)).toBe(false);
    expect(hasRoad(state, 8, 8)).toBe(true);
    expect(getResource(state, 'stone')).toBe(2);
  });

  it('removeRoad 移除既有道路且不退費；無路時不改 state', () => {
    const state = createInitialState(6);
    addResource(state, 'stone', 4);
    expect(placeRoad(state, 9, 9)).toBe(true);

    applyCommand(state, { type: 'removeRoad', x: 9, y: 9 }, [], undefined, ROADS);
    expect(hasRoad(state, 9, 9)).toBe(false);
    expect(getResource(state, 'stone')).toBe(4);

    const before = JSON.stringify(state);
    applyCommand(state, { type: 'removeRoad', x: 9, y: 9 }, [], undefined, ROADS);
    expect(JSON.stringify(state)).toBe(before);
  });

  it('同 seed 與同指令序列產出深相等 state', () => {
    const run = (): GameState => {
      const state = createInitialState(77);
      for (const [x, y] of [[10, 10], [11, 10], [12, 10]] as const) grass(state, x, y);
      addResource(state, 'stone', 5);
      const sim = new Simulation(state, [], [], undefined, ROADS);
      const sequence: Command[] = [
        { type: 'placeRoad', x: 10, y: 10 },
        { type: 'placeRoad', x: 11, y: 10 },
        { type: 'removeRoad', x: 10, y: 10 },
        { type: 'placeRoad', x: 12, y: 10 },
      ];
      for (const command of sequence) sim.enqueue(command);
      sim.run(3);
      return state;
    };

    expect(run()).toEqual(run());
  });
});
