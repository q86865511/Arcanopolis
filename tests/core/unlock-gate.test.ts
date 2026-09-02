import { describe, expect, it } from 'vitest';
import { applyCommand } from '../../src/core/sim/commands';
import { createInitialState, getResource, type GameState } from '../../src/core/world/state';
import type { BuildingDef } from '../../src/data/types';

const lockedDef: BuildingDef = {
  id: 'market',
  name: '市場',
  size: { w: 1, h: 1 },
  cost: { wood: 20 },
  production: {},
  housing: 0,
  jobs: 0,
  unlockAtPopulation: 12,
};

const openDef: BuildingDef = {
  id: 'house',
  name: '民居',
  size: { w: 1, h: 1 },
  cost: { wood: 20 },
  production: {},
  housing: 0,
  jobs: 0,
};

function setPopulation(state: GameState, population: number): void {
  state.citizens = Array.from({ length: population }, (_, index) => ({
    id: `citizen-${index}`,
    home: 'home',
    job: null,
    x: 0,
    y: 0,
  }));
}

function readyState(population: number): GameState {
  const state = createInitialState(1);
  state.terrainOverrides['3,4'] = { type: 'grass' };
  state.resources.wood = 100;
  setPopulation(state, population);
  return state;
}

describe('placeBuilding 人口解鎖閘門', () => {
  it('人口低於門檻時不放置也不扣資源', () => {
    const state = readyState(11);
    applyCommand(state, { type: 'placeBuilding', buildingType: 'market', x: 3, y: 4 }, [lockedDef]);
    expect(state.buildings).toEqual([]);
    expect(getResource(state, 'wood')).toBe(100);
  });

  it('人口等於門檻時放置成功並扣款', () => {
    const state = readyState(12);
    applyCommand(state, { type: 'placeBuilding', buildingType: 'market', x: 3, y: 4 }, [lockedDef]);
    expect(state.buildings).toEqual([{ id: 'market@3,4#0', type: 'market', x: 3, y: 4 }]);
    expect(getResource(state, 'wood')).toBe(80);
  });

  it('省略 unlockAtPopulation 時零人口即可放置', () => {
    const state = readyState(0);
    applyCommand(state, { type: 'placeBuilding', buildingType: 'house', x: 3, y: 4 }, [openDef]);
    expect(state.buildings).toHaveLength(1);
    expect(getResource(state, 'wood')).toBe(80);
  });

  it('放置後人口跌回門檻以下不會移除既有建築', () => {
    const state = readyState(12);
    applyCommand(state, { type: 'placeBuilding', buildingType: 'market', x: 3, y: 4 }, [lockedDef]);
    setPopulation(state, 11);
    expect(state.buildings).toEqual([{ id: 'market@3,4#0', type: 'market', x: 3, y: 4 }]);
  });
});
