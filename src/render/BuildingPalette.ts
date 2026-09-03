// 建築選單列：下方資訊列裡的一排時代頁籤，加上該階段的建築格子，每格畫出實際素材縮圖與快捷鍵數字。
//
// 為什麼用縮圖而不是名稱清單：這是城市建造遊戲，玩家認建築靠的是它長什麼樣子，
// 不是靠記「3 號是麵包坊」。舊版下方只有一行「按 1-9/0 選擇建築」，玩家得把 11 棟
// 建築與按鍵的對應全背下來——那不是簡潔，是把資訊藏起來。
//
// 為什麼分頁改成時代頁籤（M5-W3）：12 棟塞一排已經擠，而純索引的「1/2 頁」對玩家沒有意義。
// 依解鎖人口門檻分成村莊/小鎮/城市之後，頁籤同時是分類與進程提示：切到未解鎖的階段可以
// 先看有什麼（世紀帝國式預覽），但格子壓暗、點了只給提示不會選中。
//
// 買不起的建築把縮圖壓暗：可負擔性是玩家每一步都要判斷的事，讓它直接長在格子上，
// 就不必先選了才知道蓋不起。詳細的需求/產出/工人/地形則走懸停的 BuildingInfoPanel。

import Phaser from 'phaser';
import { getResource, type GameState } from '../core/world/state';
import { isBuildingUnlocked } from '../data/eras';
import type { BuildingDef } from '../data/types';
import { ROAD_TEXTURE_KEY, buildingTextureKey } from './assets';
import {
  ROAD_HOTKEY,
  buildingsOnTab,
  eraTabLabel,
  paletteSlotCount,
  roadSlotIndex,
  wrapTab,
  type BuildPick,
} from './buildingSelection';
import { BUILDING_DEFS, ERA_DEFS, ROADS_CONFIG, resourceName } from './defs';
import {
  computeSlotRects,
  computeTabRects,
  fitSlotSize,
  slotAt,
  tabAt,
  type SlotRect,
  type TabRect,
} from './paletteLayout';
import { UI_COLOR, UI_FRAME } from './ui/theme';
import { drawFramedRect, uiTextStyle } from './ui/draw';

/** HUD 色票：與世界的泥土/木頭色系同調，避免純黑方塊壓在像素畫上顯得突兀。 */
const SLOT_BG = UI_COLOR.surface;
const SLOT_BG_ALPHA = 0.92;
const SLOT_BORDER = UI_COLOR.ink;
const SLOT_SELECTED = UI_COLOR.brass;
const SLOT_UNAFFORDABLE = UI_COLOR.danger;
const HOTKEY_COLOR = UI_COLOR.brassText;
const HOTKEY_DIM = UI_COLOR.textDim;

const TAB_FONT_SIZE = 12;

const HOTKEY_LABELS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'];
/** 格子列的標籤：十個建築快捷鍵 ＋ 固定排在最後的道路格。 */
const SLOT_LABELS = [...HOTKEY_LABELS, ROAD_HOTKEY];
/** 一頁最多幾格。hud.ts 的下列高度與 BuildController 的 HUD 死區都由它推導，
 *  兩邊看的必須是同一個數字，否則死區會與實際列高錯開。 */
export const PALETTE_SLOT_COUNT = SLOT_LABELS.length;
/** 縮圖在格子內留的邊，讓數字有地方站、格子邊框看得出來。 */
const THUMB_INSET = 4;

