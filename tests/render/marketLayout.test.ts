// 市場面板版面與命中判定（src/render/marketLayout.ts）
import { describe, expect, it } from 'vitest';
import {
  FOOTER_H,
  HEADER_H,
  PANEL_W,
  ROW_H,
  TRADE_UNIT,
  buttonRect,
  computePanelRect,
  insidePanel,
  marketButtonAt,
  PRICE_W,
  panelHeight,
  priceX,
  rowY,
} from '../../src/render/marketLayout';

const ROWS = 9;
const panel = computePanelRect(1280, 720, ROWS);

describe('computePanelRect', () => {
  it('面板置中於畫面', () => {
    expect(panel.x + panel.w / 2).toBeCloseTo(640, 0);
    expect(panel.y + panel.h / 2).toBeCloseTo(360, 0);
  });

  it('高度＝表頭＋列數×列高＋表尾', () => {
    expect(panel.h).toBe(HEADER_H + ROWS * ROW_H + FOOTER_H);
    expect(panelHeight(ROWS)).toBe(panel.h);
  });

  it('寬度固定，不隨視窗變動（面板是彈出層，不是版面的一部分）', () => {
    expect(computePanelRect(600, 400, ROWS).w).toBe(PANEL_W);
    expect(computePanelRect(2560, 1440, ROWS).w).toBe(PANEL_W);
  });
});

describe('rowY 與 buttonRect', () => {
  it('列由上而下等距排列', () => {
    for (let i = 1; i < ROWS; i++) {
      expect(rowY(panel, i) - rowY(panel, i - 1)).toBe(ROW_H);
    }
  });

  it('賣出鈕在買入鈕左邊，兩者不重疊', () => {
    const sell = buttonRect(panel, 0, 'sell');
    const buy = buttonRect(panel, 0, 'buy');
    expect(sell.x + sell.w).toBeLessThanOrEqual(buy.x);
  });

  it('按鈕都在面板範圍內，不會被裁掉', () => {
    for (let i = 0; i < ROWS; i++) {
      for (const action of ['sell', 'buy'] as const) {
        const rect = buttonRect(panel, i, action);
        expect(rect.x).toBeGreaterThanOrEqual(panel.x);
        expect(rect.x + rect.w).toBeLessThanOrEqual(panel.x + panel.w);
        expect(rect.y).toBeGreaterThanOrEqual(panel.y);
        expect(rect.y + rect.h).toBeLessThanOrEqual(panel.y + panel.h);
      }
    }
  });
});

describe('總價欄位', () => {
  it('四位數總價仍留在面板內（工具買 10 個要 450 金幣，三位數已很接近邊界）', () => {
    const digitWidth = 12 * 0.62; // 12px 等寬字的估算字寬，與 hudLayout 的 CHAR_WIDTH_RATIO 同源
    for (const action of ['sell', 'buy'] as const) {
      const endX = priceX(panel, 0, action) + digitWidth * 4;
      expect(endX).toBeLessThanOrEqual(panel.x + panel.w);
    }
  });

  it('賣價欄不會壓到買入鈕', () => {
    const sellPriceEnd = priceX(panel, 0, 'sell') + PRICE_W - 6;
    expect(sellPriceEnd).toBeLessThanOrEqual(buttonRect(panel, 0, 'buy').x);
  });
});

describe('marketButtonAt', () => {
  it('點在按鈕中心命中對應的列與動作', () => {
    for (let i = 0; i < ROWS; i++) {
      for (const action of ['sell', 'buy'] as const) {
        const rect = buttonRect(panel, i, action);
        expect(marketButtonAt(panel, ROWS, rect.x + rect.w / 2, rect.y + rect.h / 2)).toEqual({
          rowIndex: i,
          action,
        });
      }
    }
  });

  it('點在面板空白處回 null（不會誤觸交易）', () => {
    expect(marketButtonAt(panel, ROWS, panel.x + 8, panel.y + 8)).toBeNull();
  });

  it('點在面板外回 null', () => {
    expect(marketButtonAt(panel, ROWS, 5, 5)).toBeNull();
  });

  it('列數為 0 時不會命中任何鈕', () => {
    expect(marketButtonAt(panel, 0, panel.x + panel.w / 2, panel.y + HEADER_H)).toBeNull();
  });
});

describe('insidePanel', () => {
  it('面板內為 true、面板外為 false（面板是彈出層，點擊不得穿透到世界）', () => {
    expect(insidePanel(panel, panel.x + 1, panel.y + 1)).toBe(true);
    expect(insidePanel(panel, panel.x - 1, panel.y + 1)).toBe(false);
    expect(insidePanel(panel, panel.x + panel.w, panel.y)).toBe(false);
  });
});

describe('交易單位', () => {
  it('是正整數——core 的 trade 指令驗證會拒絕小數與 0', () => {
    expect(Number.isInteger(TRADE_UNIT)).toBe(true);
    expect(TRADE_UNIT).toBeGreaterThan(0);
  });
});
