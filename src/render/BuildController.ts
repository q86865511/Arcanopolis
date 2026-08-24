// 建造互動：數字鍵選建築 → 滑鼠 hover 顯示佔格預覽 → 左鍵放置 / 右鍵拆除。
//
// 對 state 只讀（算預覽顏色、找滑鼠底下是哪棟），一切變更都轉成指令丟進 sim.enqueue，
// 下一 tick 才由 core 判定成敗（見 CLAUDE.md 架構鐵則 1）。因此本檔的 canPlace() 只決定
// 預覽的顏色，不是權威判定——真正的守門在 core/sim/commands.ts 的 applyCommand。

import Phaser from 'phaser';
import { footprintTiles } from '../core/world/occupancy';
import type { Simulation } from '../core/sim/simulation';
import { getResource, type Building, type GameState } from '../core/world/state';
import { canBuildAt } from '../core/world/buildable';
import type { BuildingDef } from '../data/types';
import { buildingsOnPage, wrapPage } from './buildingSelection';
import { demolitionWarning } from './demolition';
import { BUILDING_DEFS, buildingSize } from './defs';
import { TOP_BAR_H, bottomBarHeight } from './hud';
import { TILE_H, TILE_W, hitTile, tileCenter, type GridPoint } from './iso';
import { UI_COLOR } from './ui/theme';

/** 壓在建築之上、HUD 之下：預覽要看得見，但不能蓋掉資源數值。 */
export const PREVIEW_DEPTH = 900_000;

/** 按下與放開的距離小於此值才算「點擊」，否則視為拖曳平移。 */
export const CLICK_SLOP_PX = 4;

const PREVIEW_OK_COLOR = UI_COLOR.ok;
const PREVIEW_BLOCKED_COLOR = UI_COLOR.danger;
const PREVIEW_FILL_ALPHA = 0.35;
const PREVIEW_LINE_ALPHA = 0.9;

/** 數字鍵 1..9、0 對應目前分頁上的 10 棟建築；超過 10 棟由 [ ] 換頁（見 buildingSelection.ts）。 */
const SELECT_KEY_NAMES = [
  'ONE',
  'TWO',
  'THREE',
  'FOUR',
  'FIVE',
  'SIX',
  'SEVEN',
  'EIGHT',
  'NINE',
  'ZERO',
];

const MOUSE_BUTTON_LEFT = 0;
const MOUSE_BUTTON_RIGHT = 2;

