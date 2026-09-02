import { describe, expect, it } from 'vitest';
import buildingsJson from '../../data/buildings.json';
import erasJson from '../../data/eras.json';
import resourcesJson from '../../data/resources.json';
import {
  currentEra,
  eraOfBuilding,
  groupBuildingsByEra,
  isBuildingUnlocked,
  unlockPopulationOf,
} from '../../src/data/eras';
import { parseBuildingDefs, parseEraDefs, parseResourceDefs } from '../../src/data/loader';
import type { BuildingDef, EraDef } from '../../src/data/types';

const validEras: EraDef[] = [
  { id: 'village', name: '村莊', minPopulation: 0 },
  { id: 'town', name: '小鎮', minPopulation: 12 },
  { id: 'city', name: '城市', minPopulation: 24 },
];

function building(id: string, unlockAtPopulation?: number): BuildingDef {
  return {
    id,
    name: id,
    size: { w: 1, h: 1 },
    cost: {},
    production: {},
    housing: 0,
    jobs: 0,
    ...(unlockAtPopulation === undefined ? {} : { unlockAtPopulation }),
  };
}

describe('parseEraDefs', () => {
  it('拒絕非陣列與空陣列', () => {
    expect(() => parseEraDefs({})).toThrow(/非空陣列/);
    expect(() => parseEraDefs([])).toThrow(/非空陣列/);
  });

  it('拒絕第一階門檻不是 0', () => {
    expect(() => parseEraDefs([{ id: 'town', name: '小鎮', minPopulation: 12 }])).toThrow(/第一階段/);
  });

  it('拒絕未嚴格遞增的門檻', () => {
    expect(() => parseEraDefs([
      validEras[0],
      { id: 'town', name: '小鎮', minPopulation: 0 },
    ])).toThrow(/必須大於/);
  });

  it('拒絕重複 id', () => {
    expect(() => parseEraDefs([
      validEras[0],
      { id: 'village', name: '另一階', minPopulation: 12 },
    ])).toThrow(/id 重複/);
  });

  it('拒絕未知欄位', () => {
    expect(() => parseEraDefs([{ ...validEras[0], extra: true }])).toThrow(/extra/);
  });

  it('接受合法輸入並回傳正規化資料', () => {
    expect(parseEraDefs(validEras)).toEqual(validEras);
  });
});

describe('時代純函數', () => {
  it('unlockPopulationOf 將省略欄位視為 0', () => {
    expect(unlockPopulationOf(building('open'))).toBe(0);
    expect(unlockPopulationOf(building('locked', 12))).toBe(12);
  });

  it('isBuildingUnlocked 在人口等於門檻時解鎖', () => {
    const def = building('locked', 12);
    expect(isBuildingUnlocked(def, 11)).toBe(false);
    expect(isBuildingUnlocked(def, 12)).toBe(true);
  });

  it('eraOfBuilding 取不高於建築門檻的最高階段', () => {
    expect(eraOfBuilding(building('open'), validEras).id).toBe('village');
    expect(eraOfBuilding(building('late-town', 23), validEras).id).toBe('town');
    expect(eraOfBuilding(building('city', 24), validEras).id).toBe('city');
  });

  it('currentEra 取不高於目前人口的最高階段', () => {
    expect(currentEra(0, validEras).id).toBe('village');
    expect(currentEra(12, validEras).id).toBe('town');
    expect(currentEra(99, validEras).id).toBe('city');
  });

  it('groupBuildingsByEra 保留階段與建築原始順序', () => {
    const defs = [building('v1'), building('c1', 24), building('t1', 12), building('v2')];
    const groups = groupBuildingsByEra(defs, validEras);
    expect(groups.map((group) => group.era.id)).toEqual(['village', 'town', 'city']);
    expect(groups.map((group) => group.buildings.map((def) => def.id))).toEqual([
      ['v1', 'v2'],
      ['t1'],
      ['c1'],
    ]);
  });
});

describe('真實時代與建築資料回歸鎖', () => {
  const eras = parseEraDefs(erasJson);
  const resources = parseResourceDefs(resourcesJson);
  const buildings = parseBuildingDefs(buildingsJson, new Set(resources.map((def) => def.id)));
  const groups = groupBuildingsByEra(buildings, eras);

  it('固定具備村莊、小鎮、城市三階段', () => {
    expect(eras.map((era) => era.id)).toEqual(['village', 'town', 'city']);
  });

  it('每棟建築皆能對應階段，且每階至多 10 棟', () => {
    expect(groups.flatMap((group) => group.buildings).map((def) => def.id)).toEqual(
      expect.arrayContaining(buildings.map((def) => def.id)),
    );
    expect(groups.flatMap((group) => group.buildings)).toHaveLength(buildings.length);
    for (const group of groups) expect(group.buildings.length).toBeLessThanOrEqual(10);
  });

  it('村莊階段保留開局食物鏈與基礎建築', () => {
    const villageIds = groups.find((group) => group.era.id === 'village')!.buildings.map((def) => def.id);
    expect(villageIds).toEqual(expect.arrayContaining([
      'lumber-camp',
      'quarry',
      'farm',
      'house',
      'mill',
      'bakery',
    ]));
  });
});
