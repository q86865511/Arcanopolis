// R4：BuildingDef 擴充 housing/jobs（src/data/types.ts＋src/data/loader.ts 的 parseBuildingDefs）
// R5：實際資料表 data/buildings.json 補 housing/jobs
// R6：population 常數表（data/population.json＋src/data/loader.ts 的 parsePopulationConfig）
import { describe, expect, it } from 'vitest';
import { parseBuildingDefs, parsePopulationConfig, parseResourceDefs } from '../../src/data/loader';
import type { PopulationConfig } from '../../src/data/types';
import resourcesJson from '../../data/resources.json';
import buildingsJson from '../../data/buildings.json';
import populationJson from '../../data/population.json';

function baseBuilding() {
  return {
    id: 'lumber-camp',
    name: '伐木場',
    size: { w: 2, h: 2 },
    cost: { wood: 10 },
    production: { wood: 2 },
  };
}

describe('R4：BuildingDef 擴充 housing/jobs（parseBuildingDefs）', () => {
  const resourceIds = new Set(['wood', 'stone', 'gold']);

  it('缺 housing/jobs → 正規化為 0（回傳的 def 一律含兩欄）', () => {
    const [def] = parseBuildingDefs([baseBuilding()], resourceIds);
    expect(def.housing).toBe(0);
    expect(def.jobs).toBe(0);
  });

  it('存在的 housing/jobs 為 0~1000 整數 → 保留原值', () => {
    const [def] = parseBuildingDefs([{ ...baseBuilding(), housing: 4, jobs: 2 }], resourceIds);
    expect(def.housing).toBe(4);
    expect(def.jobs).toBe(2);
  });

  it('housing/jobs 邊界值 0 與 1000 合法', () => {
    const [def] = parseBuildingDefs([{ ...baseBuilding(), housing: 0, jobs: 1000 }], resourceIds);
    expect(def.housing).toBe(0);
    expect(def.jobs).toBe(1000);
  });

  it('housing 非法（負數/小數/超過 1000）→ throw 且訊息含建築 id', () => {
    expect(() => parseBuildingDefs([{ ...baseBuilding(), housing: -1 }], resourceIds)).toThrow(/lumber-camp/);
    expect(() => parseBuildingDefs([{ ...baseBuilding(), housing: 1.5 }], resourceIds)).toThrow(/lumber-camp/);
    expect(() => parseBuildingDefs([{ ...baseBuilding(), housing: 1001 }], resourceIds)).toThrow(/lumber-camp/);
  });

  it('jobs 非法（負數/小數/超過 1000）→ throw 且訊息含建築 id', () => {
    expect(() => parseBuildingDefs([{ ...baseBuilding(), jobs: -1 }], resourceIds)).toThrow(/lumber-camp/);
    expect(() => parseBuildingDefs([{ ...baseBuilding(), jobs: 2.5 }], resourceIds)).toThrow(/lumber-camp/);
    expect(() => parseBuildingDefs([{ ...baseBuilding(), jobs: 1001 }], resourceIds)).toThrow(/lumber-camp/);
  });

  it('欄位名打錯字（"housings" 而非 "housing"）→ throw 且訊息含 housings', () => {
    expect(() => parseBuildingDefs([{ ...baseBuilding(), housings: 4 }], resourceIds)).toThrow(/housings/);
  });
});

describe('R5：實際資料表 data/buildings.json 的 housing/jobs', () => {
  it('house.housing = 4，house 無 jobs（正規化為 0）', () => {
    const resources = parseResourceDefs(resourcesJson);
    const resourceIds = new Set(resources.map((r) => r.id));
    const buildings = parseBuildingDefs(buildingsJson, resourceIds);
    const house = buildings.find((b) => b.id === 'house');

    expect(house?.housing).toBe(4);
    expect(house?.jobs).toBe(0);
  });

  it('lumber-camp/quarry/farm 各 jobs = 2，且無 housing（正規化為 0）', () => {
    const resources = parseResourceDefs(resourcesJson);
    const resourceIds = new Set(resources.map((r) => r.id));
    const buildings = parseBuildingDefs(buildingsJson, resourceIds);
    const byId = new Map(buildings.map((b) => [b.id, b]));

    for (const id of ['lumber-camp', 'quarry', 'farm']) {
      expect(byId.get(id)?.jobs).toBe(2);
      expect(byId.get(id)?.housing).toBe(0);
    }
  });
});

