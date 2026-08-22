// 畫面固定的資訊層：上排資源數值、下排目前選擇的建築。
// 只讀 state 顯示，不含任何規則判斷（能不能蓋是 BuildController 的事）。
//
// 為什麼 HUD 物件要交給 CityScene 掛到專屬的 UI 攝影機：setScrollFactor(0) 只擋住「捲動」，
// 擋不住攝影機縮放——主攝影機 zoom=2 時 HUD 會跟著放大兩倍並偏移。故 HUD 一律由
// 另一台 zoom=1 的攝影機渲染，displayObjects 就是給 CityScene 設定忽略清單用的。

import Phaser from 'phaser';
import { BUILDING_DEFS, RESOURCE_DEFS, resourceName } from './defs';
import { computeBarsLayout, fitFontSize } from './hudLayout';
import { Minimap, type MinimapTile } from './Minimap';
import { getResource, type GameState } from '../core/world/state';
import type { BuildingDef } from '../data/types';

/** 遠高於任何世界物件（建築 depth 走格座標和，預覽層 PREVIEW_DEPTH）。 */
export const HUD_DEPTH = 1_000_000;

const BAR_ALPHA = 0.55;
const BAR_COLOR = 0x11131f;
/** 上/下資訊列高度（畫面座標）。匯出給 BuildController 用：游標壓在列上時要停用建造預覽/點擊，
 *  否則透過 HUD 文字底下的世界格子仍會被誤觸建造/拆除。 */
export const TOP_BAR_H = 28;
export const BOTTOM_BAR_H = 26;
const TEXT_COLOR = '#f2efe6';

/** 文字距畫面左緣的內距，與上/下列內文字的垂直內距。 */
const TEXT_PAD_X = 10;
const TOP_TEXT_PAD_Y = 6;
const BOTTOM_TEXT_PAD_Y = 5;

/** 兩列文字的基準字級（正常寬度視窗）與縮到不能再縮的下限（見 F3：窄視窗要縮字級才不溢出）。 */
const RESOURCE_FONT_SIZE = 15;
const SELECTION_FONT_SIZE = 14;
const MIN_FONT_SIZE = 8;

/** 可用數字鍵選擇的建築數量上限（與 BuildController 的按鍵表一致）。 */
const SELECTABLE_MAX = 9;

function selectHint(): string {
  const count = Math.min(BUILDING_DEFS.length, SELECTABLE_MAX);
  return `按 1-${count} 選擇建築　左鍵放置 / 右鍵拆除`;
}

