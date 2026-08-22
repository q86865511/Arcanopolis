// M3.9-W2：地形綁定生產與資源耗竭再生 —— R7 資料表與 loader 驗證
//
// R7：data/buildings.json 補上 terrain 欄位（lumber-camp.near=['forest']、quarry.on=['rock']、
//     farm.on=['grass']、house.on=['grass','sand']）；新增 data/terrain-economy.json
//     （forestWoodCapacity/rockStoneCapacity/forestRegrowDays，皆正整數），
//     由 src/data/loader.ts 新增的 parseTerrainEconomy 驗證（正整數、未知鍵 throw）。
import { describe, expect, it } from 'vitest';
import { parseBuildingDefs, parseResourceDefs, parseTerrainEconomy } from '../../src/data/loader';
import type { BuildingDef } from '../../src/data/types';
import buildingsJson from '../../data/buildings.json';
import resourcesJson from '../../data/resources.json';
import terrainEconomyJson from '../../data/terrain-economy.json';

type WithTerrain = BuildingDef & { terrain?: { on?: string[]; near?: string[]; consumes?: string[] } };

describe('R7：data/buildings.json 的 terrain 欄位', () => {
  const resources = parseResourceDefs(resourcesJson);
  const resourceIds = new Set(resources.map((r) => r.id));

  it('buildingsJson 經 parseBuildingDefs 驗證通過（含新增的 terrain 欄位，不因未知欄位被拒）', () => {
    expect(() => parseBuildingDefs(buildingsJson, resourceIds)).not.toThrow();
  });

  it('lumber-camp.terrain 為 { near: ["forest"], consumes: ["forest"] }', () => {
    const defs = parseBuildingDefs(buildingsJson, resourceIds) as WithTerrain[];
    const lumberCamp = defs.find((d) => d.id === 'lumber-camp');
    expect(lumberCamp?.terrain).toEqual({ near: ['forest'], consumes: ['forest'] });
  });

  it('quarry.terrain 為 { on: ["rock"], consumes: ["rock"] }', () => {
    const defs = parseBuildingDefs(buildingsJson, resourceIds) as WithTerrain[];
    const quarry = defs.find((d) => d.id === 'quarry');
    expect(quarry?.terrain).toEqual({ on: ['rock'], consumes: ['rock'] });
  });

  it('farm.terrain 為 { on: ["grass"] }', () => {
    const defs = parseBuildingDefs(buildingsJson, resourceIds) as WithTerrain[];
    const farm = defs.find((d) => d.id === 'farm');
    expect(farm?.terrain).toEqual({ on: ['grass'] });
  });

  it('house.terrain 為 { on: ["grass", "sand"] }', () => {
    const defs = parseBuildingDefs(buildingsJson, resourceIds) as WithTerrain[];
    const house = defs.find((d) => d.id === 'house');
    expect(house?.terrain).toEqual({ on: ['grass', 'sand'] });
  });
});

describe('R7：data/terrain-economy.json 與 parseTerrainEconomy（src/data/loader.ts）', () => {
  function validConfig(): Record<string, number> {
    return { forestWoodCapacity: 2400, rockStoneCapacity: 4800, forestRegrowDays: 5 };
  }

  it('data/terrain-economy.json 經 parseTerrainEconomy 驗證通過，三個欄位皆為正整數', () => {
    const config = parseTerrainEconomy(terrainEconomyJson);
    expect(config).toEqual(validConfig());
    expect(Number.isInteger(config.forestWoodCapacity)).toBe(true);
    expect(config.forestWoodCapacity).toBeGreaterThan(0);
    expect(Number.isInteger(config.rockStoneCapacity)).toBe(true);
    expect(config.rockStoneCapacity).toBeGreaterThan(0);
    expect(Number.isInteger(config.forestRegrowDays)).toBe(true);
    expect(config.forestRegrowDays).toBeGreaterThan(0);
  });

  it('合法輸入回傳內容相同的物件', () => {
    expect(parseTerrainEconomy(validConfig())).toEqual(validConfig());
  });

  it('非物件輸入（null/陣列/字串/數字）→ throw', () => {
    expect(() => parseTerrainEconomy(null)).toThrow();
    expect(() => parseTerrainEconomy([])).toThrow();
    expect(() => parseTerrainEconomy('x')).toThrow();
    expect(() => parseTerrainEconomy(5)).toThrow();
  });

  it('缺任一欄位 → throw 且訊息含欄位名', () => {
    const base = validConfig();
    const { forestWoodCapacity: _a, ...missingForest } = base;
    const { rockStoneCapacity: _b, ...missingRock } = base;
    const { forestRegrowDays: _c, ...missingRegrow } = base;
    expect(() => parseTerrainEconomy(missingForest)).toThrow(/forestWoodCapacity/);
    expect(() => parseTerrainEconomy(missingRock)).toThrow(/rockStoneCapacity/);
    expect(() => parseTerrainEconomy(missingRegrow)).toThrow(/forestRegrowDays/);
  });

  it('欄位值非正整數（0/負數/小數/字串）→ throw 且訊息含欄位名', () => {
    const base = validConfig();
    expect(() => parseTerrainEconomy({ ...base, forestWoodCapacity: 0 })).toThrow(/forestWoodCapacity/);
    expect(() => parseTerrainEconomy({ ...base, forestWoodCapacity: -1 })).toThrow(/forestWoodCapacity/);
    expect(() => parseTerrainEconomy({ ...base, forestWoodCapacity: 1.5 })).toThrow(/forestWoodCapacity/);
    expect(() => parseTerrainEconomy({ ...base, forestWoodCapacity: '60' })).toThrow(/forestWoodCapacity/);
    expect(() => parseTerrainEconomy({ ...base, rockStoneCapacity: -5 })).toThrow(/rockStoneCapacity/);
    expect(() => parseTerrainEconomy({ ...base, forestRegrowDays: 0 })).toThrow(/forestRegrowDays/);
  });

  it('含未知欄位 → throw 且訊息含該欄位名', () => {
    expect(() => parseTerrainEconomy({ ...validConfig(), extra: 1 })).toThrow(/extra/);
  });
});
