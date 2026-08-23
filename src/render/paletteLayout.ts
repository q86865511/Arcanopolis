// 建築選單列的版面純算式：抽離自 BuildingPalette 以便在不碰 Phaser 的情況下單元測試
// （比照 hudLayout.ts 的作法）。

export interface SlotRect {
  x: number;
  y: number;
  size: number;
}

/** 標準格子邊長；視窗過窄時等比縮小到 MIN_SLOT_SIZE 為止。 */
export const SLOT_SIZE = 44;
export const MIN_SLOT_SIZE = 24;
export const SLOT_GAP = 4;
/** 格子列上下內距，與其下方說明列的高度。 */
export const PALETTE_PAD_Y = 6;
export const DETAIL_LINE_H = 24;
/** 選單列兩側保留給頁碼等資訊的寬度，格子列不得壓過去。 */
export const PALETTE_SIDE_RESERVE = 96;

/** 下方資訊列總高＝格子列上下內距＋格子＋說明列。格子縮小時整條列跟著變矮。 */
export function paletteBarHeight(slotSize: number = SLOT_SIZE): number {
  return PALETTE_PAD_Y * 2 + slotSize + DETAIL_LINE_H;
}

/**
 * 依可用寬度決定格子邊長：優先用 SLOT_SIZE，塞不下就等比縮，下限 MIN_SLOT_SIZE
 * （再窄就讓它溢出也不繼續縮——縮到看不出建築長相的縮圖沒有意義，那正是這個 UI 存在的理由）。
 */
export function fitSlotSize(width: number, count: number): number {
  if (count <= 0) return SLOT_SIZE;
  const available = Math.max(0, width - PALETTE_SIDE_RESERVE * 2);
  const perSlot = Math.floor((available - SLOT_GAP * (count - 1)) / count);
  if (perSlot >= SLOT_SIZE) return SLOT_SIZE;
  return Math.max(MIN_SLOT_SIZE, perSlot);
}

/** 格子列水平置中；回傳每格的左上角座標與邊長，順序即按鍵順序（1..9、0）。 */
export function computeSlotRects(width: number, barY: number, count: number): SlotRect[] {
  if (count <= 0) return [];
  const size = fitSlotSize(width, count);
  const totalWidth = count * size + SLOT_GAP * (count - 1);
  const startX = Math.round((width - totalWidth) / 2);
  const y = barY + PALETTE_PAD_Y;
  return Array.from({ length: count }, (_, index) => ({
    x: startX + index * (size + SLOT_GAP),
    y,
    size,
  }));
}

/** 命中測試：回傳被點到的格子索引，沒命中回 -1。 */
export function slotAt(rects: readonly SlotRect[], x: number, y: number): number {
  for (const [index, rect] of rects.entries()) {
    if (x >= rect.x && x < rect.x + rect.size && y >= rect.y && y < rect.y + rect.size) {
      return index;
    }
  }
  return -1;
}
