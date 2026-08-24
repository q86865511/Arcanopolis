// 市場面板：按 M 開關，列出可交易資源的庫存與買賣價，點按鈕即下 trade 指令。
//
// 為什麼要有這個面板：W2 把交易的核心（定價、價差、市場建築解鎖）做完了，
// 但玩家沒有任何操作管道——市場蓋了也用不到。這裡補上那條管道。
//
// 面板只在城裡真的有市場建築時才開得起來，與 core 的 trade 指令判定同一條規則；
// 若沒有市場卻讓面板開起來，玩家會按了半天鈕卻什麼都沒發生（指令會被靜默跳過）。

import Phaser from 'phaser';
import type { Simulation } from '../core/sim/simulation';
import { getResource, type GameState } from '../core/world/state';
import type { ResourceDef } from '../data/types';
import { BUILDING_DEFS, ECONOMY_CONFIG, RESOURCE_DEFS } from './defs';
import {
  HEADER_H,
  PAD_X,
  ROW_H,
  TRADE_UNIT,
  buttonRect,
  computePanelRect,
  insidePanel,
  marketButtonAt,
  priceX,
  rowY,
  type Rect,
} from './marketLayout';
import { UI_COLOR, UI_FRAME } from './ui/theme';
import { drawFramedRect, uiTextStyle } from './ui/draw';

const PANEL_BG = UI_COLOR.ink;
const PANEL_BG_ALPHA = 0.97;
const PANEL_EDGE = UI_COLOR.brass;
const BUTTON_BG = UI_COLOR.surface;
const BUTTON_EDGE = UI_COLOR.brass;
const BUTTON_DISABLED = UI_COLOR.surfaceDisabled;
const TEXT_COLOR = UI_COLOR.text;
const DIM_COLOR = UI_COLOR.textDim;
const TITLE_COLOR = UI_COLOR.brassText;

/** 可交易＝資源表有 basePrice；gold 自身沒有價，不會出現在清單裡。 */
function tradableResources(): ResourceDef[] {
  return RESOURCE_DEFS.filter((def) => def.basePrice !== undefined);
}

