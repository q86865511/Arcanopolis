// R1：資源/建築型別（src/data/types.ts）
// R2：載入驗證（src/data/loader.ts 的 parseResourceDefs/parseBuildingDefs）
// R3：實際資料表（data/resources.json、data/buildings.json）
import { describe, expect, it } from 'vitest';
import { parseBuildingDefs, parseResourceDefs } from '../../src/data/loader';
import type { BuildingDef, ResourceDef } from '../../src/data/types';
import resourcesJson from '../../data/resources.json';
import buildingsJson from '../../data/buildings.json';

function validResources(): ResourceDef[] {
  return [
    { id: 'wood', name: '木材' },
    { id: 'stone', name: '石材' },
  ];
}

function validBuildings(): BuildingDef[] {
  return [
    {
      id: 'lumber-camp',
      name: '伐木場',
      size: { w: 2, h: 2 },
      cost: { wood: 10 },
      production: { wood: 2 },
      housing: 0,
      jobs: 0,
    },
  ];
}

describe('parseResourceDefs（R2）', () => {
  it('合法輸入回傳型別完整、內容相同的陣列', () => {
    const input = validResources();
    expect(parseResourceDefs(input)).toEqual(input);
  });

  it('非陣列輸入 → throw', () => {
    expect(() => parseResourceDefs({})).toThrow();
    expect(() => parseResourceDefs('wood')).toThrow();
    expect(() => parseResourceDefs(null)).toThrow();
    expect(() => parseResourceDefs(undefined)).toThrow();
  });

  it('元素缺 id → throw', () => {
    expect(() => parseResourceDefs([{ name: '木材' }])).toThrow();
  });

  it('元素缺 name → throw', () => {
    expect(() => parseResourceDefs([{ id: 'wood' }])).toThrow();
  });

  it('id 非非空字串（數字、空字串、null）→ throw', () => {
    expect(() => parseResourceDefs([{ id: 123, name: '木材' }])).toThrow();
    expect(() => parseResourceDefs([{ id: '', name: '木材' }])).toThrow();
    expect(() => parseResourceDefs([{ id: null, name: '木材' }])).toThrow();
  });

  it('id 重複 → throw，訊息含重複的 id（出錯位置描述）', () => {
    const input = [
      { id: 'wood', name: '木材' },
      { id: 'wood', name: '木材2' },
    ];
    expect(() => parseResourceDefs(input)).toThrow(/wood/);
  });

  it('元素含未知欄位 → throw 且訊息含該欄位名', () => {
    expect(() => parseResourceDefs([{ id: 'wood', name: '木材', extra: 1 }])).toThrow(/extra/);
  });
});

describe('parseBuildingDefs unlockAtPopulation', () => {
  const resourceIds = new Set(['wood', 'stone', 'gold']);

  it('負數、小數與字串皆拒絕，錯誤訊息含欄位名', () => {
    const base = validBuildings()[0];
    for (const unlockAtPopulation of [-1, 1.5, '12']) {
      expect(() => parseBuildingDefs(
        [{ ...base, unlockAtPopulation }],
        resourceIds,
      )).toThrow(/unlockAtPopulation/);
    }
  });

  it('省略時回傳 def 不含該鍵', () => {
    const [def] = parseBuildingDefs(validBuildings(), resourceIds);
    expect(Object.prototype.hasOwnProperty.call(def, 'unlockAtPopulation')).toBe(false);
  });

  it('合法非負整數保留原值', () => {
    const base = validBuildings()[0];
    const [def] = parseBuildingDefs([{ ...base, unlockAtPopulation: 12 }], resourceIds);
    expect(def.unlockAtPopulation).toBe(12);
  });
});

describe('parseBuildingDefs 道路欄位', () => {
  const resourceIds = new Set(['wood', 'stone', 'gold']);

  it.each(['requiresRoad', 'isRoadRoot'] as const)('%s 僅在 true 時帶入 def', (field) => {
    const base = validBuildings()[0];
    const [omitted] = parseBuildingDefs([base], resourceIds);
    const [disabled] = parseBuildingDefs([{ ...base, [field]: false }], resourceIds);
    const [enabled] = parseBuildingDefs([{ ...base, [field]: true }], resourceIds);

    expect(Object.prototype.hasOwnProperty.call(omitted, field)).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(disabled, field)).toBe(false);
    expect(enabled[field]).toBe(true);
  });
});

