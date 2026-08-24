// 畫面固定的資訊層：上排資源數值、下排目前選擇的建築。
// 只讀 state 顯示，不含任何規則判斷（能不能蓋是 BuildController 的事）。
//
// 為什麼 HUD 物件要交給 CityScene 掛到專屬的 UI 攝影機：setScrollFactor(0) 只擋住「捲動」，
// 擋不住攝影機縮放——主攝影機 zoom=2 時 HUD 會跟著放大兩倍並偏移。故 HUD 一律由
// 另一台 zoom=1 的攝影機渲染，displayObjects 就是給 CityScene 設定忽略清單用的。

import Phaser from 'phaser';
import { BUILDING_DEFS, RESOURCE_DEFS, resourceName } from './defs';
import { BuildingPalette } from './BuildingPalette';
import { MarketPanel } from './MarketPanel';
import { buildingsOnPage, pageCount } from './buildingSelection';
import { computeBarsLayout, fitFontSize } from './hudLayout';
import { PALETTE_PAD_Y, fitSlotSize, paletteBarHeight } from './paletteLayout';
import { INITIAL_SPEED, speedLabel, type GameSpeed } from './gameSpeed';
import { Minimap, type MinimapTile } from './Minimap';
import type { Simulation } from '../core/sim/simulation';
import { getResource, type GameState } from '../core/world/state';
import type { BuildingDef } from '../data/types';
import { UI_COLOR } from './ui/theme';
import { uiTextStyle } from './ui/draw';

/** 遠高於任何世界物件（建築 depth 走格座標和，預覽層 PREVIEW_DEPTH）。 */
export const HUD_DEPTH = 1_000_000;

/** 上列只是薄薄一條讀數，半透明讓世界透出來不影響閱讀；
 *  下列是主要控制面，0.55 的透明度在 26px 高時看不出來，長到 76px 後草地整片透上來，
 *  格子看起來像浮在草皮上而不是坐在面板裡——控制面必須是實心的。 */
const TOP_BAR_ALPHA = 0.72;
const BOTTOM_BAR_ALPHA = 0.94;
const BAR_COLOR = UI_COLOR.ink;
/** 下列頂緣的一道細線：把控制面與世界切開，不靠陰影或漸層。 */
const BAR_EDGE_COLOR = UI_COLOR.brass;
/** 上/下資訊列高度（畫面座標）。匯出給 BuildController 用：游標壓在列上時要停用建造預覽/點擊，
 *  否則透過 HUD 文字底下的世界格子仍會被誤觸建造/拆除。 */
export const TOP_BAR_H = 28;
/** 一頁的格子數，與 BuildingPalette 的快捷鍵表一致；下列高度由格子邊長決定。 */
const PALETTE_SLOT_COUNT = 10;

/** 下列高度隨視窗寬度變動（窄視窗時格子會縮小），因此是函式而非常數。
 *  BuildController 的 HUD 死區判定必須用同一個值，否則死區會與實際列高錯開，
 *  在列外側留下一條「看得到世界卻點不到」或「看不到列卻點不到世界」的縫。 */
export function bottomBarHeight(width: number): number {
  return paletteBarHeight(fitSlotSize(width, PALETTE_SLOT_COUNT));
}
const TEXT_COLOR = UI_COLOR.text;
const SPEED_COLOR = UI_COLOR.brassText;
const SPEED_PAUSED_COLOR = UI_COLOR.dangerText;
/** 警告文字色，與拆除預覽、買不起的格子邊框同一個「不行」的紅。 */
const NOTICE_COLOR = UI_COLOR.dangerText;

/** 文字距畫面左緣的內距，與上/下列內文字的垂直內距。 */
const TEXT_PAD_X = 10;
const TOP_TEXT_PAD_Y = 6;
const BOTTOM_TEXT_PAD_Y = 5;

/** 兩列文字的基準字級（正常寬度視窗）與縮到不能再縮的下限（見 F3：窄視窗要縮字級才不溢出）。 */
const RESOURCE_FONT_SIZE = 15;
const SELECTION_FONT_SIZE = 14;
const MIN_FONT_SIZE = 8;

function selectHint(page: number): string {
  // 格子上已經畫出建築長相與快捷鍵，這行只補格子講不出來的操作方式
  void page;
  void buildingsOnPage;
  void pageCount;
  return '點格子或按數字鍵選建築　左鍵放置 / 右鍵拆除　空白鍵暫停 / - = 調速';
}

