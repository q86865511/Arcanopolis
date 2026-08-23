// 建築選單列：下方資訊列裡的一排格子，每格畫出該建築的實際素材縮圖與快捷鍵數字。
//
// 為什麼用縮圖而不是名稱清單：這是城市建造遊戲，玩家認建築靠的是它長什麼樣子，
// 不是靠記「3 號是麵包坊」。舊版下方只有一行「按 1-9/0 選擇建築」，玩家得把 11 棟
// 建築與按鍵的對應全背下來——那不是簡潔，是把資訊藏起來。
//
// 買不起的建築把縮圖壓暗並把成本標紅：可負擔性是玩家每一步都要判斷的事，
// 讓它直接長在格子上，就不必先選了才知道蓋不起。

import Phaser from 'phaser';
import { getResource, type GameState } from '../core/world/state';
import type { BuildingDef } from '../data/types';
import { buildingTextureKey } from './assets';
import { buildingsOnPage, pageCount } from './buildingSelection';
import { BUILDING_DEFS, resourceName } from './defs';
import {
  computeSlotRects,
  slotAt,
  type SlotRect,
} from './paletteLayout';

/** HUD 色票：與世界的泥土/木頭色系同調，避免純黑方塊壓在像素畫上顯得突兀。 */
const SLOT_BG = 0x3a2c22;
const SLOT_BG_ALPHA = 0.92;
const SLOT_BORDER = 0x16131c;
const SLOT_SELECTED = 0xd9a441;
/** 與 BuildController 的 PREVIEW_BLOCKED_COLOR 同一個「不行」的紅，全遊戲一致。 */
const SLOT_UNAFFORDABLE = 0xd95763;
const HOTKEY_COLOR = '#d9a441';
const HOTKEY_DIM = '#7a7266';

const HOTKEY_LABELS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'];
/** 縮圖在格子內留的邊，讓數字有地方站、格子邊框看得出來。 */
const THUMB_INSET = 4;