export class BuildingPalette {
  private readonly objects: Phaser.GameObjects.GameObject[] = [];
  private frames!: Phaser.GameObjects.Graphics;
  private thumbs: Phaser.GameObjects.Image[] = [];
  private hotkeys: Phaser.GameObjects.Text[] = [];
  private tabTexts: Phaser.GameObjects.Text[] = [];
  private rects: SlotRect[] = [];
  private tabRects: TabRect[] = [];
  private tab = 0;
  private selected: BuildPick | null = null;
  private lastWidth = 0;
  private lastBarY = 0;
  /** 上一次通報給 onHover 的建築 id，用來擋掉滑鼠在同一格內移動時的重複通報。 */
  private hoveredId: string | null = null;
  private pointerMoveHandler?: (pointer: Phaser.Input.Pointer) => void;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly state: GameState,
    private readonly depth: number,
    private readonly onPick: (pick: BuildPick) => void,
    /** 切換頁籤（點頁籤）時回呼，讓 BuildController 的數字鍵與選單看同一個 tab。 */
    private readonly onTabChange: (tab: number) => void = () => {},
    /** 滑鼠移進/移出格子；def 為 null 代表離開（呼叫端收起資訊面板）。 */
    private readonly onHover: (def: BuildingDef | null, rect: SlotRect | null) => void = () => {},
  ) {}

  create(): void {
    this.frames = this.scene.add.graphics();
    this.register(this.frames);

    for (let i = 0; i < ERA_DEFS.length; i++) {
      const label = this.scene.add
        .text(0, 0, '', uiTextStyle(TAB_FONT_SIZE, UI_COLOR.text))
        .setOrigin(0.5, 0.5);
      this.register(label);
      this.tabTexts.push(label);
    }

    // 格子數固定為按鍵數上限，切頁籤只換內容不重建物件——重建 Image 會讓 Phaser 每次切換
    // 都重新上傳貼圖，且舊物件若忘了 destroy 會靜靜累積。
    for (const label of SLOT_LABELS) {
      const thumb = this.scene.add.image(0, 0, buildingTextureKey(BUILDING_DEFS[0].id)).setOrigin(0.5, 0.5);
      this.register(thumb);
      this.thumbs.push(thumb);

      const hotkey = this.scene.add.text(0, 0, label, uiTextStyle(11, HOTKEY_COLOR));
      this.register(hotkey);
      this.hotkeys.push(hotkey);
    }

    // 懸停靠場景層的 POINTER_MOVE：格子是 Graphics 畫出來的，沒有各自的互動區可掛事件。
    this.pointerMoveHandler = (pointer: Phaser.Input.Pointer) => this.handleHover(pointer.x, pointer.y);
    this.scene.input.on(Phaser.Input.Events.POINTER_MOVE, this.pointerMoveHandler);
  }

  /** 場景關閉時解除場景層監聽：不解掉的話重啟場景會疊上第二個 handler，且舊的持有已銷毀的物件。 */
  destroy(): void {
    if (this.pointerMoveHandler === undefined) return;
    this.scene.input.off(Phaser.Input.Events.POINTER_MOVE, this.pointerMoveHandler);
    this.pointerMoveHandler = undefined;
  }

  get displayObjects(): Phaser.GameObjects.GameObject[] {
    return this.objects;
  }

  setTab(tab: number): void {
    const next = wrapTab(tab, ERA_DEFS);
    // 真的換了頁籤才收起資訊面板：setTab 每次選建築都會被呼叫，無條件收起會讓面板閃爍。
    if (next !== this.tab) {
      this.tab = next;
      this.hoveredId = null;
      this.onHover(null, null);
    }
    this.redraw();
  }

  setSelected(pick: BuildPick | null): void {
    this.selected = pick;
    this.redraw();
  }

  /** 每次 sim tick 後呼叫：資源與人口變動會改變哪些建築買得起、哪個階段解鎖了。 */
  refresh(): void {
    this.redraw();
  }

  layout(width: number, barY: number): void {
    this.lastWidth = width;
    this.lastBarY = barY;
    this.tabRects = computeTabRects(width, barY, ERA_DEFS.length);
    this.relayoutSlots();
    this.redraw();
  }

  /** 回傳是否吃下這次點擊；吃下了 BuildController 就不該再把它當成世界點擊。 */
  handlePointer(x: number, y: number): boolean {
    const tabIndex = tabAt(this.tabRects, x, y);
    if (tabIndex !== -1) {
      this.onTabChange(tabIndex);
      return true;
    }
    const index = slotAt(this.rects, x, y);
    if (index === -1) return false;
    if (index === this.roadIndex()) {
      this.onPick('road');
      return true;
    }
    const def = this.currentBuildings()[index];
    if (def === undefined) return true; // 空格子：吃掉點擊但不做事
    // 未解鎖的建築照樣把 def 交出去：由 BuildController 統一擋下並顯示「需人口 N」，
    // 提示文案與數字鍵路徑才不會分兩處各寫一份。
    this.onPick(def);
    return true;
  }

  /** 各時代的建築數不同，格子邊長仍以格數上限計算——切頁籤時格子不該忽大忽小。 */
  private relayoutSlots(): void {
    this.rects = computeSlotRects(
      this.lastWidth,
      this.lastBarY,
      paletteSlotCount(BUILDING_DEFS, ERA_DEFS, this.tab),
      fitSlotSize(this.lastWidth, PALETTE_SLOT_COUNT),
    );
  }

  private roadIndex(): number {
    return roadSlotIndex(BUILDING_DEFS, ERA_DEFS, this.tab);
  }

  private handleHover(x: number, y: number): void {
    const index = slotAt(this.rects, x, y);
    // 道路格沒有建築資訊卡（成本已寫在說明列），一律當成離開處理。
    const def =
      index === -1 || index === this.roadIndex() ? undefined : this.currentBuildings()[index];
    const id = def?.id ?? null;
    if (id === this.hoveredId) return;
    this.hoveredId = id;
    this.onHover(def ?? null, def === undefined ? null : this.rects[index]);
  }

  private currentBuildings(): BuildingDef[] {
    return buildingsOnTab(BUILDING_DEFS, ERA_DEFS, this.tab);
  }

  private redraw(): void {
    if (this.tabRects.length === 0) return;
    // 頁籤數不變但每個頁籤的建築數不同，切換時要重排格子列（layout() 之外的路徑也會走到）
    this.relayoutSlots();
    const defs = this.currentBuildings();
    const population = this.state.citizens.length;

    this.frames.clear();

    for (const [index, rect] of this.tabRects.entries()) {
      const era = ERA_DEFS[index];
      const unlocked = population >= era.minPopulation;
      const active = index === this.tab;
      drawFramedRect(this.frames, rect.x, rect.y, rect.width, rect.height, {
        fill: unlocked ? SLOT_BG : UI_COLOR.surfaceDisabled,
        fillAlpha: SLOT_BG_ALPHA,
        edge: active ? SLOT_SELECTED : SLOT_BORDER,
        edgeAlpha: active ? 1 : UI_FRAME.slotEdgeAlpha,
        edgeWidth: active ? UI_FRAME.selectedEdgeWidth : UI_FRAME.defaultEdgeWidth,
      });

      const label = this.tabTexts[index];
      label.setText(eraTabLabel(era, population));
      label.setColor(!unlocked ? HOTKEY_DIM : active ? HOTKEY_COLOR : UI_COLOR.text);
      label.setPosition(rect.x + rect.width / 2, rect.y + rect.height / 2);
    }

    const roadIndex = this.roadIndex();
    for (const [index, thumb] of this.thumbs.entries()) {
      const rect = this.rects[index];
      // 道路格用 null 標記（不是任何 BuildingDef），建築格查不到 def 就是空格子。
      const def = rect === undefined ? undefined : index === roadIndex ? null : defs[index];
      const hotkey = this.hotkeys[index];

      if (def === undefined) {
        // 這個階段的建築不到 10 棟：多出來的格子整個收起來，不留空槽——
        // 空槽在只有 2 棟的城市階段會變成一排八個空洞，看起來像素材沒載到。
        thumb.setVisible(false);
        hotkey.setVisible(false);
        continue;
      }

      // 道路不屬於任何時代，永遠可選——它是基礎建設而非時代內容，鎖著只會讓開局無路可鋪。
      const affordable = def === null ? this.canAffordRoad() : this.canAfford(def);
      const unlocked = def === null ? true : isBuildingUnlocked(def, population);
      const selected = this.isSelected(def === null ? 'road' : def);
      drawFramedRect(this.frames, rect.x, rect.y, rect.size, rect.size, {
        fill: unlocked ? SLOT_BG : UI_COLOR.surfaceDisabled,
        fillAlpha: SLOT_BG_ALPHA,
        edge: selected ? SLOT_SELECTED : !unlocked || affordable ? SLOT_BORDER : SLOT_UNAFFORDABLE,
        edgeAlpha: selected ? 1 : UI_FRAME.slotEdgeAlpha,
        edgeWidth: selected ? UI_FRAME.selectedEdgeWidth : UI_FRAME.defaultEdgeWidth,
      });

      const key = def === null ? ROAD_TEXTURE_KEY : buildingTextureKey(def.id);
      thumb.setVisible(true);
      if (this.scene.textures.exists(key)) {
        thumb.setTexture(key);
        // 等比縮到格子內：建築素材高度不一（64×64 到 64×87），用寬高各自的比例取小的那個
        const inner = rect.size - THUMB_INSET * 2;
        const scale = Math.min(inner / thumb.width, inner / thumb.height);
        thumb.setScale(scale);
        thumb.setPosition(rect.x + rect.size / 2, rect.y + rect.size / 2);
        // 買不起或還沒解鎖就壓暗，讓「現在能不能蓋」一眼可分，不必先點進去才知道
        thumb.setTint(affordable && unlocked ? UI_COLOR.thumbNormal : UI_COLOR.thumbDimmed);
      } else {
        thumb.setVisible(false);
      }

      hotkey.setVisible(true);
      // 標籤在 redraw 時才寫入：道路格的位置隨該頁建築數浮動，建立時綁死的位置標籤
      // 會讓道路格頂著隔壁建築的數字（實測顯示「7」而非「R」）。
      hotkey.setText(def === null ? ROAD_HOTKEY : HOTKEY_LABELS[index]);
      hotkey.setColor(affordable && unlocked ? HOTKEY_COLOR : HOTKEY_DIM);
      hotkey.setPosition(rect.x + 3, rect.y + 2);
      hotkey.setDepth(this.depth + 2);
    }
  }

  private canAfford(def: BuildingDef): boolean {
    return this.canAffordCost(def.cost);
  }

  private canAffordRoad(): boolean {
    return this.canAffordCost(ROADS_CONFIG.cost);
  }

  private canAffordCost(cost: Readonly<Record<string, number>>): boolean {
    return Object.entries(cost).every(
      ([resource, amount]) => getResource(this.state, resource) >= amount,
    );
  }

  /** 道路與建築不共用 id 空間，比對得先分流；兩者互斥，選了一個就不會同時選中另一個。 */
  private isSelected(pick: BuildPick): boolean {
    const current = this.selected;
    if (current === null) return false;
    if (current === 'road' || pick === 'road') return current === pick;
    return current.id === pick.id;
  }

  /** 給說明列用：把成本排成「木材 30　石材 10」，不足的項目標出來由呼叫端決定怎麼呈現。 */
  static formatCost(def: BuildingDef, state: GameState): string {
    return BuildingPalette.formatCostEntries(def.cost, state);
  }

  /** 同上，但吃任意成本表——道路的成本來自 ROADS_CONFIG 而不是 BuildingDef。 */
  static formatCostEntries(cost: Readonly<Record<string, number>>, state: GameState): string {
    const entries = Object.entries(cost);
    if (entries.length === 0) return '免費';
    return entries
      .map(([id, amount]) => {
        const short = getResource(state, id) < amount ? '!' : '';
        return `${resourceName(id)}${amount}${short}`;
      })
      .join(' ');
  }

  private register(object: Phaser.GameObjects.Graphics | Phaser.GameObjects.Text | Phaser.GameObjects.Image): void {
    object.setScrollFactor(0).setDepth(this.depth);
    this.objects.push(object);
  }
}