describe('R6：population 常數表（parsePopulationConfig）', () => {
  function validConfig() {
    return {
      foodPerCitizenPerDay: 1,
      growthPerDay: 1,
      growthFoodReserveDays: 5,
      starvationDeathsPerDay: 1,
      maxCommuteDistance: 24,
    };
  }

  it('合法輸入回傳內容相同的物件', () => {
    const input = validConfig();
    expect(parsePopulationConfig(input)).toEqual(input);
  });

  it('foodPerCitizenPerDay 可為正浮點數', () => {
    const input = { ...validConfig(), foodPerCitizenPerDay: 1.5 };
    const result = parsePopulationConfig(input);
    expect(result.foodPerCitizenPerDay).toBe(1.5);
  });

  it('foodPerCitizenPerDay 非正有限數 → throw 且訊息含欄位名', () => {
    expect(() => parsePopulationConfig({ ...validConfig(), foodPerCitizenPerDay: 0 })).toThrow(
      /foodPerCitizenPerDay/,
    );
    expect(() => parsePopulationConfig({ ...validConfig(), foodPerCitizenPerDay: -1 })).toThrow(
      /foodPerCitizenPerDay/,
    );
    expect(() =>
      parsePopulationConfig({ ...validConfig(), foodPerCitizenPerDay: Number.NaN }),
    ).toThrow(/foodPerCitizenPerDay/);
  });

  it('growthPerDay/growthFoodReserveDays/starvationDeathsPerDay 非正整數 → throw 且訊息含欄位名', () => {
    expect(() => parsePopulationConfig({ ...validConfig(), growthPerDay: 0 })).toThrow(/growthPerDay/);
    expect(() => parsePopulationConfig({ ...validConfig(), growthPerDay: 1.5 })).toThrow(/growthPerDay/);
    expect(() => parsePopulationConfig({ ...validConfig(), growthFoodReserveDays: -1 })).toThrow(
      /growthFoodReserveDays/,
    );
    expect(() => parsePopulationConfig({ ...validConfig(), starvationDeathsPerDay: 0 })).toThrow(
      /starvationDeathsPerDay/,
    );
  });

  it('缺欄位 → throw 且訊息含欄位名', () => {
    const { foodPerCitizenPerDay: _omit, ...withoutField } = validConfig();
    expect(() => parsePopulationConfig(withoutField)).toThrow(/foodPerCitizenPerDay/);
  });

  it('非物件輸入 → throw', () => {
    expect(() => parsePopulationConfig(null)).toThrow();
    expect(() => parsePopulationConfig([])).toThrow();
    expect(() => parsePopulationConfig('x')).toThrow();
  });

  it('含未知欄位 → throw 且訊息含該欄位名', () => {
    expect(() => parsePopulationConfig({ ...validConfig(), extra: 1 })).toThrow(/extra/);
  });

  it('data/population.json 經 parsePopulationConfig 驗證通過，值符合規格', () => {
    // M3-W3 F0 平衡定案（C 組）：foodPerCitizenPerDay 100、growthFoodReserveDays 1，
    // 見 .pipeline/reviews/2026-08-22-reviewer-m3w3.md
    const config: PopulationConfig = parsePopulationConfig(populationJson);
    expect(config).toEqual({
      foodPerCitizenPerDay: 100,
      growthPerDay: 1,
      growthFoodReserveDays: 1,
      starvationDeathsPerDay: 1,
      maxCommuteDistance: 24,
    });
  });
});