export class BuildingPalette {
  private readonly objects: Phaser.GameObjects.GameObject[] = [];
  private frames!: Phaser.GameObjects.Graphics;
  private thumbs: Phaser.GameObjects.Image[] = [];
  private hotkeys: Phaser.GameObjects.Text[] = [];
  private pageText!: Phaser.GameObjects.Text;
  private rects: SlotRect[] = [];
  private page = 0;
  private selectedId: string | null = null;
  private lastWidth = 0;
  private lastBarY = 0;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly state: GameState,
    private readonly depth: number,
    private readonly onPick: (def: BuildingDef) => void,
  ) {}

  create(): void {
    this.frames = this.scene.add.graphics();
    this.register(this.frames);

    // 格子數固定為一頁上限，換頁只換內容不重建物件——重建 Image 會讓 Phaser 每次換頁
    // 都重新上傳貼圖，且舊物件若忘了 destroy 會靜靜累積。
    for (let i = 0; i < HOTKEY_LABELS.length; i++) {
      const thumb = this.scene.add.image(0, 0, buildingTextureKey(BUILDING_DEFS[0].id)).setOrigin(0.5, 0.5);
      this.register(thumb);
      this.thumbs.push(thumb);

      const hotkey = this.scene.add.text(0, 0, HOTKEY_LABELS[i], {
        fontFamily: 'monospace',
        fontSize: '11px',
        color: HOTKEY_COLOR,
        stroke: '#000000',
        strokeThickness: 3,
      });
      this.register(hotkey);
      this.hotkeys.push(hotkey);
    }

    this.pageText = this.scene.add.text(0, 0, '', {
      fontFamily: 'monospace',
      fontSize: '11px',
      color: HOTKEY_DIM,
      stroke: '#000000',
      strokeThickness: 3,
    });
    this.register(this.pageText);
  }

  get displayObjects(): Phaser.GameObjects.GameObject[] {
    return this.objects;
  }

  setPage(page: number): void {
    this.page = page;
    this.redraw();
  }

  setSelected(def: BuildingDef | null): void {
    this.selectedId = def?.id ?? null;
    this.redraw();
  }

  /** 每次 sim tick 後呼叫：資源變動會改變哪些建築買得起。 */
  refresh(): void {
    this.redraw();
  }

  layout(width: number, barY: number): void {
    this.lastWidth = width;
    this.lastBarY = barY;
    this.rects = computeSlotRects(width, barY, HOTKEY_LABELS.length);
    this.redraw();
  }

  /** 回傳是否吃下這次點擊；吃下了 BuildController 就不該再把它當成世界點擊。 */
  handlePointer(x: number, y: number): boolean {
    const index = slotAt(this.rects, x, y);
    if (index === -1) return false;
    const def = buildingsOnPage(BUILDING_DEFS, this.page)[index];
    if (def === undefined) return true; // 空格子：吃掉點擊但不做事
    this.onPick(def);
    return true;
  }

  private redraw(): void {
    if (this.rects.length === 0) return;
    const defs = buildingsOnPage(BUILDING_DEFS, this.page);

    this.frames.clear();
    for (const [index, rect] of this.rects.entries()) {
      const def = defs[index];
      const thumb = this.thumbs[index];
      const hotkey = this.hotkeys[index];

      if (def === undefined) {
        // 最後一頁不足一列時的空格：畫個凹槽表示「這裡沒有東西」，比直接消失更好讀，
        // 因為格子位置就是按鍵位置，位置消失會讓後面的按鍵對應看起來位移了。
        this.frames.fillStyle(SLOT_BORDER, 0.5);
        this.frames.fillRect(rect.x, rect.y, rect.size, rect.size);
        thumb.setVisible(false);
        hotkey.setVisible(false);
        continue;
      }

      const affordable = this.canAfford(def);
      this.frames.fillStyle(SLOT_BG, SLOT_BG_ALPHA);
      this.frames.fillRect(rect.x, rect.y, rect.size, rect.size);

      const selected = def.id === this.selectedId;
      const borderColor = selected ? SLOT_SELECTED : affordable ? SLOT_BORDER : SLOT_UNAFFORDABLE;
      this.frames.lineStyle(selected ? 2 : 1, borderColor, selected ? 1 : 0.8);
      this.frames.strokeRect(rect.x + 0.5, rect.y + 0.5, rect.size - 1, rect.size - 1);

      const key = buildingTextureKey(def.id);
      thumb.setVisible(true);
      if (this.scene.textures.exists(key)) {
        thumb.setTexture(key);
        // 等比縮到格子內：建築素材高度不一（64×64 到 64×87），用寬高各自的比例取小的那個
        const inner = rect.size - THUMB_INSET * 2;
        const scale = Math.min(inner / thumb.width, inner / thumb.height);
        thumb.setScale(scale);
        thumb.setPosition(rect.x + rect.size / 2, rect.y + rect.size / 2);
        // 買不起就壓暗，讓可負擔性一眼可分，不必先點進去才知道
        thumb.setTint(affordable ? 0xffffff : 0x6b6259);
      } else {
        thumb.setVisible(false);
      }

      hotkey.setVisible(true);
      hotkey.setColor(affordable ? HOTKEY_COLOR : HOTKEY_DIM);
      hotkey.setPosition(rect.x + 3, rect.y + 2);
      hotkey.setDepth(this.depth + 2);
    }

    const total = pageCount(BUILDING_DEFS.length);
    const last = this.rects[this.rects.length - 1];
    this.pageText.setVisible(total > 1);
    if (total > 1) {
      this.pageText.setText(`${this.page + 1}/${total}\n\n[ ] 換頁`);
      this.pageText.setPosition(last.x + last.size + 10, last.y + 3);
    }
    void this.lastWidth;
    void this.lastBarY;
  }

  private canAfford(def: BuildingDef): boolean {
    return Object.entries(def.cost).every(
      ([resource, amount]) => getResource(this.state, resource) >= amount,
    );
  }

  /** 給說明列用：把成本排成「木材 30　石材 10」，不足的項目標出來由呼叫端決定怎麼呈現。 */
  static formatCost(def: BuildingDef, state: GameState): string {
    const entries = Object.entries(def.cost);
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
