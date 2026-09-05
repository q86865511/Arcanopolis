// 建築選單的時代頁籤（src/render/buildingSelection.ts）——重點仍是鎖住
// 「資料表再長也沒有選不到的建築」。背景：M4-W1 曾因按鍵表只綁 1-9 而讓第 10 棟
// （鐵匠鋪）永遠選不到，且無測試守住；M5-W3 把分頁換成時代分組後，同一個風險換了形狀
// ——某個階段塞超過 10 棟就會有建築沒有數字鍵可綁。
import { describe, expect, it } from 'vitest';
import {
  BUILDINGS_PER_TAB,
  ROAD_HOTKEY,
  buildingsOnTab,
  eraTabLabel,
  lockedBuildingNotice,
  paletteSlotCount,
  roadSlotIndex,
  tabCount,
  wrapTab,
} from '../../src/render/buildingSelection';
import { BUILDING_DEFS, ERA_DEFS } from '../../src/render/defs';
import type { BuildingDef, EraDef } from '../../src/data/types';

const FAKE_ERAS: EraDef[] = [
  { id: 'a', name: '甲', minPopulation: 0 },
  { id: 'b', name: '乙', minPopulation: 10 },
  { id: 'c', name: '丙', minPopulation: 20 },
];

function fakeDef(id: string, unlockAtPopulation?: number): BuildingDef {
  return {
    id,
    name: `建築${id}`,
    size: { w: 1, h: 1 },
    cost: {},
    production: {},
    housing: 0,
    jobs: 0,
    ...(unlockAtPopulation === undefined ? {} : { unlockAtPopulation }),
  };
}

describe('tabCount', () => {
  it('＝階段數；空表也回 1（不會出現零個頁籤而除以零）', () => {
    expect(tabCount(FAKE_ERAS)).toBe(3);
    expect(tabCount([])).toBe(1);
  });
});

describe('wrapTab', () => {
  it('末頁往後回到第一頁、第一頁往前到末頁（頭尾循環）', () => {
    expect(wrapTab(3, FAKE_ERAS)).toBe(0);
    expect(wrapTab(-1, FAKE_ERAS)).toBe(2);
  });

  it('只有一階時任何索引都回 0', () => {
    expect(wrapTab(5, [FAKE_ERAS[0]])).toBe(0);
    expect(wrapTab(-5, [FAKE_ERAS[0]])).toBe(0);
  });
});

describe('buildingsOnTab', () => {
  const defs = [fakeDef('x'), fakeDef('y', 10), fakeDef('z', 20), fakeDef('w', 25)];

  it('依解鎖門檻落在對應階段，且保留資料表原有順序', () => {
    expect(buildingsOnTab(defs, FAKE_ERAS, 0).map((d) => d.id)).toEqual(['x']);
    expect(buildingsOnTab(defs, FAKE_ERAS, 1).map((d) => d.id)).toEqual(['y']);
    expect(buildingsOnTab(defs, FAKE_ERAS, 2).map((d) => d.id)).toEqual(['z', 'w']);
  });

  it('索引越界時循環（與 wrapTab 同語義）', () => {
    expect(buildingsOnTab(defs, FAKE_ERAS, 3).map((d) => d.id)).toEqual(['x']);
  });

  it('分組不重疊也不遺漏：各頁籤串起來等於原陣列', () => {
    const flattened = Array.from({ length: tabCount(FAKE_ERAS) }, (_, tab) =>
      buildingsOnTab(defs, FAKE_ERAS, tab),
    ).flat();
    expect(flattened).toEqual(defs);
  });

  it('階段表為空時回空陣列，不 throw', () => {
    expect(buildingsOnTab(defs, [], 0)).toEqual([]);
  });
});

describe('eraTabLabel', () => {
  it('已達門檻只印階段名', () => {
    expect(eraTabLabel(FAKE_ERAS[1], 10)).toBe('乙');
  });

  it('未達門檻附上還缺的條件（頁籤本身就是進度提示）', () => {
    expect(eraTabLabel(FAKE_ERAS[1], 9)).toBe('乙 · 人口10');
  });
});