export class MarketPanel {
  private readonly objects: Phaser.GameObjects.GameObject[] = [];
  private graphics!: Phaser.GameObjects.Graphics;
  private texts: Phaser.GameObjects.Text[] = [];
  private title!: Phaser.GameObjects.Text;
  private footer!: Phaser.GameObjects.Text;
  private goldText!: Phaser.GameObjects.Text;
  private headers: Phaser.GameObjects.Text[] = [];
  private readonly rows: ResourceDef[] = tradableResources();
  private panel: Rect = { x: 0, y: 0, w: 0, h: 0 };
  private open = false;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly state: GameState,
    private readonly sim: Simulation,
    private readonly depth: number,
  ) {}

  create(): void {
    this.graphics = this.scene.add.graphics();
    this.register(this.graphics);

    this.title = this.makeText('市場', TITLE_COLOR, 16);
    // 金幣放在標題列右側：買入按不按得下去全看它，是這個面板最該一眼看到的數字
    this.goldText = this.makeText('', TITLE_COLOR, 13);
    this.footer = this.makeText('', DIM_COLOR, 11);
    // 欄位標題：沒有它，賣出鈕與買入鈕右邊那兩個數字看不出是單價還是總價
    for (const label of ['資源', '庫存', `賣出 得金幣`, `買入 付金幣`]) {
      this.headers.push(this.makeText(label, DIM_COLOR, 11));
    }

    // 每列四段文字：資源名、庫存、賣價、買價；按鈕文字另外兩段。
    for (let i = 0; i < this.rows.length * 6; i++) {
      this.texts.push(this.makeText('', TEXT_COLOR, 12));
    }
    this.setOpen(false);
  }

  get displayObjects(): Phaser.GameObjects.GameObject[] {
    return this.objects;
  }

  get isOpen(): boolean {
    return this.open;
  }

  /** 城裡有任何 enablesTrade 建築才算有市場——與 core 的 trade 指令判定同一條規則。 */
  hasMarket(): boolean {
    return this.state.buildings.some(
      (b) => BUILDING_DEFS.find((d) => d.id === b.type)?.enablesTrade === true,
    );
  }

  /** 切換開關；沒有市場建築時回傳 false 代表沒開成，由呼叫端提示玩家。 */
  toggle(): boolean {
    if (this.open) {
      this.setOpen(false);
      return true;
    }
    if (!this.hasMarket()) return false;
    this.setOpen(true);
    return true;
  }

  close(): void {
    this.setOpen(false);
  }

  layout(width: number, height: number): void {
    this.panel = computePanelRect(width, height, this.rows.length);
    if (this.open) this.redraw();
  }

  /** 每 tick 後更新庫存欄。 */
  refresh(): void {
    if (this.open) this.redraw();
  }

  /** 回傳是否吃下這次點擊。面板是彈出層，落在面板上的點擊一律不得穿透到世界。 */
  handlePointer(x: number, y: number): boolean {
    if (!this.open) return false;
    const hit = marketButtonAt(this.panel, this.rows.length, x, y);
    if (hit !== null) {
      const resource = this.rows[hit.rowIndex];
      this.sim.enqueue({
        type: 'trade',
        direction: hit.action,
        resource: resource.id,
        amount: TRADE_UNIT,
      });
      // 指令要到下一 tick 才套用，這裡不預先改畫面——畫面永遠只反映 state 真正的樣子。
      return true;
    }
    return insidePanel(this.panel, x, y);
  }

  private setOpen(open: boolean): void {
    this.open = open;
    this.graphics.setVisible(open);
    this.title.setVisible(open);
    this.goldText.setVisible(open);
    this.footer.setVisible(open);
    for (const text of this.headers) text.setVisible(open);
    for (const text of this.texts) text.setVisible(open);
    if (open) this.redraw();
  }

  private redraw(): void {
    const panel = this.panel;
    const g = this.graphics;
    g.clear();
    drawFramedRect(g, panel.x, panel.y, panel.w, panel.h, {
      fill: PANEL_BG,
      fillAlpha: PANEL_BG_ALPHA,
      edge: PANEL_EDGE,
      edgeAlpha: UI_FRAME.panelEdgeAlpha,
    });

    this.title.setPosition(panel.x + PAD_X, panel.y + 12);
    this.title.setVisible(true);

    const gold = getResource(this.state, 'gold');
    this.goldText.setText(`金幣 ${Math.floor(gold)}`);
    this.goldText.setPosition(panel.x + panel.w - PAD_X, panel.y + 15).setOrigin(1, 0);

    // 欄位標題列：貼在第一列之上，用暗色與內容區分
    const headerY = panel.y + HEADER_H - 17;
    const sellCol = buttonRect(panel, 0, 'sell');
    const buyCol = buttonRect(panel, 0, 'buy');
    this.headers[0].setPosition(panel.x + PAD_X, headerY);
    this.headers[1].setPosition(panel.x + PAD_X + 96, headerY);
    this.headers[2].setPosition(sellCol.x, headerY);
    this.headers[3].setPosition(buyCol.x, headerY);
    g.fillStyle(PANEL_EDGE, 0.25);
    g.fillRect(panel.x + PAD_X, headerY + 15, panel.w - PAD_X * 2, 1);
    for (const [index, resource] of this.rows.entries()) {
      const y = rowY(panel, index) + 5;
      const stock = Math.floor(getResource(this.state, resource.id));
      const sellPrice = resource.basePrice!;
      const buyPrice = sellPrice * (1 + ECONOMY_CONFIG.marketBuyMarkup);
      const canSell = stock >= TRADE_UNIT;
      const canBuy = gold >= buyPrice * TRADE_UNIT;

      const base = index * 6;
      this.place(base + 0, `${resource.name}`, panel.x + PAD_X, y, TEXT_COLOR);
      this.place(base + 1, `${stock}`, panel.x + PAD_X + 96, y, DIM_COLOR);

      const sellRect = buttonRect(panel, index, 'sell');
      const buyRect = buttonRect(panel, index, 'buy');
      this.drawButton(g, sellRect, canSell);
      this.drawButton(g, buyRect, canBuy);

      this.place(base + 2, `賣${TRADE_UNIT}`, sellRect.x + 8, sellRect.y + 3, canSell ? TEXT_COLOR : DIM_COLOR);
      this.place(base + 3, `${sellPrice * TRADE_UNIT}`, priceX(panel, index, 'sell'), y, DIM_COLOR);
      this.place(base + 4, `買${TRADE_UNIT}`, buyRect.x + 8, buyRect.y + 3, canBuy ? TEXT_COLOR : DIM_COLOR);
      this.place(base + 5, `${Math.round(buyPrice * TRADE_UNIT)}`, priceX(panel, index, 'buy'), y, DIM_COLOR);
    }

    this.footer.setText(`賣價為基準價，買價含 ${Math.round(ECONOMY_CONFIG.marketBuyMarkup * 100)}% 價差　M 或 Esc 關閉`);
    this.footer.setPosition(panel.x + PAD_X, panel.y + panel.h - 18);
    this.footer.setVisible(true);
  }

  private drawButton(g: Phaser.GameObjects.Graphics, rect: Rect, enabled: boolean): void {
    drawFramedRect(g, rect.x, rect.y, rect.w, rect.h, {
      fill: enabled ? BUTTON_BG : BUTTON_DISABLED,
      edge: enabled ? BUTTON_EDGE : BUTTON_BG,
      edgeAlpha: enabled ? UI_FRAME.slotEdgeAlpha : 1,
    });
  }

  private place(index: number, text: string, x: number, y: number, color: string): void {
    const object = this.texts[index];
    object.setText(text);
    object.setPosition(x, y);
    object.setColor(color);
    object.setVisible(true);
  }

  private makeText(content: string, color: string, size: number): Phaser.GameObjects.Text {
    const text = this.scene.add.text(0, 0, content, uiTextStyle(size, color));
    this.register(text);
    return text;
  }

  private register(object: Phaser.GameObjects.Graphics | Phaser.GameObjects.Text): void {
    object.setScrollFactor(0).setDepth(this.depth);
    this.objects.push(object);
  }
}

/** 面板每列高度，供外部（例如測試）核對版面常數未漂移。 */
export const MARKET_ROW_H = ROW_H;
