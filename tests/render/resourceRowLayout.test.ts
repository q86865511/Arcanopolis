// 資源列版面（src/render/resourceRowLayout.ts）——比照 tests/render/paletteLayout.test.ts 的風格。
import { describe, expect, it } from 'vitest';
import {
  RESOURCE_ICON_SIZE,
  computeResourceRowLayout,
  resourceRowTotalWidth,
} from '../../src/render/resourceRowLayout';

describe('computeResourceRowLayout', () => {
  it('寬度充足時用基準字級、顯示趨勢欄，且每項都排得出座標', () => {
    const layout = computeResourceRowLayout(1200, 11);
    expect(layout.items.length).toBe(11);
    expect(layout.showTrend).toBe(true);
    expect(layout.fontSize).toBeGreaterThan(0);
    for (const item of layout.items) {
      expect(item.iconX).toBe(item.x);
      expect(item.valueX).toBeGreaterThan(item.iconX);
      expect(item.trendX).toBeGreaterThan(item.valueX);
    }
  });

  it('項目依序左到右排列，彼此不重疊（後一項 x 大於前一項 x+itemWidth）', () => {
    const layout = computeResourceRowLayout(1200, 11);
    for (let i = 1; i < layout.items.length; i++) {
      const prev = layout.items[i - 1];
      const cur = layout.items[i];
      expect(cur.x).toBeGreaterThan(prev.x + prev.itemWidth - 1);
    }
  });

  it('itemCount 為 0 時回空陣列，不 throw', () => {
    expect(() => computeResourceRowLayout(1200, 0)).not.toThrow();
    expect(computeResourceRowLayout(1200, 0).items).toEqual([]);
  });

  it('availableWidth 為 0 或負值時不 throw，仍回傳 itemCount 個項目（降級到最小字級）', () => {
    expect(() => computeResourceRowLayout(0, 11)).not.toThrow();
    expect(() => computeResourceRowLayout(-100, 11)).not.toThrow();
    expect(computeResourceRowLayout(0, 11).items.length).toBe(11);
  });

  it('寬度不足以塞下基準字級時縮小字級（但不隱藏趨勢欄，除非縮到下限仍塞不下）', () => {
    const wide = computeResourceRowLayout(1200, 11);
    const narrow = computeResourceRowLayout(500, 11);
    expect(narrow.fontSize).toBeLessThanOrEqual(wide.fontSize);
  });

  it('極窄視窗：縮到下限仍塞不下時降級隱藏趨勢欄，圖示仍保留（RESOURCE_ICON_SIZE 不變）', () => {
    const layout = computeResourceRowLayout(180, 11);
    expect(layout.showTrend).toBe(false);
    // 圖示恆保留：itemWidth 至少要能放下一個圖示＋一點文字寬度
    for (const item of layout.items) {
      expect(item.itemWidth).toBeGreaterThanOrEqual(RESOURCE_ICON_SIZE);
    }
  });

  it('字級隨可用寬度單調：寬度越窄，字級不會變大', () => {
    const widths = [1200, 800, 500, 300, 150, 50];
    let prev = Infinity;
    for (const w of widths) {
      const fitted = computeResourceRowLayout(w, 11).fontSize;
      expect(fitted).toBeLessThanOrEqual(prev);
      prev = fitted;
    }
  });

  it('項目數變多時，同樣寬度下字級不會變大（項目越多越擠）', () => {
    const few = computeResourceRowLayout(600, 4).fontSize;
    const many = computeResourceRowLayout(600, 11).fontSize;
    expect(many).toBeLessThanOrEqual(few);
  });
});

describe('resourceRowTotalWidth', () => {
  it('空排布回 0', () => {
    expect(resourceRowTotalWidth(computeResourceRowLayout(1200, 0))).toBe(0);
  });

  it('等於最後一項的 x + itemWidth（不含其後的間距）', () => {
    const layout = computeResourceRowLayout(1200, 11);
    const last = layout.items[layout.items.length - 1];
    expect(resourceRowTotalWidth(layout)).toBe(last.x + last.itemWidth);
  });
});
