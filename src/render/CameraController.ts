// 攝影機操作：滑鼠拖曳平移 + 滾輪整數檔縮放。
// 抽成獨立類別而非寫在場景裡，讓之後的場景（擺放模式、小地圖）能重用同一套手感。

import Phaser from 'phaser';

/** 縮放檔位：只用整數倍，像素才不會被非整數縮放糊掉。 */
export const ZOOM_LEVELS: readonly number[] = [1, 2, 3];

/** 起始檔位索引（= 2 倍）。 */
export const DEFAULT_ZOOM_INDEX = 1;

export class CameraController {
  private readonly scene: Phaser.Scene;
  private zoomIndex = DEFAULT_ZOOM_INDEX;
  private dragging = false;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
  }

  /** 掛上輸入監聽並套用起始縮放。場景 create() 時呼叫一次。 */
  attach(): void {
    const input = this.scene.input;
    this.scene.cameras.main.setZoom(ZOOM_LEVELS[this.zoomIndex]);

    input.on(Phaser.Input.Events.POINTER_DOWN, (pointer: Phaser.Input.Pointer) => {
      // 只認左鍵：右鍵留給拆除（BuildController），按著右鍵不該把地圖拖走
      if (!pointer.leftButtonDown()) {
        return;
      }
      this.dragging = true;
    });
    input.on(Phaser.Input.Events.POINTER_UP, () => {
      this.dragging = false;
    });
    // 在畫布外放開滑鼠時 POINTER_UP 不會觸發，否則會卡在拖曳狀態
    input.on(Phaser.Input.Events.POINTER_UP_OUTSIDE, () => {
      this.dragging = false;
    });

    input.on(Phaser.Input.Events.POINTER_MOVE, (pointer: Phaser.Input.Pointer) => {
      if (!this.dragging || !pointer.leftButtonDown()) {
        return;
      }
      const camera = this.scene.cameras.main;
      // 位移除以 zoom 換回世界座標，游標底下的地圖點才會跟著手指走
      camera.scrollX -= (pointer.x - pointer.prevPosition.x) / camera.zoom;
      camera.scrollY -= (pointer.y - pointer.prevPosition.y) / camera.zoom;
    });

    input.on(
      Phaser.Input.Events.POINTER_WHEEL,
      (_pointer: Phaser.Input.Pointer, _over: unknown[], _dx: number, dy: number) => {
        // 觸控板橫向捲動 / Shift+滾輪會送 deltaY=0，不是縮放意圖
        if (dy === 0) {
          return;
        }
        this.setZoomIndex(this.zoomIndex + (dy > 0 ? -1 : 1));
      },
    );
  }

  /** 把攝影機中心對到世界座標 (x, y)。 */
  centerOn(x: number, y: number): void {
    this.scene.cameras.main.centerOn(x, y);
  }

  /** 限制攝影機可捲動的世界範圍，拖到底就停，不會拖出地圖回不來。 */
  setWorldBounds(x: number, y: number, width: number, height: number): void {
    this.scene.cameras.main.setBounds(x, y, width, height);
  }

  get zoom(): number {
    return ZOOM_LEVELS[this.zoomIndex];
  }

  private setZoomIndex(next: number): void {
    const clamped = Phaser.Math.Clamp(next, 0, ZOOM_LEVELS.length - 1);
    if (clamped === this.zoomIndex) {
      return;
    }
    this.zoomIndex = clamped;
    this.scene.cameras.main.setZoom(ZOOM_LEVELS[clamped]);
  }
}
