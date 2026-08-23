// 市場面板版面純算式：與 Phaser 無關，讓命中判定可以被測試（比照 hudLayout/paletteLayout）。

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type TradeAction = 'sell' | 'buy';

export interface MarketHit {
  rowIndex: number;
  action: TradeAction;
}

export const PANEL_W = 470;
export const ROW_H = 26;
export const HEADER_H = 54;
export const FOOTER_H = 26;
export const PAD_X = 16;
export const BUTTON_W = 66;
export const BUTTON_H = 20;
/** 每個按鈕右側留給總價數字的寬度。工具買 10 個要 450 金幣——三位數字在 12px 等寬下
 *  約 22px，留 44px 讓四位數也不會頂到面板邊。 */
export const PRICE_W = 44;

/** 每次點擊的交易單位數。固定量而非可調輸入：面板要能一眼看懂，
 *  數量輸入框在像素 UI 裡是個大工程，而 10 這個量剛好讓玩家能在幾次點擊內感受到價差。 */
export const TRADE_UNIT = 10;

export function panelHeight(rowCount: number): number {
  return HEADER_H + rowCount * ROW_H + FOOTER_H;
}

/** 面板置中於畫面。 */
export function computePanelRect(width: number, height: number, rowCount: number): Rect {
  const h = panelHeight(rowCount);
  return {
    x: Math.round((width - PANEL_W) / 2),
    y: Math.round((height - h) / 2),
    w: PANEL_W,
    h,
  };
}

export function rowY(panel: Rect, rowIndex: number): number {
  return panel.y + HEADER_H + rowIndex * ROW_H;
}

/** 賣出鈕與買入鈕的位置；兩者等寬並排在列的右半。 */
export function buttonRect(panel: Rect, rowIndex: number, action: TradeAction): Rect {
  const y = rowY(panel, rowIndex) + Math.round((ROW_H - BUTTON_H) / 2);
  const buyX = panel.x + panel.w - PAD_X - PRICE_W - BUTTON_W;
  const sellX = buyX - PRICE_W - BUTTON_W - 12;
  return { x: action === 'sell' ? sellX : buyX, y, w: BUTTON_W, h: BUTTON_H };
}

function inside(rect: Rect, x: number, y: number): boolean {
  return x >= rect.x && x < rect.x + rect.w && y >= rect.y && y < rect.y + rect.h;
}

/** 點到哪一列的哪個鈕；沒點到任何鈕回 null。 */
export function marketButtonAt(panel: Rect, rowCount: number, x: number, y: number): MarketHit | null {
  for (let rowIndex = 0; rowIndex < rowCount; rowIndex++) {
    for (const action of ['sell', 'buy'] as const) {
      if (inside(buttonRect(panel, rowIndex, action), x, y)) {
        return { rowIndex, action };
      }
    }
  }
  return null;
}

/** 按鈕右側總價文字的起始 x；用來確認數字不會溢出面板。 */
export function priceX(panel: Rect, rowIndex: number, action: TradeAction): number {
  const rect = buttonRect(panel, rowIndex, action);
  return rect.x + rect.w + 6;
}

/** 點擊是否落在面板範圍內（落在面板上但不在鈕上時，要吃掉點擊避免穿透到世界）。 */
export function insidePanel(panel: Rect, x: number, y: number): boolean {
  return inside(panel, x, y);
}
