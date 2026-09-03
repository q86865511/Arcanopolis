import { describe, expect, it } from 'vitest';
import roadsJson from '../../data/roads.json';
import { parseRoadsConfig } from '../../src/data/loader';

describe('parseRoadsConfig', () => {
  it('合法輸入回傳對應欄位', () => {
    expect(parseRoadsConfig({ nonRoadStepCost: 3, speedMultiplierOnRoad: 2 })).toEqual({
      nonRoadStepCost: 3,
      speedMultiplierOnRoad: 2,
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
      expect(() => parseRoadsConfig({ nonRoadStepCost, speedMultiplierOnRoad: 1 })).toThrow(
        /nonRoadStepCost/,
      );
    }
  });

  it('speedMultiplierOnRoad 為 0、1.5 或 3 → throw', () => {
    for (const speedMultiplierOnRoad of [0, 1.5, 3]) {
      expect(() => parseRoadsConfig({ nonRoadStepCost: 3, speedMultiplierOnRoad })).toThrow(
        /speedMultiplierOnRoad/,
      );
    }
  });

  it('真實資料表通過且鎖定 W1 數值', () => {
    expect(parseRoadsConfig(roadsJson)).toEqual({
      nonRoadStepCost: 3,
      speedMultiplierOnRoad: 1,
    });
  });
});
