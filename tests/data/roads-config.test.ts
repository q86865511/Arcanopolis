import { describe, expect, it } from 'vitest';
import roadsJson from '../../data/roads.json';
import resourcesJson from '../../data/resources.json';
import { parseResourceDefs, parseRoadsConfig } from '../../src/data/loader';

describe('parseRoadsConfig', () => {
  it('合法輸入回傳對應欄位', () => {
    expect(parseRoadsConfig({ nonRoadStepCost: 3, speedMultiplierOnRoad: 2, cost: { stone: 1 } })).toEqual({
      nonRoadStepCost: 3,
      speedMultiplierOnRoad: 2,
      cost: { stone: 1 },
    });
  });

  it('非物件輸入 → throw', () => {
    for (const input of [null, [], 'roads']) {
      expect(() => parseRoadsConfig(input)).toThrow();
    }
  });

  it('未知鍵 → throw 且訊息含欄位名', () => {
    expect(() => parseRoadsConfig({
      nonRoadStepCost: 3,
      speedMultiplierOnRoad: 1,
      extra: true,
    })).toThrow(/extra/);
  });

  it('nonRoadStepCost 為 0、小數或字串 → throw', () => {
    for (const nonRoadStepCost of [0, 1.5, '3']) {
      expect(() => parseRoadsConfig({ nonRoadStepCost, speedMultiplierOnRoad: 1, cost: {} })).toThrow(
        /nonRoadStepCost/,
      );
    }
  });

  it('speedMultiplierOnRoad 為 0、1.5 或 3 → throw', () => {
    for (const speedMultiplierOnRoad of [0, 1.5, 3]) {
      expect(() => parseRoadsConfig({ nonRoadStepCost: 3, speedMultiplierOnRoad, cost: {} })).toThrow(
        /speedMultiplierOnRoad/,
      );
    }
  });

  it('真實資料表通過且鎖定 W1 數值', () => {
    // nonRoadStepCost 暫定 1（帶權尋路的基礎設施已就位，但跨格快路與帶權首步的振盪問題尚待裁決，
    // 見 movement.ts 檔頭「已知限制」；裁決後改回 3 並更新此鎖）。
    expect(parseRoadsConfig(roadsJson)).toEqual({
      nonRoadStepCost: 1,
      speedMultiplierOnRoad: 1,
      cost: { stone: 1 },
    });
  });

  it('cost 非物件、或數量為負／非有限 → throw 含欄位名', () => {
    expect(() => parseRoadsConfig({ nonRoadStepCost: 3, speedMultiplierOnRoad: 1, cost: [] })).toThrow(/cost/);
    expect(() => parseRoadsConfig({ nonRoadStepCost: 3, speedMultiplierOnRoad: 1, cost: { stone: -1 } })).toThrow(/cost/);
    expect(() => parseRoadsConfig({ nonRoadStepCost: 3, speedMultiplierOnRoad: 1, cost: { stone: Infinity } })).toThrow(/cost/);
  });

  it('真實資料表的 cost 資源 id 都存在於 resources.json（loader 不做交叉檢查，在此鎖定）', () => {
    const ids = new Set(parseResourceDefs(resourcesJson).map((r) => r.id));
    for (const id of Object.keys(parseRoadsConfig(roadsJson).cost)) {
      expect(ids.has(id)).toBe(true);
    }
  });
});
