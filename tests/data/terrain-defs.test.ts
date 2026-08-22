// R7：地形資料表（data\terrain.json）與載入驗證（src\data\loader.ts 的 parseTerrainDefs）
import { describe, expect, it } from 'vitest';
import { parseTerrainDefs } from '../../src/data/loader';
import { TERRAIN_TYPES, isWalkable, isBuildable, type TerrainType } from '../../src/core/world/terrain';
import terrainJson from '../../data/terrain.json';

function validTerrainDefs(): Array<{ id: string; name: string; walkable: boolean; buildable: boolean }> {
  return [
    { id: 'water', name: '水域', walkable: false, buildable: false },
    { id: 'grass', name: '草地', walkable: true, buildable: true },
  ];
}

describe('parseTerrainDefs（R7）', () => {
  it('合法輸入回傳型別完整、內容相同的陣列', () => {
    const input = validTerrainDefs();
    expect(parseTerrainDefs(input)).toEqual(input);
  });

  it('非陣列輸入 → throw', () => {
    expect(() => parseTerrainDefs({})).toThrow();
    expect(() => parseTerrainDefs('water')).toThrow();
    expect(() => parseTerrainDefs(null)).toThrow();
    expect(() => parseTerrainDefs(undefined)).toThrow();
  });

  it('元素缺 id/name/walkable/buildable 任一 → throw', () => {
    const base = validTerrainDefs()[1];
    expect(() => parseTerrainDefs([{ ...base, id: undefined }])).toThrow();
    expect(() => parseTerrainDefs([{ ...base, name: undefined }])).toThrow();
    expect(() => parseTerrainDefs([{ ...base, walkable: undefined }])).toThrow();
    expect(() => parseTerrainDefs([{ ...base, buildable: undefined }])).toThrow();
  });

  it('id 非合法 TerrainType（未知 id）→ throw', () => {
    const base = validTerrainDefs()[1];
    expect(() => parseTerrainDefs([{ ...base, id: 'lava' }])).toThrow();
    expect(() => parseTerrainDefs([{ ...base, id: '' }])).toThrow();
    expect(() => parseTerrainDefs([{ ...base, id: 123 }])).toThrow();
  });

  it('name 非非空字串 → throw', () => {
    const base = validTerrainDefs()[1];
    expect(() => parseTerrainDefs([{ ...base, name: '' }])).toThrow();
    expect(() => parseTerrainDefs([{ ...base, name: 42 }])).toThrow();
  });

  it('walkable/buildable 非布林 → throw', () => {
    const base = validTerrainDefs()[1];
    expect(() => parseTerrainDefs([{ ...base, walkable: 'true' }])).toThrow();
    expect(() => parseTerrainDefs([{ ...base, buildable: 1 }])).toThrow();
  });

  it('id 重複 → throw，訊息含重複的 id', () => {
    const base = validTerrainDefs()[1];
    expect(() => parseTerrainDefs([base, { ...base }])).toThrow(/grass/);
  });

  it('元素含未知欄位 → throw 且訊息含該欄位名', () => {
    const base = validTerrainDefs()[1];
    expect(() => parseTerrainDefs([{ ...base, extra: 1 }])).toThrow(/extra/);
  });
});

describe('實際資料表 data/terrain.json（R7）', () => {
  it('經 parseTerrainDefs 驗證通過，且恰為六種地形（與 TERRAIN_TYPES 完全對應，無缺無多）', () => {
    const defs = parseTerrainDefs(terrainJson);
    const ids = defs.map((d) => d.id).sort();
    const expectedIds = [...TERRAIN_TYPES].sort();
    expect(ids).toEqual(expectedIds);
  });

  it('每種地形的 walkable/buildable 與 R1 的 isWalkable/isBuildable 函式一致', () => {
    const defs = parseTerrainDefs(terrainJson);
    for (const def of defs) {
      const t = def.id as TerrainType;
      expect(def.walkable).toBe(isWalkable(t));
      expect(def.buildable).toBe(isBuildable(t));
    }
  });

  it('water 與 mountain 的 walkable/buildable 皆為 false，其餘四種皆為 true', () => {
    const defs = parseTerrainDefs(terrainJson);
    const byId = new Map(defs.map((d) => [d.id, d]));

    expect(byId.get('water')?.walkable).toBe(false);
    expect(byId.get('water')?.buildable).toBe(false);
    expect(byId.get('mountain')?.walkable).toBe(false);
    expect(byId.get('mountain')?.buildable).toBe(false);

    for (const id of ['sand', 'grass', 'forest', 'rock']) {
      expect(byId.get(id)?.walkable).toBe(true);
      expect(byId.get(id)?.buildable).toBe(true);
    }
  });
});
