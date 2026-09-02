// 畫面固定的資訊層：上排資源數值、下排目前選擇的建築。
// 只讀 state 顯示，不含任何規則判斷（能不能蓋是 BuildController 的事）。
//
// 為什麼 HUD 物件要交給 CityScene 掛到專屬的 UI 攝影機：setScrollFactor(0) 只擋住「捲動」，
// 擋不住攝影機縮放——主攝影機 zoom=2 時 HUD 會跟著放大兩倍並偏移。故 HUD 一律由
// 另一台 zoom=1 的攝影機渲染，displayObjects 就是給 CityScene 設定忽略清單用的。

import Phaser from 'phaser';
import { BUILDING_DEFS, POPULATION_CONFIG, RESOURCE_DEFS, resourceName } from './defs';
import { BuildingPalette } from './BuildingPalette';
import { MarketPanel } from './MarketPanel';
import { buildingsOnPage, pageCount } from './buildingSelection';
import { computeBarsLayout, fitFontSize } from './hudLayout';
import {
  ICON_TEXT_GAP,
  POPULATION_COLUMN_WIDTH,
  RESOURCE_ICON_SIZE,
  RESOURCE_ITEM_GAP,
  computeResourceRowLayout,
  resourceRowTotalWidth,
  type ResourceRowLayout,
} from './resourceRowLayout';
import {
  createResourceHistory,
  dailyDelta,
  diagnosePopulation,
  recordDay,
  type PopulationDiagnosis,
  type ResourceHistory,
} from './resourceDiagnostics';
import { PALETTE_PAD_Y, fitSlotSize, paletteBarHeight } from './paletteLayout';
import { INITIAL_SPEED, speedLabel, type GameSpeed } from './gameSpeed';
import { Minimap, type MinimapTile } from './Minimap';
import type { Simulation } from '../core/sim/simulation';
import { getResource, type GameState } from '../core/world/state';
import { timeFromTick } from '../core/sim/time';
import type { BuildingDef } from '../data/types';
import { UI_COLOR } from './ui/theme';
import { drawFramedRect, uiTextStyle } from './ui/draw';

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

/** 兩列文字的基準字級（正常寬度視窗）與縮到不能再縮的下限（見 F3：窄視窗要縮字級才不溢出）。
 *  資源列各項自己的字級由 computeResourceRowLayout 決定（見 resourceRowLayout.ts），
 *  這兩個常數現在只用於人口項與下列說明文字。 */
const RESOURCE_FONT_SIZE = 15;
const SELECTION_FONT_SIZE = 14;
const MIN_FONT_SIZE = 8;

/** 速度指示靠右對齊，資源列／人口項排版要預留這塊寬度，否則長內容會疊到它上面
 *  （內容最長是「暫停」兩個全形字，70px 綽綽有餘，不必像早期估算那樣預留到 90）。 */
const SPEED_TEXT_RESERVE = 70;

/** 趨勢符號的顏色：增為 ok 綠、減為 danger 紅、無資料／持平為 textDim
 *  （0 視為「有資料但沒變化」，與「歷史不足」用同一個次要色但不同符號，避免兩者混淆）。 */
function trendDisplay(delta: number | null): { text: string; color: string } {
  if (delta === null) return { text: '…', color: UI_COLOR.textDim };
  const rounded = Math.round(delta);
  if (rounded > 0) return { text: `▲${rounded}`, color: UI_COLOR.okText };
  if (rounded < 0) return { text: `▼${Math.abs(rounded)}`, color: UI_COLOR.dangerText };
  return { text: '－', color: UI_COLOR.textDim };
}

