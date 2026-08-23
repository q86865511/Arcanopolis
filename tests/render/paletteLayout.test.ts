// 建築選單列版面（src/render/paletteLayout.ts）
import { describe, expect, it } from 'vitest';
import {
  DETAIL_LINE_H,
  MIN_SLOT_SIZE,
  PALETTE_PAD_Y,
  SLOT_GAP,
  SLOT_SIZE,
  computeSlotRects,
  fitSlotSize,
  paletteBarHeight,
  slotAt,
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
  it('＝上下內距＋格子＋說明列', () => {
    expect(paletteBarHeight(SLOT_SIZE)).toBe(PALETTE_PAD_Y * 2 + SLOT_SIZE + DETAIL_LINE_H);
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

  it('格子列頂端在資訊列頂端往下一個內距處', () => {
    const barY = 600;
    expect(computeSlotRects(1280, barY, 10)[0].y).toBe(barY + PALETTE_PAD_Y);
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
    expect(slotAt(rects, 5, 620)).toBe(-1);
    expect(slotAt(rects, 640, 100)).toBe(-1);
  });
});
