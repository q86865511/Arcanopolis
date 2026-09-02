import { describe, expect, it } from 'vitest';
import type { BuildingDef, EraDef } from '../../src/data/types';
import { buildingInfoLines, type BuildingInfoContext } from '../../src/render/buildingInfoText';

const eras: EraDef[] = [
  { id: 'village', name: '村莊', minPopulation: 0 },
  { id: 'town', name: '小鎮', minPopulation: 12 },
  { id: 'city', name: '城市', minPopulation: 24 },
];

const names: Record<string, string> = {
  wood: '木材', grain: '穀物', ale: '麥酒', grass: '草地', sand: '沙灘', forest: '森林',
};

function context(population = 12, resources: Record<string, number> = { wood: 100 }): BuildingInfoContext {
  return {
    population,
    resourceAmount: (id) => resources[id] ?? 0,
    resourceName: (id) => names[id] ?? id,
    terrainName: (id) => names[id] ?? id,
    eras,
  };
}

function def(overrides: Partial<BuildingDef> = {}): BuildingDef {
  return {
    id: 'tavern', name: '酒館', size: { w: 2, h: 2 }, cost: { wood: 60 },
    production: { ale: 2 }, inputs: { grain: 4 }, workTicks: 60,
    housing: 0, jobs: 3, unlockAtPopulation: 12, ...overrides,
  };
}

describe('buildingInfoLines', () => {
  it('標題顯示非 1×1 尺寸，成本買得起時為 normal', () => {
    const lines = buildingInfoLines(def(), context());
    expect(lines[0]).toEqual({ text: '酒館（2×2）', tone: 'title' });
    expect(lines[1]).toEqual({ text: '成本：木材60', tone: 'normal' });
  });

  it('任一成本不足時整行為 danger，並沿用 ! 格式', () => {
    const lines = buildingInfoLines(def({ cost: { wood: 60, grain: 10 } }), context(12, { wood: 59, grain: 20 }));
    expect(lines[1]).toEqual({ text: '成本：木材60! 穀物10', tone: 'danger' });
  });

  it('以一批工時換算原料與產出', () => {
    const lines = buildingInfoLines(def(), context());
    expect(lines).toContainEqual({ text: '穀物240 → 麥酒120／批（60 工時）', tone: 'normal' });
  });

  it('無原料時從箭頭開始，無 production 時省略生產行', () => {
    const produced = buildingInfoLines(def({ inputs: undefined, workTicks: undefined }), context());
    expect(produced).toContainEqual({ text: '→ 麥酒120／批（60 工時）', tone: 'normal' });
    const noProduction = buildingInfoLines(def({ production: {}, inputs: undefined }), context());
    expect(noProduction.some((line) => line.text.includes('／批'))).toBe(false);
  });

  it('只顯示非零工人與住房', () => {
    const lines = buildingInfoLines(def({ housing: 4 }), context());
    expect(lines).toContainEqual({ text: '工人 3', tone: 'normal' });
    expect(lines).toContainEqual({ text: '住 4 人', tone: 'normal' });
    const neither = buildingInfoLines(def({ jobs: 0, housing: 0 }), context());
    expect(neither.some((line) => line.text.startsWith('工人') || line.text.startsWith('住 '))).toBe(false);
  });

  it('依序顯示建造、鄰近與消耗地形條件', () => {
    const lines = buildingInfoLines(def({ terrain: { on: ['grass', 'sand'], near: ['forest'], consumes: ['forest'] } }), context());
    expect(lines).toEqual(expect.arrayContaining([
      { text: '需建於 草地／沙灘', tone: 'normal' },
      { text: '需鄰近 森林', tone: 'normal' },
      { text: '消耗 森林', tone: 'normal' },
    ]));
  });

  it('未解鎖顯示階段、門檻與目前人口；已解鎖則弱化顯示', () => {
    expect(buildingInfoLines(def(), context(8)).at(-1)).toEqual({
      text: '小鎮：需人口 12（目前 8）', tone: 'danger',
    });
    expect(buildingInfoLines(def(), context(12)).at(-1)).toEqual({ text: '已解鎖', tone: 'dim' });
  });
});