describe('parseBuildingDefs（R2）', () => {
  const resourceIds = new Set(['wood', 'stone', 'gold']);

  it('合法輸入回傳型別完整、內容相同的陣列', () => {
    const input = validBuildings();
    expect(parseBuildingDefs(input, resourceIds)).toEqual(input);
  });

  it('非陣列輸入 → throw', () => {
    expect(() => parseBuildingDefs({}, resourceIds)).toThrow();
  });

  it('元素缺 id/name/size/cost/production 任一 → throw', () => {
    const base = validBuildings()[0];
    expect(() => parseBuildingDefs([{ ...base, id: undefined }], resourceIds)).toThrow();
    expect(() => parseBuildingDefs([{ ...base, name: undefined }], resourceIds)).toThrow();
    expect(() => parseBuildingDefs([{ ...base, size: undefined }], resourceIds)).toThrow();
    expect(() => parseBuildingDefs([{ ...base, cost: undefined }], resourceIds)).toThrow();
    expect(() => parseBuildingDefs([{ ...base, production: undefined }], resourceIds)).toThrow();
  });

  it('size.w/h 非正整數（0、負數、小數、缺）→ throw', () => {
    const base = validBuildings()[0];
    expect(() => parseBuildingDefs([{ ...base, size: { w: 0, h: 2 } }], resourceIds)).toThrow();
    expect(() => parseBuildingDefs([{ ...base, size: { w: 2, h: -1 } }], resourceIds)).toThrow();
    expect(() => parseBuildingDefs([{ ...base, size: { w: 2.5, h: 2 } }], resourceIds)).toThrow();
    expect(() => parseBuildingDefs([{ ...base, size: { w: 2 } }], resourceIds)).toThrow();
  });

  it('cost 的 key 不在 resourceIds → throw', () => {
    const base = validBuildings()[0];
    expect(() => parseBuildingDefs([{ ...base, cost: { unknown: 1 } }], resourceIds)).toThrow();
  });

  it('production 的 key 不在 resourceIds → throw', () => {
    const base = validBuildings()[0];
    expect(() => parseBuildingDefs([{ ...base, production: { unknown: 1 } }], resourceIds)).toThrow();
  });

  it('cost/production 值非有限或為負 → throw', () => {
    const base = validBuildings()[0];
    expect(() => parseBuildingDefs([{ ...base, cost: { wood: -1 } }], resourceIds)).toThrow();
    expect(() => parseBuildingDefs([{ ...base, cost: { wood: Number.NaN } }], resourceIds)).toThrow();
    expect(() => parseBuildingDefs([{ ...base, production: { wood: Infinity } }], resourceIds)).toThrow();
  });

  it('id 重複 → throw，訊息含重複的 id（出錯位置描述）', () => {
    const base = validBuildings()[0];
    expect(() => parseBuildingDefs([base, { ...base }], resourceIds)).toThrow(/lumber-camp/);
  });

  it('元素含未知欄位 → throw 且訊息含該欄位名', () => {
    const base = validBuildings()[0];
    expect(() => parseBuildingDefs([{ ...base, extra: 1 }], resourceIds)).toThrow(/extra/);
  });

  it('size 含未知欄位 → throw 且訊息含該欄位名', () => {
    const base = validBuildings()[0];
    expect(() =>
      parseBuildingDefs([{ ...base, size: { w: 2, h: 2, depth: 1 } }], resourceIds),
    ).toThrow(/depth/);
  });
});

describe('實際資料表 data/resources.json、data/buildings.json（R3）', () => {
  it('resources.json 經 parseResourceDefs 驗證通過，且至少含 wood/stone/food/gold', () => {
    const resources = parseResourceDefs(resourcesJson);
    const ids = resources.map((r) => r.id);
    expect(ids).toEqual(expect.arrayContaining(['wood', 'stone', 'food', 'gold']));
  });

  it('buildings.json 經 parseBuildingDefs 驗證通過（交叉引用 resources.json 合法），且至少含 lumber-camp/quarry/farm/house', () => {
    const resources = parseResourceDefs(resourcesJson);
    const resourceIds = new Set(resources.map((r) => r.id));
    const buildings = parseBuildingDefs(buildingsJson, resourceIds);
    const ids = buildings.map((b) => b.id);
    expect(ids).toEqual(expect.arrayContaining(['lumber-camp', 'quarry', 'farm', 'house']));
  });

  it('lumber-camp 產 wood、quarry 產 stone、farm 產 grain', () => {
    const resources = parseResourceDefs(resourcesJson);
    const resourceIds = new Set(resources.map((r) => r.id));
    const buildings = parseBuildingDefs(buildingsJson, resourceIds);
    const byId = new Map(buildings.map((b) => [b.id, b]));

    expect(byId.get('lumber-camp')?.production.wood).toBeGreaterThan(0);
    expect(byId.get('quarry')?.production.stone).toBeGreaterThan(0);
    expect(byId.get('farm')?.production.grain).toBe(4);
  });

  it('house 無 production、有 cost', () => {
    const resources = parseResourceDefs(resourcesJson);
    const resourceIds = new Set(resources.map((r) => r.id));
    const buildings = parseBuildingDefs(buildingsJson, resourceIds);
    const house = buildings.find((b) => b.id === 'house');

    expect(house).toBeDefined();
    expect(Object.keys(house!.production)).toHaveLength(0);
    expect(Object.keys(house!.cost).length).toBeGreaterThan(0);
  });

  it('parseBuildingDefs 回傳的 cost/production 是複本：改動 def 不污染原始資料表', () => {
    const resources = parseResourceDefs(resourcesJson);
    const resourceIds = new Set(resources.map((r) => r.id));

    const defsA = parseBuildingDefs(buildingsJson, resourceIds);
    const lumberA = defsA.find((b) => b.id === 'lumber-camp')!;
    const originalWood = lumberA.production.wood;
    lumberA.production.wood = 999999;

    const defsB = parseBuildingDefs(buildingsJson, resourceIds);
    const lumberB = defsB.find((b) => b.id === 'lumber-camp')!;
    expect(lumberB.production.wood).toBe(originalWood);
  });
});