export class Hud {
  private readonly objects: Phaser.GameObjects.GameObject[] = [];
  private bars!: Phaser.GameObjects.Graphics;
  private resourceText!: Phaser.GameObjects.Text;
  private selectionText!: Phaser.GameObjects.Text;
  private minimap!: Minimap;
  private palette!: BuildingPalette;
  private market!: MarketPanel;
  private selectedDef: BuildingDef | null = null;
  private speedText!: Phaser.GameObjects.Text;
  private speed: GameSpeed = INITIAL_SPEED;
  private notice: string | null = null;
  private lastPage = 0;
  /** 最近一次 layout() 的視窗寬度：refresh()/setSelection() 換了文字內容後要用同一個寬度重算字級。 */
  private lastWidth = 0;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly state: GameState,
    private readonly sim: Simulation,
    /** 點擊選單格子時回呼；由 CityScene 接到 BuildController.selectById 上。 */
    private readonly onPickBuilding: (def: BuildingDef) => void = () => {},
  ) {}

  create(): void {
    this.bars = this.scene.add.graphics();
    this.register(this.bars);

    this.resourceText = this.scene.add.text(TEXT_PAD_X, TOP_TEXT_PAD_Y, this.formatResources(), uiTextStyle(15, TEXT_COLOR));
    this.register(this.resourceText);

    // 置中對齊格子列：說明的是格子，靠左會讓兩者看起來各自為政
    this.selectionText = this.scene.add.text(0, 0, selectHint(0), uiTextStyle(14, TEXT_COLOR)).setOrigin(0.5, 0);
    this.register(this.selectionText);

    // 靠右對齊：速度是狀態指示而非常按的控制項，放右側不與左側資源數值搶第一眼
    this.speedText = this.scene.add.text(0, TOP_TEXT_PAD_Y, speedLabel(this.speed), uiTextStyle(14, SPEED_COLOR)).setOrigin(1, 0);
    this.register(this.speedText);

    this.palette = new BuildingPalette(this.scene, this.state, HUD_DEPTH + 1, (def) =>
      this.onPickBuilding(def),
    );
    this.palette.create();
    this.objects.push(...this.palette.displayObjects);

    this.market = new MarketPanel(this.scene, this.state, this.sim, HUD_DEPTH + 20);
    this.market.create();
    this.objects.push(...this.market.displayObjects);

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
    const bottomH = bottomBarHeight(width);
    const slotSize = fitSlotSize(width, PALETTE_SLOT_COUNT);
    // 說明列坐在格子列底下：文字 y 由格子實際高度推得，格子縮小時說明列跟著上移，
    // 不會在窄視窗留一條空隙或壓到格子。
    const detailPadY = PALETTE_PAD_Y * 2 + slotSize;
    const barsLayout = computeBarsLayout(height, TOP_BAR_H, bottomH, detailPadY);

    this.bars.clear();
    this.bars.fillStyle(BAR_COLOR, TOP_BAR_ALPHA);
    this.bars.fillRect(0, barsLayout.topBar.y, width, barsLayout.topBar.height);
    this.bars.fillStyle(BAR_COLOR, BOTTOM_BAR_ALPHA);
    this.bars.fillRect(0, barsLayout.bottomBar.y, width, barsLayout.bottomBar.height);
    this.bars.fillStyle(BAR_EDGE_COLOR, 0.55);
    this.bars.fillRect(0, barsLayout.bottomBar.y, width, 1);

    this.resourceText.setPosition(TEXT_PAD_X, TOP_TEXT_PAD_Y);
    this.speedText.setPosition(width - TEXT_PAD_X, TOP_TEXT_PAD_Y);
    this.selectionText.setPosition(Math.round(width / 2), barsLayout.bottomTextY);
    this.palette.layout(width, barsLayout.bottomBar.y);
    this.minimap.layout(width, height, TOP_BAR_H, bottomH);
    this.market.layout(width, height);

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
    this.palette.refresh();
    this.market.refresh();
    this.renderDetailLine();
  }

  updateTerrain(tiles: readonly MinimapTile[]): void {
    this.minimap.updateTerrain(tiles);
  }

  updateViewport(camera: Phaser.Cameras.Scene2D.Camera): void {
    this.minimap.updateViewport(camera);
  }

  setSelection(def: BuildingDef | null, page = 0): void {
    this.selectedDef = def;
    this.lastPage = page;
    this.palette.setPage(page);
    this.palette.setSelected(def);
    this.renderDetailLine();
  }

  /** 顯示一則覆蓋說明列的警告（如拆除確認）；傳 null 回到平常內容。 */
  setNotice(message: string | null): void {
    this.notice = message;
    this.renderDetailLine();
  }

  private renderDetailLine(): void {
    if (this.notice !== null) {
      this.selectionText.setText(this.notice);
      this.selectionText.setColor(NOTICE_COLOR);
    } else {
      this.selectionText.setText(
        this.selectedDef === null ? selectHint(this.lastPage) : this.formatSelection(this.selectedDef),
      );
      this.selectionText.setColor(TEXT_COLOR);
    }
    this.fitTextToWidth();
  }

  setSpeed(speed: GameSpeed): void {
    this.speed = speed;
    this.speedText.setText(speedLabel(speed));
    this.speedText.setColor(speed.paused ? SPEED_PAUSED_COLOR : SPEED_COLOR);
  }

  /** 回傳點擊是否被 HUD 吃掉（市場面板優先，其次建築選單格子）。 */
  handlePalettePointer(x: number, y: number): boolean {
    if (this.market.handlePointer(x, y)) return true;
    return this.palette.handlePointer(x, y);
  }

  /** 切換市場面板；沒有市場建築時回 false，由呼叫端提示玩家。 */
  toggleMarket(): boolean {
    return this.market.toggle();
  }

  get marketOpen(): boolean {
    return this.market.isOpen;
  }

  closeMarket(): void {
    this.market.close();
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
    // 顯示住房容量而非只有人數：人口停止成長時最常見的原因就是住滿了，
    // 只給「人口 8」玩家看不出卡在哪；「人口 8/8」直接說出下一步要蓋房。
    const housing = this.state.buildings.reduce((sum, building) => {
      const def = BUILDING_DEFS.find((candidate) => candidate.id === building.type);
      return sum + (def?.housing ?? 0);
    }, 0);
    return `${resourceText}   人口 ${this.state.citizens.length}/${housing}`;
  }

  private formatSelection(def: BuildingDef): string {
    void resourceName;
    const costText = BuildingPalette.formatCost(def, this.state);
    return `已選 ${def.name}　成本 ${costText}　左鍵放置 / 右鍵拆除 / Esc 取消`;
  }
}
