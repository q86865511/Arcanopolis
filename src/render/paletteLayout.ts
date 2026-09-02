// 建築選單列的版面純算式：抽離自 BuildingPalette 以便在不碰 Phaser 的情況下單元測試
// （比照 hudLayout.ts 的作法）。
//
// 下列由上而下是三層：時代頁籤列 → 建築格子列 → 說明列。頁籤列是 M5-W3 加的，
// 高度一律走 paletteBarHeight()——BuildController 的 HUD 死區與 hud.ts 的說明列 y
// 都由它推導，只改這裡兩邊就會同步。

export interface SlotRect {
  x: number;
  y: number;
  size: number;
}

export interface TabRect {
  x: number;
  y: number;
  width: number;
  height: number;
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

/** 時代頁籤列的高度與它到格子列之間的間隙。 */
export const TAB_ROW_H = 22;
export const TAB_ROW_GAP = 4;
/** 頁籤標準寬度：夠放「小鎮 · 人口12」這種最長的鎖定文案；窄視窗時縮到 MIN_TAB_W。 */
export const TAB_WIDTH = 112;
export const MIN_TAB_WIDTH = 48;
export const TAB_GAP = 6;

/** 說明列文字相對於下列頂端的 y 偏移＝內距＋頁籤列＋間隙＋格子＋內距。 */
export function paletteDetailOffsetY(slotSize: number = SLOT_SIZE): number {
  return PALETTE_PAD_Y * 2 + TAB_ROW_H + TAB_ROW_GAP + slotSize;
}

/** 下方資訊列總高＝說明列以上的所有東西＋說明列。格子縮小時整條列跟著變矮。 */
export function paletteBarHeight(slotSize: number = SLOT_SIZE): number {
  return paletteDetailOffsetY(slotSize) + DETAIL_LINE_H;
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

/** 格子列的頂端 y：下列頂端往下讓過內距與整條頁籤列。 */
export function slotRowY(barY: number): number {
  return barY + PALETTE_PAD_Y + TAB_ROW_H + TAB_ROW_GAP;
}

/**
 * 格子列水平置中；回傳每格的左上角座標與邊長，順序即按鍵順序（1..9、0）。
 * slotSize 可外部指定：各時代頁籤的建築數不同，格子邊長若跟著每頁的數量走，
 * 切頁籤時格子會忽大忽小，故呼叫端一律以「最大格子數」算出的邊長餵進來。
 */
export function computeSlotRects(
  width: number,
  barY: number,
  count: number,
  slotSize: number = fitSlotSize(width, count),
): SlotRect[] {
  if (count <= 0) return [];
  const totalWidth = count * slotSize + SLOT_GAP * (count - 1);
  const startX = Math.round((width - totalWidth) / 2);
  const y = slotRowY(barY);
  return Array.from({ length: count }, (_, index) => ({
    x: startX + index * (slotSize + SLOT_GAP),
    y,
    size: slotSize,
  }));
}

/** 頁籤寬度：與 fitSlotSize 同樣的「先用標準值、塞不下才縮、縮到下限為止」模型。 */
export function fitTabWidth(width: number, count: number): number {
  if (count <= 0) return TAB_WIDTH;
  const available = Math.max(0, width - PALETTE_SIDE_RESERVE * 2);
  const perTab = Math.floor((available - TAB_GAP * (count - 1)) / count);
  if (perTab >= TAB_WIDTH) return TAB_WIDTH;
  return Math.max(MIN_TAB_WIDTH, perTab);
}

/** 頁籤列水平置中，順序即 ERA_DEFS 的順序（村莊 → 小鎮 → 城市）。 */
export function computeTabRects(width: number, barY: number, count: number): TabRect[] {
  if (count <= 0) return [];
  const tabWidth = fitTabWidth(width, count);
  const totalWidth = count * tabWidth + TAB_GAP * (count - 1);
  const startX = Math.round((width - totalWidth) / 2);
  const y = barY + PALETTE_PAD_Y;
  return Array.from({ length: count }, (_, index) => ({
    x: startX + index * (tabWidth + TAB_GAP),
    y,
    width: tabWidth,
    height: TAB_ROW_H,
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

/** 命中測試：回傳被點到的頁籤索引，沒命中回 -1。 */
export function tabAt(rects: readonly TabRect[], x: number, y: number): number {
  for (const [index, rect] of rects.entries()) {
    if (x >= rect.x && x < rect.x + rect.width && y >= rect.y && y < rect.y + rect.height) {
      return index;
    }
  }
  return -1;
}