describe('lockedBuildingNotice', () => {
  it('說出還差什麼，而不是只說不能蓋', () => {
    expect(lockedBuildingNotice(fakeDef('y', 12))).toContain('12');
  });

  it('沒標門檻的建築視為 0（資料表省略＝開局可建）', () => {
    expect(lockedBuildingNotice(fakeDef('x'))).toContain('0');
  });
});

describe('實際建築表的可及性（回歸鎖）', () => {
  it('data/buildings.json 的每一棟建築都落在某個時代頁籤上，沒有選不到的建築', () => {
    const reachable = new Set(
      Array.from({ length: tabCount(ERA_DEFS) }, (_, tab) =>
        buildingsOnTab(BUILDING_DEFS, ERA_DEFS, tab),
      )
        .flat()
        .map((def) => def.id),
    );
    for (const def of BUILDING_DEFS) {
      expect(reachable.has(def.id)).toBe(true);
    }
    expect(reachable.size).toBe(BUILDING_DEFS.length);
  });

  it('每一棟建築在其頁籤上的索引都對得到一個數字鍵（0..9）', () => {
    for (const def of BUILDING_DEFS) {
      const tab = Array.from({ length: tabCount(ERA_DEFS) }, (_, index) => index).find((index) =>
        buildingsOnTab(BUILDING_DEFS, ERA_DEFS, index).some((d) => d.id === def.id),
      );
      expect(tab).not.toBeUndefined();
      const slot = buildingsOnTab(BUILDING_DEFS, ERA_DEFS, tab as number).findIndex(
        (d) => d.id === def.id,
      );
      expect(slot).toBeGreaterThanOrEqual(0);
      expect(slot).toBeLessThan(BUILDINGS_PER_TAB);
    }
  });
});

// 道路格（M6-W2）：固定排在每個頁籤的建築格之後，且不佔數字鍵。
describe('roadSlotIndex / paletteSlotCount', () => {
  const defs = [fakeDef('x'), fakeDef('y', 10), fakeDef('z', 20), fakeDef('w', 25)];

  it('道路格排在該頁建築格之後，每頁都有一格', () => {
    expect(roadSlotIndex(defs, FAKE_ERAS, 0)).toBe(1);
    expect(roadSlotIndex(defs, FAKE_ERAS, 2)).toBe(2);
    expect(paletteSlotCount(defs, FAKE_ERAS, 0)).toBe(2);
  });

  it('該頁沒有建築時道路格仍在第 0 格（開局就鋪得起來）', () => {
    expect(roadSlotIndex([], FAKE_ERAS, 0)).toBe(0);
    expect(paletteSlotCount([], FAKE_ERAS, 0)).toBe(1);
  });

  it('建築數超過按鍵上限時道路格不再往後推，仍留在畫面內', () => {
    const many = Array.from({ length: BUILDINGS_PER_TAB + 3 }, (_, i) => fakeDef(`m${i}`));
    expect(roadSlotIndex(many, FAKE_ERAS, 0)).toBe(BUILDINGS_PER_TAB);
    expect(paletteSlotCount(many, FAKE_ERAS, 0)).toBe(BUILDINGS_PER_TAB + 1);
  });

  it('道路的快捷鍵不與數字鍵相撞', () => {
    expect(['1', '2', '3', '4', '5', '6', '7', '8', '9', '0']).not.toContain(ROAD_HOTKEY);
  });

  it('實際資料表下每個頁籤的道路格都在 0..BUILDINGS_PER_TAB 之內', () => {
    for (let tab = 0; tab < tabCount(ERA_DEFS); tab++) {
      const index = roadSlotIndex(BUILDING_DEFS, ERA_DEFS, tab);
      expect(index).toBeGreaterThanOrEqual(0);
      expect(index).toBeLessThanOrEqual(BUILDINGS_PER_TAB);
    }
  });
});
