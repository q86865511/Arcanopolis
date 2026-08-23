// 建築選單分頁（src/render/buildingSelection.ts）——重點是鎖住「資料表再長也沒有選不到的建築」。
// 背景：M4-W1 曾因按鍵表只綁 1-9 而讓第 10 棟（鐵匠鋪）永遠選不到，且無測試守住。
import { describe, expect, it } from 'vitest';
import { BUILDINGS_PER_PAGE, buildingsOnPage, pageCount, wrapPage } from '../../src/render/buildingSelection';
import { BUILDING_DEFS } from '../../src/render/defs';
import type { BuildingDef } from '../../src/data/types';

function fakeDefs(count: number): BuildingDef[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `b${i}`,
    name: `建築${i}`,
    size: { w: 1, h: 1 },
    cost: {},
    production: {},
    housing: 0,
    jobs: 0,
  }));
}

describe('pageCount', () => {
  it('未滿一頁也算一頁；空表也回 1（不會出現 0 頁而除以零）', () => {
    expect(pageCount(0)).toBe(1);
    expect(pageCount(1)).toBe(1);
    expect(pageCount(BUILDINGS_PER_PAGE)).toBe(1);
  });

  it('超過一頁時無條件進位', () => {
    expect(pageCount(BUILDINGS_PER_PAGE + 1)).toBe(2);
    expect(pageCount(BUILDINGS_PER_PAGE * 2)).toBe(2);
    expect(pageCount(BUILDINGS_PER_PAGE * 2 + 1)).toBe(3);
  });
});

describe('wrapPage', () => {
  it('末頁往後回到第一頁、第一頁往前到末頁（頭尾循環）', () => {
    const total = BUILDINGS_PER_PAGE * 3;
    expect(wrapPage(3, total)).toBe(0);
    expect(wrapPage(-1, total)).toBe(2);
  });

  it('只有一頁時任何頁碼都回 0', () => {
    expect(wrapPage(5, 3)).toBe(0);
    expect(wrapPage(-5, 3)).toBe(0);
  });
});

describe('buildingsOnPage', () => {
  it('每頁最多 BUILDINGS_PER_PAGE 棟，最後一頁只回實際剩餘數', () => {
    const defs = fakeDefs(BUILDINGS_PER_PAGE + 3);
    expect(buildingsOnPage(defs, 0)).toHaveLength(BUILDINGS_PER_PAGE);
    expect(buildingsOnPage(defs, 1)).toHaveLength(3);
  });

  it('分頁不重疊也不遺漏：各頁串起來等於原陣列', () => {
    const defs = fakeDefs(BUILDINGS_PER_PAGE * 2 + 4);
    const flattened = Array.from({ length: pageCount(defs.length) }, (_, page) =>
      buildingsOnPage(defs, page),
    ).flat();
    expect(flattened).toEqual(defs);
  });
});

describe('實際建築表的可及性（回歸鎖）', () => {
  it('data/buildings.json 的每一棟建築都落在某一頁上，沒有選不到的建築', () => {
    const reachable = new Set(
      Array.from({ length: pageCount(BUILDING_DEFS.length) }, (_, page) =>
        buildingsOnPage(BUILDING_DEFS, page),
      )
        .flat()
        .map((def) => def.id),
    );
    for (const def of BUILDING_DEFS) {
      expect(reachable.has(def.id)).toBe(true);
    }
    expect(reachable.size).toBe(BUILDING_DEFS.length);
  });

  it('每一棟建築在其所在頁上的索引都對得到一個數字鍵（0..9）', () => {
    for (const [index, def] of BUILDING_DEFS.entries()) {
      const page = Math.floor(index / BUILDINGS_PER_PAGE);
      const slot = index % BUILDINGS_PER_PAGE;
      expect(slot).toBeLessThan(BUILDINGS_PER_PAGE);
      expect(buildingsOnPage(BUILDING_DEFS, page)[slot]?.id).toBe(def.id);
    }
  });
});
