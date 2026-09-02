// 建築選單列版面（src/render/paletteLayout.ts）
import { describe, expect, it } from 'vitest';
import {
  DETAIL_LINE_H,
  MIN_SLOT_SIZE,
  MIN_TAB_WIDTH,
  PALETTE_PAD_Y,
  SLOT_GAP,
  SLOT_SIZE,
  TAB_GAP,
  TAB_ROW_GAP,
  TAB_ROW_H,
  TAB_WIDTH,
  computeSlotRects,
  computeTabRects,
  fitSlotSize,
  fitTabWidth,
  paletteBarHeight,
  paletteDetailOffsetY,
  slotAt,
  slotRowY,
  tabAt,
} from '../../src/render/paletteLayout';

describe('fitSlotSize', () => {
  it('寬度充足時用標準邊長', () => {
    expect(fitSlotSize(1280, 10)).toBe(SLOT_SIZE);
  });

  it('寬度不足時縮小，但不低於下限', () => {
    const narrow = fitSlotSize(400, 10);
    expect(narrow).toBeLessThan(SLOT_SIZE);
    expect(narrow).toBeGreaterThanOrEqual(MIN_SLOT_SIZE);
    expect(fitSlotSize(1, 10)).toBe(MIN_SLOT_SIZE);
  });

  it('格子數為 0 時回標準邊長而非 NaN 或負值', () => {
    expect(fitSlotSize(1280, 0)).toBe(SLOT_SIZE);
  });
});

describe('paletteBarHeight', () => {
  it('＝上下內距＋頁籤列＋間隙＋格子＋說明列', () => {
    expect(paletteBarHeight(SLOT_SIZE)).toBe(
      PALETTE_PAD_Y * 2 + TAB_ROW_H + TAB_ROW_GAP + SLOT_SIZE + DETAIL_LINE_H,
    );
  });

  it('說明列 y 偏移＋說明列高＝整條列高（兩者由同一式推導，不會各算各的）', () => {
    expect(paletteDetailOffsetY(SLOT_SIZE) + DETAIL_LINE_H).toBe(paletteBarHeight(SLOT_SIZE));
  });

  it('格子縮小時整條列跟著變矮', () => {
    expect(paletteBarHeight(MIN_SLOT_SIZE)).toBeLessThan(paletteBarHeight(SLOT_SIZE));
  });
});

describe('computeSlotRects', () => {
  it('格子數為 0 時回空陣列', () => {
    expect(computeSlotRects(1280, 600, 0)).toEqual([]);
  });

  it('回傳數量等於格子數，且每格邊長一致', () => {
    const rects = computeSlotRects(1280, 600, 10);
    expect(rects).toHaveLength(10);
    expect(new Set(rects.map((r) => r.size)).size).toBe(1);
  });

  it('水平置中：左右留白相等（誤差 ≤1px，來自取整）', () => {
    const width = 1280;
    const rects = computeSlotRects(width, 600, 10);
    const first = rects[0];
    const last = rects[rects.length - 1];
    const leftGap = first.x;
    const rightGap = width - (last.x + last.size);
    expect(Math.abs(leftGap - rightGap)).toBeLessThanOrEqual(1);
  });

  it('相鄰格子間距等於 SLOT_GAP，不重疊也不黏在一起', () => {
    const rects = computeSlotRects(1280, 600, 10);
    for (let i = 1; i < rects.length; i++) {
      expect(rects[i].x - (rects[i - 1].x + rects[i - 1].size)).toBe(SLOT_GAP);
    }
  });

  it('格子列頂端讓過內距與整條頁籤列（否則格子會壓在頁籤上）', () => {
    const barY = 600;
    expect(computeSlotRects(1280, barY, 10)[0].y).toBe(barY + PALETTE_PAD_Y + TAB_ROW_H + TAB_ROW_GAP);
    expect(computeSlotRects(1280, barY, 10)[0].y).toBe(slotRowY(barY));
  });

  it('可指定邊長：各階段建築數不同，格子仍維持同一大小', () => {
    const size = fitSlotSize(1280, 10);
    const few = computeSlotRects(1280, 600, 2, size);
    const many = computeSlotRects(1280, 600, 6, size);
    expect(few[0].size).toBe(size);
    expect(many[0].size).toBe(size);
    // 數量不同但都置中，起點自然不同
    expect(few[0].x).toBeGreaterThan(many[0].x);
  });
});

describe('fitTabWidth', () => {
  it('寬度充足時用標準寬', () => {
    expect(fitTabWidth(1280, 3)).toBe(TAB_WIDTH);
  });

  it('寬度不足時縮小，但不低於下限', () => {
    expect(fitTabWidth(1, 3)).toBe(MIN_TAB_WIDTH);
  });

  it('頁籤數為 0 時回標準寬而非 NaN', () => {
    expect(fitTabWidth(1280, 0)).toBe(TAB_WIDTH);
  });
});

describe('computeTabRects', () => {
  it('頁籤數為 0 時回空陣列', () => {
    expect(computeTabRects(1280, 600, 0)).toEqual([]);
  });

  it('坐在下列頂端的內距處，高度為 TAB_ROW_H', () => {
    const barY = 600;
    const rects = computeTabRects(1280, barY, 3);
    expect(rects).toHaveLength(3);
    for (const rect of rects) {
      expect(rect.y).toBe(barY + PALETTE_PAD_Y);
      expect(rect.height).toBe(TAB_ROW_H);
    }
  });

  it('水平置中且相鄰間距等於 TAB_GAP', () => {
    const width = 1280;
    const rects = computeTabRects(width, 600, 3);
    const first = rects[0];
    const last = rects[rects.length - 1];
    expect(Math.abs(first.x - (width - (last.x + last.width)))).toBeLessThanOrEqual(1);
    for (let i = 1; i < rects.length; i++) {
      expect(rects[i].x - (rects[i - 1].x + rects[i - 1].width)).toBe(TAB_GAP);
    }
  });

  it('頁籤列與格子列不重疊（頁籤底緣在格子頂端之上）', () => {
    const barY = 600;
    const tab = computeTabRects(1280, barY, 3)[0];
    expect(tab.y + tab.height).toBeLessThanOrEqual(slotRowY(barY));
  });
});

describe('slotAt', () => {
  const rects = computeSlotRects(1280, 600, 10);

  it('命中格子中心回傳該索引', () => {
    for (const [index, rect] of rects.entries()) {
      expect(slotAt(rects, rect.x + rect.size / 2, rect.y + rect.size / 2)).toBe(index);
    }
  });

  it('格子左上角算命中、右下角外緣算未命中（半開區間，相鄰格不會同時命中）', () => {
    const rect = rects[3];
    expect(slotAt(rects, rect.x, rect.y)).toBe(3);
    expect(slotAt(rects, rect.x + rect.size, rect.y)).not.toBe(3);
  });

  it('格子列之外回傳 -1（列上的空白處不該吃掉點擊）', () => {
    expect(slotAt(rects, 5, 660)).toBe(-1);
    expect(slotAt(rects, 640, 100)).toBe(-1);
  });
});

describe('tabAt', () => {
  const rects = computeTabRects(1280, 600, 3);

  it('命中頁籤中心回傳該索引', () => {
    for (const [index, rect] of rects.entries()) {
      expect(tabAt(rects, rect.x + rect.width / 2, rect.y + rect.height / 2)).toBe(index);
    }
  });

  it('頁籤之外回傳 -1；格子列的高度不會誤判成頁籤', () => {
    expect(tabAt(rects, 5, 606)).toBe(-1);
    expect(tabAt(rects, 640, slotRowY(600) + 10)).toBe(-1);
  });
});