/** 人口顯示文案＋顏色：直接說出卡在哪一條，而不是只給「6/12」讓玩家自己猜。 */
function populationDisplay(
  diagnosis: PopulationDiagnosis,
  population: number,
  housing: number,
): { text: string; color: string } {
  const base = `人口 ${population}/${housing}`;
  switch (diagnosis.status) {
    case 'starving':
      return { text: `${base} 餓死中!`, color: UI_COLOR.dangerText };
    case 'food-short':
      return { text: `${base} 缺糧`, color: UI_COLOR.dangerText };
    case 'housing-full':
      return { text: `${base} 住房已滿`, color: UI_COLOR.brassText };
    case 'growing':
      return { text: `${base} ↑成長中`, color: UI_COLOR.okText };
  }
}

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
  /** 每項資源一個數值文字與一個趨勢文字（資源名由圖示表達，不印字），索引對齊 RESOURCE_DEFS。 */
  /** 每項資源的圖示；圖示素材缺漏時該格為 null，改畫空占位框。 */
  private resourceIcons: (Phaser.GameObjects.Image | null)[] = [];
  private resourceValueTexts: Phaser.GameObjects.Text[] = [];
  private resourceTrendTexts: Phaser.GameObjects.Text[] = [];
  /** 人口項（含診斷文案）獨立於資源列——文案長度隨診斷結果變動，見 resourceRowLayout.ts 開頭說明。 */
  private populationText!: Phaser.GameObjects.Text;
  /** 資源列排布結果：只在 layout()（視窗尺寸變動）重算，refresh() 只讀不改，見 layoutResourceRow()。 */
  private resourceRowLayout: ResourceRowLayout = { items: [], fontSize: RESOURCE_FONT_SIZE, showTrend: true };
  /** 人口項左緣 x：由 layoutResourceRow() 算出，updateResourceRow() 用它決定人口文字可用寬度。 */
  private populationX = 0;
  /** 每日資源存量歷史（render 端狀態，不進存檔）：見 resourceDiagnostics.ts。 */
  private resourceHistory: ResourceHistory = createResourceHistory();
  /** 最近一次記錄快照的遊戲日序；0 是哨兵值（totalDay 從 1 起算，恆不等於初始值）。 */
  private lastRecordedDay = 0;
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

    // 逐項元件比照 MarketPanel 的作法：預先建好一批 Text，之後只 setText/setPosition/setVisible，
    // 不每幀 new——資源列每 tick 都會刷新，new 出一批新物件是明顯的浪費。
    this.resourceIcons = RESOURCE_DEFS.map((def) => this.makeResourceIcon(def.id));
    this.resourceValueTexts = RESOURCE_DEFS.map(() => this.makeTopText());
    this.resourceTrendTexts = RESOURCE_DEFS.map(() => this.makeTopText());
    this.populationText = this.makeTopText();

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
    // layout() 只排位置／算字級，不填內容；不先跑一次內容更新的話，畫面會空白到第一個 tick 跑完為止。
    this.recordDailySnapshotIfNeeded();
    this.updateResourceRow();
  }

  /**
   * 依「當前視窗尺寸」重排：上列貼頂、下列貼底、兩列都延展成整個視窗寬。
   * 建立時與每次視窗尺寸變更（CityScene 的 resize 監聽）都要呼叫——資訊列是 Graphics 畫出來的
   * 矩形，不會自己跟著視窗長；下列的 y 也是算出來的絕對值，不重排就會停在舊高度的位置。
   *
   * 同時依可用寬度縮字級（見 fitSelectionTextToWidth）：窄視窗下文字實寬會超過畫面，
   * 溢出的字疊到世界區、資源數字讀不完整（見 M3.5 審查 F3，實測 320 寬時溢出 467px）。
   * 資源列改逐項元件後不再吃這條路徑——它的字級由 computeResourceRowLayout 依項目數與
   * 可用寬度決定（不看實際文字內容長度），見 layoutResourceRow()。
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

    this.layoutResourceRow(width);
    this.speedText.setPosition(width - TEXT_PAD_X, TOP_TEXT_PAD_Y);
    this.selectionText.setPosition(Math.round(width / 2), barsLayout.bottomTextY);
    this.palette.layout(width, barsLayout.bottomBar.y);
    this.minimap.layout(width, height, TOP_BAR_H, bottomH);
    this.market.layout(width, height);

    this.fitSelectionTextToWidth();
  }

  /**
   * 排資源列：把 RESOURCE_DEFS 交給 computeResourceRowLayout 排出每項的圖示／文字位置與字級，
   * 只在視窗尺寸變動時算一次（不像人口項要隨內容長度變動，見檔頭說明）。
   * 圖示占位框直接畫進 this.bars——素材尚未生成，先用空框標出「這裡以後會放圖示」。
   */
  private layoutResourceRow(width: number): void {
    const rightReserve = TEXT_PAD_X + SPEED_TEXT_RESERVE;
    const available = Math.max(0, width - TEXT_PAD_X - rightReserve - POPULATION_COLUMN_WIDTH);
    this.resourceRowLayout = computeResourceRowLayout(available, RESOURCE_DEFS.length);

    const iconY = Math.round((TOP_BAR_H - RESOURCE_ICON_SIZE) / 2);
    for (const [index, item] of this.resourceRowLayout.items.entries()) {
      const x = TEXT_PAD_X + item.iconX;
      const icon = this.resourceIcons[index];
      if (icon === null) {
        drawFramedRect(this.bars, x, iconY, RESOURCE_ICON_SIZE, RESOURCE_ICON_SIZE, {
          fill: UI_COLOR.surface,
          fillAlpha: 0.4,
          edge: UI_COLOR.brass,
          edgeAlpha: 0.35,
        });
      } else {
        icon.setPosition(x, iconY);
      }

      const valueText = this.resourceValueTexts[index];
      valueText.setPosition(TEXT_PAD_X + item.valueX, TOP_TEXT_PAD_Y);
      valueText.setFontSize(this.resourceRowLayout.fontSize);

      const trendText = this.resourceTrendTexts[index];
      trendText.setVisible(this.resourceRowLayout.showTrend);
      if (this.resourceRowLayout.showTrend) {
        trendText.setPosition(TEXT_PAD_X + item.trendX, TOP_TEXT_PAD_Y);
        trendText.setFontSize(this.resourceRowLayout.fontSize);
      }
    }

    // 極窄視窗下 11 項資源即使縮到 MIN_FONT_SIZE、隱藏趨勢欄，仍可能超出原本分給資源列的
    // available 預算（圖示恆保留、字級有下限，不能無限縮小——見 computeResourceRowLayout 的說明）。
    // 這裡把 rowEnd 夾在 available 之內，讓人口項最壞情況下疊在資源列尾端，也不會被推到
    // available 之外去和 speedText 卡在同一塊、彼此蓋字。
    const rowEnd = Math.min(resourceRowTotalWidth(this.resourceRowLayout), available);
    const gapToPopulation = this.resourceRowLayout.items.length > 0 ? RESOURCE_ITEM_GAP + ICON_TEXT_GAP : 0;
    this.populationX = TEXT_PAD_X + rowEnd + gapToPopulation;
    this.populationText.setPosition(this.populationX, TOP_TEXT_PAD_Y);
  }

  /** 依 lastWidth 與目前文字內容長度重算下列說明文字的字級（資源列已改用固定欄寬模型，見上）。 */
  private fitSelectionTextToWidth(): void {
    const available = Math.max(0, this.lastWidth - TEXT_PAD_X * 2);
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
    this.recordDailySnapshotIfNeeded();
    this.updateResourceRow();
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
    this.fitSelectionTextToWidth();
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

  /** 偵測日界（totalDay 變動）並記錄一次資源快照；refresh() 每 tick 都呼叫，
   *  但同一天內只會真的記錄一次（recordDay 對同一 day 是覆蓋而非新增，這裡再擋一層省得白算 snapshot）。 */
  private recordDailySnapshotIfNeeded(): void {
    const day = timeFromTick(this.state.tick).totalDay;
    if (day === this.lastRecordedDay) return;
    const snapshot: Record<string, number> = {};
    for (const def of RESOURCE_DEFS) {
      snapshot[def.id] = getResource(this.state, def.id);
    }
    this.resourceHistory = recordDay(this.resourceHistory, day, snapshot);
    this.lastRecordedDay = day;
  }

  /** 每 tick 呼叫：把資源數值／趨勢／人口診斷寫進已建好的 Text 物件（位置與字級由 layoutResourceRow 決定）。 */
  private updateResourceRow(): void {
    // 在職率（employed/jobs）會讓每 tick 產量非整數（審查 F10）；顯示層取整，state 本身不動。
    for (const [index, def] of RESOURCE_DEFS.entries()) {
      const value = Math.floor(getResource(this.state, def.id));
      this.resourceValueTexts[index].setText(String(value));

      if (this.resourceRowLayout.showTrend) {
        const delta = dailyDelta(this.resourceHistory, def.id);
        const trend = trendDisplay(delta);
        this.resourceTrendTexts[index].setText(trend.text);
        this.resourceTrendTexts[index].setColor(trend.color);
      }
    }

    // 顯示住房容量而非只有人數：人口停止成長時最常見的原因就是住滿了，
    // 只給「人口 8」玩家看不出卡在哪；診斷結果直接說出卡在缺糧/住房/餓死中的哪一條。
    const housing = this.state.buildings.reduce((sum, building) => {
      const def = BUILDING_DEFS.find((candidate) => candidate.id === building.type);
      return sum + (def?.housing ?? 0);
    }, 0);
    const diagnosis = diagnosePopulation(this.state, BUILDING_DEFS, POPULATION_CONFIG);
    const population = populationDisplay(diagnosis, this.state.citizens.length, housing);
    this.populationText.setText(population.text);
    this.populationText.setColor(population.color);
    // 人口文案長度隨診斷結果變動，字級沿用舊有的「依實際字元數縮」模型（見檔頭說明）。
    const availableForPopulation = Math.max(
      0,
      this.lastWidth - this.populationX - TEXT_PAD_X - SPEED_TEXT_RESERVE,
    );
    this.populationText.setFontSize(
      fitFontSize(population.text.length, availableForPopulation, RESOURCE_FONT_SIZE, MIN_FONT_SIZE),
    );
  }

  private makeTopText(): Phaser.GameObjects.Text {
    const text = this.scene.add.text(TEXT_PAD_X, TOP_TEXT_PAD_Y, '', uiTextStyle(RESOURCE_FONT_SIZE, TEXT_COLOR));
    this.register(text);
    return text;
  }

  /**
   * 資源圖示：texture key 慣例為 `icon-${資源 id}`（assets.ts 登錄）。
   * 資料表新增資源而圖示尚未生成時回 null，該項退回空占位框（見 layoutResourceRow）——
   * 缺一張圖不該讓整條 HUD 建不起來。
   */
  private makeResourceIcon(resourceId: string): Phaser.GameObjects.Image | null {
    const key = `icon-${resourceId}`;
    if (!this.scene.textures.exists(key)) return null;
    const image = this.scene.add.image(TEXT_PAD_X, TOP_TEXT_PAD_Y, key).setOrigin(0, 0);
    image.setDisplaySize(RESOURCE_ICON_SIZE, RESOURCE_ICON_SIZE);
    image.setScrollFactor(0).setDepth(HUD_DEPTH);
    this.objects.push(image);
    return image;
  }

  private formatSelection(def: BuildingDef): string {
    void resourceName;
    const costText = BuildingPalette.formatCost(def, this.state);
    return `已選 ${def.name}　成本 ${costText}　左鍵放置 / 右鍵拆除 / Esc 取消`;
  }
}
