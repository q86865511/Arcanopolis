// 畫面固定的資訊層：上排資源數值、下排目前選擇的建築。
// 只讀 state 顯示，不含任何規則判斷（能不能蓋是 BuildController 的事）。
//
// 為什麼 HUD 物件要交給 CityScene 掛到專屬的 UI 攝影機：setScrollFactor(0) 只擋住「捲動」，
// 擋不住攝影機縮放——主攝影機 zoom=2 時 HUD 會跟著放大兩倍並偏移。故 HUD 一律由
// 另一台 zoom=1 的攝影機渲染，displayObjects 就是給 CityScene 設定忽略清單用的。

import Phaser from 'phaser';
import { BUILDING_DEFS, RESOURCE_DEFS, resourceName } from './defs';
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

/** 可用數字鍵選擇的建築數量上限（與 BuildController 的按鍵表一致）。 */
const SELECTABLE_MAX = 9;

function selectHint(): string {
  const count = Math.min(BUILDING_DEFS.length, SELECTABLE_MAX);
  return `按 1-${count} 選擇建築　左鍵放置 / 右鍵拆除`;
}

export class Hud {
  private readonly objects: Phaser.GameObjects.GameObject[] = [];
  private resourceText!: Phaser.GameObjects.Text;
  private selectionText!: Phaser.GameObjects.Text;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly state: GameState,
  ) {}

  create(): void {
    const width = this.scene.scale.width;
    const height = this.scene.scale.height;

    const bars = this.scene.add.graphics();
    bars.fillStyle(BAR_COLOR, BAR_ALPHA);
    bars.fillRect(0, 0, width, TOP_BAR_H);
    bars.fillRect(0, height - BOTTOM_BAR_H, width, BOTTOM_BAR_H);
    this.register(bars);

    this.resourceText = this.scene.add.text(10, 6, this.formatResources(), {
      // 系統 monospace：數字等寬，數值跳動時欄位不會左右抖動
      fontFamily: 'monospace',
      fontSize: '15px',
      color: TEXT_COLOR,
      stroke: '#000000',
      strokeThickness: 3,
    });
    this.register(this.resourceText);

    this.selectionText = this.scene.add.text(10, height - BOTTOM_BAR_H + 5, selectHint(), {
      fontFamily: 'monospace',
      fontSize: '14px',
      color: TEXT_COLOR,
      stroke: '#000000',
      strokeThickness: 3,
    });
    this.register(this.selectionText);
  }

  /** 給 CityScene 用：主攝影機要忽略這些物件，否則 HUD 會被畫兩次（一次還帶著世界的縮放）。 */
  get displayObjects(): Phaser.GameObjects.GameObject[] {
    return this.objects;
  }

  /** 每次 sim tick 之後呼叫，把資源數值同步成最新值。 */
  refresh(): void {
    this.resourceText.setText(this.formatResources());
  }

  setSelection(def: BuildingDef | null): void {
    this.selectionText.setText(def === null ? selectHint() : this.formatSelection(def));
  }

  private register(object: Phaser.GameObjects.Graphics | Phaser.GameObjects.Text): void {
    object.setScrollFactor(0).setDepth(HUD_DEPTH);
    this.objects.push(object);
  }

  private formatResources(): string {
    // 在職率（employed/jobs）會讓每 tick 產量非整數（審查 F10）；顯示層取整，state 本身不動。
    return RESOURCE_DEFS.map(
      (def) => `${def.name} ${String(Math.floor(getResource(this.state, def.id))).padStart(5, ' ')}`,
    ).join('   ');
  }

  private formatSelection(def: BuildingDef): string {
    const cost = Object.entries(def.cost)
      .map(([id, amount]) => `${resourceName(id)}${amount}`)
      .join(' ');
    const costText = cost.length > 0 ? cost : '免費';
    return `已選 ${def.name}　成本 ${costText}　左鍵放置 / 右鍵拆除 / Esc 取消`;
  }
}
