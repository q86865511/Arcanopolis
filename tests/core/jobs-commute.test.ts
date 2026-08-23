import { describe, expect, it } from 'vitest';
import { createJobsSystem } from '../../src/core/systems/jobs';
import { createRng } from '../../src/core/sim/rng';
import { timeFromTick } from '../../src/core/sim/time';
import type { SimContext } from '../../src/core/sim/system';
import { createInitialState, type Building, type Citizen } from '../../src/core/world/state';
import type { BuildingDef } from '../../src/data/types';

const MAX_COMMUTE_DISTANCE = 24;

const defs: BuildingDef[] = [
  { id: 'house', name: '民居', size: { w: 1, h: 1 }, cost: {}, production: {}, housing: 4, jobs: 0 },
  { id: 'workshop', name: '工坊', size: { w: 1, h: 1 }, cost: {}, production: {}, housing: 0, jobs: 1 },
];

function makeCtx(): SimContext {
  return { rng: createRng(1), time: timeFromTick(1) };
}

function building(overrides: Partial<Building>): Building {
  return { id: 'house1', type: 'house', x: 0, y: 0, ...overrides };
}

function citizen(overrides: Partial<Citizen>): Citizen {
  return { id: 'c1', home: 'house1', job: null, x: 0, y: 0, ...overrides };
}

describe('createJobsSystem 通勤半徑硬上限', () => {
  it('距離在上限內的空缺會被指派', () => {
    const state = createInitialState(1);
    state.buildings.push(building({ id: 'house1' }));
    state.buildings.push(building({ id: 'work-at-limit', type: 'workshop', x: 12, y: 12 }));
    state.citizens.push(citizen({}));

    createJobsSystem(defs, MAX_COMMUTE_DISTANCE).update(state, makeCtx());

    expect(state.citizens[0].job).toBe('work-at-limit');
  });

  it('距離超過上限的空缺不會被指派', () => {
    const state = createInitialState(1);
    state.buildings.push(building({ id: 'house1' }));
    state.buildings.push(building({ id: 'too-far', type: 'workshop', x: 13, y: 12 }));
    state.citizens.push(citizen({}));

    createJobsSystem(defs, MAX_COMMUTE_DISTANCE).update(state, makeCtx());

    expect(state.citizens[0].job).toBeNull();
  });

  it('近處滿編且遠處超限時維持待業', () => {
    const state = createInitialState(1);
    state.buildings.push(building({ id: 'house1' }));
    state.buildings.push(building({ id: 'near-full', type: 'workshop', x: 1, y: 0 }));
    state.buildings.push(building({ id: 'far-vacancy', type: 'workshop', x: 25, y: 0 }));
    state.citizens.push(citizen({ id: 'employed', job: 'near-full' }));
    state.citizens.push(citizen({ id: 'unemployed' }));

    createJobsSystem(defs, MAX_COMMUTE_DISTANCE).update(state, makeCtx());

    expect(state.citizens[0].job).toBe('near-full');
    expect(state.citizens[1].job).toBeNull();
  });
});