export class Hud {
  private readonly objects: Phaser.GameObjects.GameObject[] = [];
  private bars!: Phaser.GameObjects.Graphics;
  private resourceText!: Phaser.GameObjects.Text;
  private selectionText!: Phaser.GameObjects.Text;
  private minimap!: Minimap;
  /** 最近一次 layout() 的視窗寬度：refresh()/setSelection() 換了文字內容後要用同一個寬度重算字級。 */
  private lastWidth = 0;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly state: GameState,
  ) {}

  create(): void {
    this.bars = this.scene.add.graphics();
    this.register(this.bars);

    this.resourceText = this.scene.add.text(TEXT_PAD_X, TOP_TEXT_PAD_Y, this.formatResources(), {
      // 系統 monospace：數字等寬，數值跳動時欄位不會左右抖動
      fontFamily: 'monospace',
      fontSize: '15px',
      color: TEXT_COLOR,
      stroke: '#000000',
      strokeThickness: 3,
    });
    this.register(this.resourceText);

    this.selectionText = this.scene.add.text(TEXT_PAD_X, 0, selectHint(), {
      fontFamily: 'monospace',
      fontSize: '14px',
      color: TEXT_COLOR,
      stroke: '#000000',
      strokeThickness: 3,
    });
    this.register(this.selectionText);

    this.minimap = new Minimap(this.scene, this.state, HUD_DEPTH + 10);
    this.minimap.create();
    this.objects.push(...this.minimap.displayObjects);

    this.layout(this.scene.scale.width, this.scene.scale.height);
  }

  /**
   * 依「當前視窗尺寸」重排：上列貼頂、下列貼底、兩列都延展成整個視窗寬。
   * 建立時與每次視窗尺寸變更（CityScene 的 resize 監聽）都要呼叫——資訊列是 Graphics 畫出來的
   * 矩形，不會自己跟著視窗長；下列的 y 也是算出來的絕對值，不重排就會停在舊高度的位置。
   *
   * 同時依可用寬度縮字級（見 fitTextToWidth）：窄視窗下文字實寬會超過畫面，
   * 溢出的字疊到世界區、資源數字讀不完整（見 M3.5 審查 F3，實測 320 寬時溢出 467px）。
   */
  layout(width: number, height: number): void {
    this.lastWidth = width;
    const barsLayout = computeBarsLayout(height, TOP_BAR_H, BOTTOM_BAR_H, BOTTOM_TEXT_PAD_Y);

    this.bars.clear();
    this.bars.fillStyle(BAR_COLOR, BAR_ALPHA);
    this.bars.fillRect(0, barsLayout.topBar.y, width, barsLayout.topBar.height);
    this.bars.fillRect(0, barsLayout.bottomBar.y, width, barsLayout.bottomBar.height);

    this.resourceText.setPosition(TEXT_PAD_X, TOP_TEXT_PAD_Y);
    this.selectionText.setPosition(TEXT_PAD_X, barsLayout.bottomTextY);
    this.minimap.layout(width, height, TOP_BAR_H, BOTTOM_BAR_H);

    this.fitTextToWidth();
  }

  /** 依 lastWidth 與目前文字內容長度重算兩列字級；文字內容變了（refresh/setSelection）也要重算。 */
  private fitTextToWidth(): void {
    const available = Math.max(0, this.lastWidth - TEXT_PAD_X * 2);
    this.resourceText.setFontSize(
      fitFontSize(this.resourceText.text.length, available, RESOURCE_FONT_SIZE, MIN_FONT_SIZE),
    );
    this.selectionText.setFontSize(
      fitFontSize(this.selectionText.text.length, available, SELECTION_FONT_SIZE, MIN_FONT_SIZE),
    );
  }

  /** 給 CityScene 用：主攝影機要忽略這些物件，否則 HUD 會被畫兩次（一次還帶著世界的縮放）。 */
  get displayObjects(): Phaser.GameObjects.GameObject[] {
    return this.objects;
  }

  /** 每次 sim tick 之後呼叫，把資源數值同步成最新值。 */
  refresh(): void {
    this.resourceText.setText(this.formatResources());
    this.fitTextToWidth();
  }

  updateTerrain(tiles: readonly MinimapTile[]): void {
    this.minimap.updateTerrain(tiles);
  }

  updateViewport(camera: Phaser.Cameras.Scene2D.Camera): void {
    this.minimap.updateViewport(camera);
  }

  setSelection(def: BuildingDef | null): void {
    this.selectionText.setText(def === null ? selectHint() : this.formatSelection(def));
    this.fitTextToWidth();
  }

  private register(object: Phaser.GameObjects.Graphics | Phaser.GameObjects.Text): void {
    object.setScrollFactor(0).setDepth(HUD_DEPTH);
    this.objects.push(object);
  }

  private formatResources(): string {
    // 在職率（employed/jobs）會讓每 tick 產量非整數（審查 F10）；顯示層取整，state 本身不動。
    const resourceText = RESOURCE_DEFS.map(
      (def) => `${def.name} ${String(Math.floor(getResource(this.state, def.id))).padStart(5, ' ')}`,
    ).join('   ');
    return `${resourceText}   人口 ${this.state.citizens.length}`;
  }

  private formatSelection(def: BuildingDef): string {
    const cost = Object.entries(def.cost)
      .map(([id, amount]) => `${resourceName(id)}${amount}`)
      .join(' ');
    const costText = cost.length > 0 ? cost : '免費';
    return `已選 ${def.name}　成本 ${costText}　左鍵放置 / 右鍵拆除 / Esc 取消`;
  }
}