export class BuildController {
  private preview!: Phaser.GameObjects.Graphics;
  private selected: BuildingDef | null = null;
  private page = 0;
  /** 已提出警告、等待第二次右鍵確認的建築 id；換選建築或按 Esc 都會清掉。 */
  private pendingRemoveId: string | null = null;
  private downX = 0;
  private downY = 0;
  /** 上一次畫出來的預覽長相；相同就不重畫，避免每幀重建 Graphics 指令 */
  private previewSignature = '';

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly state: GameState,
    private readonly sim: Simulation,
    private readonly onSelectionChange: (def: BuildingDef | null, page: number) => void,
    /** HUD 先吃點擊：回 true 代表這一下已被選單格子處理，不再當成世界上的放置/拆除。 */
    private readonly onHudPointer: (x: number, y: number) => boolean = () => false,
    /** 顯示/清除下列的警告訊息；null 代表回到平常的說明文字。 */
    private readonly onNotice: (message: string | null) => void = () => {},
  ) {}

  /** 供 HUD 的建築選單格子呼叫（點格子＝選建築）。 */
  selectDef(def: BuildingDef | null): void {
    this.select(def);
  }

  attach(): void {
    this.preview = this.scene.add.graphics().setDepth(PREVIEW_DEPTH);

    const input = this.scene.input;
    // 右鍵要當拆除用，瀏覽器選單得先關掉，否則每次拆除都彈出來
    input.mouse?.disableContextMenu();

    const keyboard = input.keyboard;
    if (keyboard) {
      // 綁定固定在 index 上、選取當下才查表：換頁不必重綁按鍵，也就不會殘留舊頁的 handler。
      SELECT_KEY_NAMES.forEach((keyName, index) => {
        keyboard.on(`keydown-${keyName}`, () => {
          const def = buildingsOnPage(BUILDING_DEFS, this.page)[index];
          if (def !== undefined) this.select(def);
        });
      });
      keyboard.on('keydown-OPEN_BRACKET', () => this.changePage(-1));
      keyboard.on('keydown-CLOSED_BRACKET', () => this.changePage(1));
      keyboard.on('keydown-ESC', () => this.select(null));
    }

    input.on(Phaser.Input.Events.POINTER_DOWN, (pointer: Phaser.Input.Pointer) => {
      this.downX = pointer.x;
      this.downY = pointer.y;
    });

    input.on(Phaser.Input.Events.POINTER_UP, (pointer: Phaser.Input.Pointer) => {
      // 與 CameraController 的拖曳平移分流：手指移動超過 slop 就當作在拖地圖，不是在下指令
      if (Phaser.Math.Distance.Between(this.downX, this.downY, pointer.x, pointer.y) >= CLICK_SLOP_PX) {
        return;
      }
      // 建築選單的格子就長在下列上，得比 isOverHud 更早判定，否則點格子會被整條列的死區吃掉
      if (pointer.button === MOUSE_BUTTON_LEFT && this.onHudPointer(pointer.x, pointer.y)) {
        return;
      }
      // 游標壓在上/下資訊列上：那是 HUD，底下的世界格子不該被點擊觸發
      if (this.isOverHud(pointer)) {
        return;
      }
      const tile = this.pointerTile(pointer);
      if (tile === null) {
        return;
      }
      if (pointer.button === MOUSE_BUTTON_RIGHT) {
        this.requestRemove(tile);
      } else if (pointer.button === MOUSE_BUTTON_LEFT) {
        this.requestPlace(tile);
      }
    });
  }

  /** 給 CityScene 用：UI 攝影機要忽略預覽層（它屬於世界，會跟著捲動縮放）。 */
  get displayObjects(): Phaser.GameObjects.GameObject[] {
    return [this.preview];
  }

  /** 每幀呼叫。hover 格由 activePointer 現算——攝影機平移／縮放時滑鼠沒動，格子也會變。 */
  update(): void {
    const def = this.selected;
    const pointer = this.scene.input.activePointer;
    const tile = def === null || this.isOverHud(pointer) ? null : this.pointerTile(pointer);
    const placeable = def !== null && tile !== null && this.canPlace(def, tile.gx, tile.gy);

    const signature =
      def === null || tile === null ? 'none' : `${def.id}|${tile.gx}|${tile.gy}|${placeable}`;
    if (signature === this.previewSignature) {
      return;
    }
    this.previewSignature = signature;

    this.preview.clear();
    if (def === null || tile === null) {
      return;
    }
    const color = placeable ? PREVIEW_OK_COLOR : PREVIEW_BLOCKED_COLOR;
    for (const t of footprintTiles(tile.gx, tile.gy, def.size.w, def.size.h)) {
      this.drawTileDiamond(t.x, t.y, color);
    }
  }

  private select(def: BuildingDef | null): void {
    this.clearPendingRemove();
    if (def === this.selected) {
      return;
    }
    this.selected = def;
    this.previewSignature = '';
    this.onSelectionChange(def, this.page);
  }

  /** 換頁後一律取消選取：舊頁選中的建築留著會與畫面上的按鍵提示對不起來。 */
  private changePage(delta: number): void {
    const next = wrapPage(this.page + delta, BUILDING_DEFS.length);
    if (next === this.page) return;
    this.clearPendingRemove();
    this.page = next;
    this.selected = null;
    this.previewSignature = '';
    this.onSelectionChange(null, this.page);
  }

  private requestPlace(tile: GridPoint): void {
    const def = this.selected;
    if (def === null) {
      return;
    }
    // 明顯放不了的（超出地圖、重疊、錢不夠）就不送指令：core 本來就會靜默跳過，
    // 但少送一筆指令，存檔裡的 pendingCommands 也乾淨些。
    if (!this.canPlace(def, tile.gx, tile.gy)) {
      return;
    }
    this.sim.enqueue({ type: 'placeBuilding', buildingType: def.id, x: tile.gx, y: tile.gy });
  }

  private requestRemove(tile: GridPoint): void {
    const target = this.buildingAt(tile.gx, tile.gy);
    if (target === undefined) {
      // 點空地也要清掉待確認狀態：否則玩家點開別處再回來按一次右鍵就會直接拆掉，
      // 那次點擊在他的認知裡是「第一次」。
      this.clearPendingRemove();
      return;
    }
    if (this.pendingRemoveId === target.id) {
      this.clearPendingRemove();
      this.sim.enqueue({ type: 'removeBuilding', buildingId: target.id });
      return;
    }

    const def = BUILDING_DEFS.find((candidate) => candidate.id === target.type);
    const warning = demolitionWarning(this.state, target, def);
    if (warning === null) {
      this.clearPendingRemove();
      this.sim.enqueue({ type: 'removeBuilding', buildingId: target.id });
      return;
    }
    this.pendingRemoveId = target.id;
    this.onNotice(warning);
  }

  private clearPendingRemove(): void {
    if (this.pendingRemoveId === null) return;
    this.pendingRemoveId = null;
    this.onNotice(null);
  }

  /** 游標是否壓在上/下 HUD 資訊列：pointer.x/y 是畫面座標（HUD 用 setScrollFactor(0) 固定於畫面），
   *  不受攝影機平移縮放影響，不必經 positionToCamera 換算。
   *
   *  視窗高度不足以同時容納上下兩列時（<= 兩列高度總和）退化為不擋：否則兩個判定式會覆蓋
   *  整個畫面，所有放置/拆除點擊都被吞掉，玩家會以為遊戲當掉（見 M3.5 審查 F4，
   *  實測 700x50 即觸發——舊 Scale.NONE 固定 540 高不可能出現，改 RESIZE 後才可達）。
   *  寧可極矮視窗下誤觸世界格子，也不要讓玩家完全點不動。 */
  private isOverHud(pointer: Phaser.Input.Pointer): boolean {
    const height = this.scene.scale.height;
    const bottomH = bottomBarHeight(this.scene.scale.width);
    if (height <= TOP_BAR_H + bottomH) {
      return false;
    }
    return pointer.y < TOP_BAR_H || pointer.y > height - bottomH;
  }

  /** 滑鼠位置 → 格座標。範圍外也回傳，讓 canBuildAt 判 false 並保留紅色預覽。 */
  private pointerTile(pointer: Phaser.Input.Pointer): GridPoint | null {
    const world = pointer.positionToCamera(this.scene.cameras.main) as Phaser.Math.Vector2;
    const { gx, gy } = hitTile(world.x, world.y);
    return { gx, gy };
  }

  private canPlace(def: BuildingDef, gx: number, gy: number): boolean {
    // canBuildAt 以 state.worldSize 檢查負座標與完整 footprint 的四側邊界。
    if (!canBuildAt(this.state, def, gx, gy, BUILDING_DEFS)) {
      return false;
    }
    return Object.entries(def.cost).every(
      ([resource, amount]) => getResource(this.state, resource) >= amount,
    );
  }

  private buildingAt(gx: number, gy: number): Building | undefined {
    return this.state.buildings.find((building) => {
      const size = buildingSize(building.type);
      return (
        gx >= building.x &&
        gx < building.x + size.w &&
        gy >= building.y &&
        gy < building.y + size.h
      );
    });
  }

  private drawTileDiamond(gx: number, gy: number, color: number): void {
    const c = tileCenter(gx, gy);
    const points = [
      new Phaser.Geom.Point(c.x, c.y - TILE_H / 2),
      new Phaser.Geom.Point(c.x + TILE_W / 2, c.y),
      new Phaser.Geom.Point(c.x, c.y + TILE_H / 2),
      new Phaser.Geom.Point(c.x - TILE_W / 2, c.y),
    ];
    this.preview.fillStyle(color, PREVIEW_FILL_ALPHA);
    this.preview.fillPoints(points, true);
    this.preview.lineStyle(1, color, PREVIEW_LINE_ALPHA);
    this.preview.strokePoints(points, true);
  }
}
