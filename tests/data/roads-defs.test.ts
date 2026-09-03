import { describe, expect, it } from 'vitest';
import buildingsJson from '../../data/buildings.json';
import resourcesJson from '../../data/resources.json';
import { parseBuildingDefs, parseResourceDefs } from '../../src/data/loader';

const resourceIds = new Set(['wood', 'stone', 'gold']);

function validBuilding(): Record<string, unknown> {
  return {
    id: 'house',
    name: '民居',
    size: { w: 1, h: 1 },
    cost: { wood: 10 },
    production: {},
  };
}

describe('parseBuildingDefs 的道路欄位', () => {
  it.each(['requiresRoad', 'isRoadRoot'] as const)('%s 非布林值 → throw 且訊息含欄位名', (field) => {
    expect(() => parseBuildingDefs([{ ...validBuilding(), [field]: 'yes' }], resourceIds)).toThrow(
      new RegExp(field),
    );
  });

  it('省略時 def 不帶道路欄位', () => {
    const [def] = parseBuildingDefs([validBuilding()], resourceIds);
    expect(Object.prototype.hasOwnProperty.call(def, 'requiresRoad')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(def, 'isRoadRoot')).toBe(false);
  });
});

describe('道路欄位真實資料表回歸鎖', () => {
  it('每棟建築都明寫 requiresRoad: true', () => {
    const rawDefs = buildingsJson as Array<Record<string, unknown>>;
    for (const raw of rawDefs) {
      expect(Object.prototype.hasOwnProperty.call(raw, 'requiresRoad')).toBe(true);
      expect(raw.requiresRoad).toBe(true);
    }

    const allResourceIds = new Set(parseResourceDefs(resourcesJson).map((def) => def.id));
    const defs = parseBuildingDefs(buildingsJson, allResourceIds);
    expect(defs.every((def) => def.requiresRoad === true)).toBe(true);
  });

  // M6-W4 加入主堡後改成恰好 1；W1 尚未把 isRoadRoot 寫入資料表。
  it('isRoadRoot 為 true 的建築數不超過 1', () => {
    const allResourceIds = new Set(parseResourceDefs(resourcesJson).map((def) => def.id));
    const defs = parseBuildingDefs(buildingsJson, allResourceIds);
    expect(defs.filter((def) => def.isRoadRoot === true).length).toBeLessThanOrEqual(1);
  });
});
