// 資源列版面純算式：把「N 項資源」排進可用寬度，決定每項圖示／數值／趨勢文字的位置與字級，
// 抽離自 hud.ts 是為了能在不碰 Phaser 的情況下單元測試（比照 hudLayout.ts、paletteLayout.ts 的作法）。
//
// 為什麼獨立成新檔而非塞進 hudLayout.ts：hudLayout.ts 管的是「上下兩條資訊列的高度與位置」，
// 是縱向的整體版面；這裡管的是「資源列內部橫向要不要塞得下」，是另一個維度的排布問題，
// 兩者的輸入輸出型別完全不同，合在一起會讓 hudLayout.ts 的測試意圖變模糊。
//
// 人口項不在這裡排：它的文案長度隨診斷結果變動（「住房已滿」「餓死中!」…長短不一），
// 沿用 hudLayout.ts 既有的 fitFontSize（依實際字元數縮字級）比這裡「固定欄寬」的模型更合適
// ——見 hud.ts 的 layoutResourceRow()／updateResourceRow()。

import { CHAR_WIDTH_RATIO } from './hudLayout';

/** 圖示預留邊長：素材由另一任務生成，這裡先留空間＋短標籤（見任務簡報）。降級序列中圖示恆保留，
 *  不隨窄視窗縮小或隱藏——縮到看不出圖示意義就失去預留的目的（比照 paletteLayout.ts 格子縮圖的理由）。 */
export const RESOURCE_ICON_SIZE = 24;
/** 圖示與文字之間的間距。 */
export const ICON_TEXT_GAP = 3;
/** 項與項之間的間距。 */
export const RESOURCE_ITEM_GAP = 8;
/** 人口項與資源列之間保留的欄寬（診斷文案可能較長，如「人口 12/12 住房已滿」，約 10~11 字元；
 *  150px 在人口項自己的 fitFontSize 下仍能維持接近基準字級，不必犧牲資源列的可用寬度）。 */
export const POPULATION_COLUMN_WIDTH = 150;

/** 「數值」與「趨勢」文字的估計字元數（monospace，供 CHAR_WIDTH_RATIO 估寬用）。
 *  例：「12000」5 字元、「▲12」約 3 字元——資源名由圖示表達不再印字（2026-08-31 使用者裁決，
 *  省下的寬度讓 800px 窄視窗也塞得下 11 項）；11 種資源要擠在一列，抓太寬會讓趨勢欄在 1280 就先被降級隱藏。 */
const CHARS_LABEL_VALUE = 5;
const CHARS_TREND = 3;

const BASE_FONT_SIZE = 14;
/** 與 hud.ts 的 MIN_FONT_SIZE 同值：11 項全開趨勢欄在窄視窗下需要這個下限才擠得進去。 */
const MIN_FONT_SIZE = 8;

export interface ResourceItemLayout {
  /** 本項最左緣（＝圖示格左緣），相對於資源列容器原點（呼叫端自行加上列的絕對 x）。 */
  x: number;
  /** 圖示格左緣，恆等於 x（保留獨立欄位讓呼叫端不必記住這個等式）。 */
  iconX: number;
  /** 「標籤＋數值」文字左緣。 */
  valueX: number;
  /** 趨勢文字左緣；showTrend=false 時仍算得出座標，但呼叫端應把該文字物件設為不可見。 */
  trendX: number;
  /** 本項總寬（含圖示，不含右側的 RESOURCE_ITEM_GAP）。 */
  itemWidth: number;
}

export interface ResourceRowLayout {
  items: ResourceItemLayout[];
  fontSize: number;
  /** 降級序列的第二步是否已觸發：縮到 MIN_FONT_SIZE 仍塞不下時隱藏趨勢欄。 */
  showTrend: boolean;
}

function textWidth(chars: number, fontSize: number): number {
  return chars * fontSize * CHAR_WIDTH_RATIO;
}

/** count 個項目、每項 chars 個字元、字級 fontSize 時的整條列總寬。 */
function totalWidth(itemCount: number, chars: number, fontSize: number): number {
  const perItem = RESOURCE_ICON_SIZE + ICON_TEXT_GAP + textWidth(chars, fontSize);
  return itemCount * perItem + Math.max(0, itemCount - 1) * RESOURCE_ITEM_GAP;
}

/** 依可用寬度反解字級（比照 hudLayout.ts 的 fitFontSize 模型，但這裡的「文字長度」是
 *  固定欄寬模型的估計字元數，乘上項目數，而非單一字串長度）。 */
function fitFontSizeForRow(itemCount: number, chars: number, availableWidth: number): number {
  if (totalWidth(itemCount, chars, BASE_FONT_SIZE) <= availableWidth) return BASE_FONT_SIZE;
  const fixedPart = itemCount * (RESOURCE_ICON_SIZE + ICON_TEXT_GAP) + Math.max(0, itemCount - 1) * RESOURCE_ITEM_GAP;
  const remaining = availableWidth - fixedPart;
  if (remaining <= 0) return MIN_FONT_SIZE;
  const fitted = Math.floor(remaining / (itemCount * chars * CHAR_WIDTH_RATIO));
  return Math.max(MIN_FONT_SIZE, Math.min(BASE_FONT_SIZE, fitted));
}

/**
 * 依可用寬度與項目數排布資源列。降級序列（窄視窗）：
 * 1. 先縮字級（BASE_FONT_SIZE → MIN_FONT_SIZE）。
 * 2. 縮到下限仍塞不下 → 隱藏趨勢欄，字級依「無趨勢欄」的較窄需求重新計算。
 * 3. 圖示恆保留，不進入降級序列。
 *
 * itemCount<=0 或 availableWidth<=0 時回傳空排布，不 throw（比照 fitSlotSize／fitFontSize 的邊界處理）。
 */
export function computeResourceRowLayout(availableWidth: number, itemCount: number): ResourceRowLayout {
  if (itemCount <= 0) {
    return { items: [], fontSize: MIN_FONT_SIZE, showTrend: true };
  }
  const width = Math.max(0, availableWidth);

  let showTrend = true;
  let fontSize = fitFontSizeForRow(itemCount, CHARS_LABEL_VALUE + CHARS_TREND, width);
  if (totalWidth(itemCount, CHARS_LABEL_VALUE + CHARS_TREND, fontSize) > width) {
    showTrend = false;
    fontSize = fitFontSizeForRow(itemCount, CHARS_LABEL_VALUE, width);
  }

  const chars = showTrend ? CHARS_LABEL_VALUE + CHARS_TREND : CHARS_LABEL_VALUE;
  const valueTextWidth = textWidth(CHARS_LABEL_VALUE, fontSize);
  const itemWidth = RESOURCE_ICON_SIZE + ICON_TEXT_GAP + textWidth(chars, fontSize);

  const items: ResourceItemLayout[] = [];
  let x = 0;
  for (let i = 0; i < itemCount; i++) {
    const valueX = x + RESOURCE_ICON_SIZE + ICON_TEXT_GAP;
    items.push({ x, iconX: x, valueX, trendX: valueX + valueTextWidth, itemWidth });
    x += itemWidth + RESOURCE_ITEM_GAP;
  }
  return { items, fontSize, showTrend };
}

/** 資源列排完後的總寬（含最後一項，不含其後的 RESOURCE_ITEM_GAP）；
 *  hud.ts 用它算人口項該從哪個 x 開始畫。空排布回 0。 */
export function resourceRowTotalWidth(layout: ResourceRowLayout): number {
  if (layout.items.length === 0) return 0;
  const last = layout.items[layout.items.length - 1];
  return last.x + last.itemWidth;
}
