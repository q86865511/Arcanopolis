// 建築資訊面板：滑鼠懸停在建築選單格子上時，浮在格子上方的資訊卡。
// 內容：需要什麼（成本、原料）、產出什麼、要幾個工人／住幾個人、地形限制、解鎖條件。
//
// 為什麼獨立成一個類別：選單格子只放得下縮圖與快捷鍵，玩家在蓋之前需要的判斷資訊
// （買不買得起、原料鏈接得上嗎、蓋在哪）放在格子上會擠爆；懸停才顯示既不佔常駐空間，
// 又不必先選了才知道。版面計算走 buildingInfoLayout.ts 的純函數，文字走 buildingInfoText.ts。
//
// 【介面契約，M5-W3 分工用】呼叫端（Hud / BuildingPalette 的 hover）只依賴以下公開方法，
// 內部實作由另一位實作者填入；改動公開簽章前先與呼叫端同步。

import Phaser from 'phaser';
import type { GameState } from '../core/world/state';
import type { BuildingDef } from '../data/types';

export class BuildingInfoPanel {
  private readonly objects: Phaser.GameObjects.GameObject[] = [];
  private current: BuildingDef | null = null;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly state: GameState,
    private readonly depth: number,
  ) {}

  /** 建立所有顯示物件（初始隱藏）。 */
  create(): void {
    void this.scene;
    void this.depth;
  }

  get displayObjects(): readonly Phaser.GameObjects.GameObject[] {
    return this.objects;
  }

  get isVisible(): boolean {
    return this.current !== null;
  }

  /**
   * 顯示 def 的資訊卡。anchorX 是觸發格子的水平中心、anchorY 是格子的頂邊（皆為螢幕座標）；
   * 面板畫在格子正上方、水平置中於 anchorX，並夾在畫面內不出界。
   */
  show(def: BuildingDef, anchorX: number, anchorY: number): void {
    this.current = def;
    void anchorX;
    void anchorY;
    void this.state;
  }

  hide(): void {
    this.current = null;
  }

  /** 視窗尺寸變化：記住畫面寬高供夾邊用；顯示中則就地重畫。 */
  layout(width: number, height: number): void {
    void width;
    void height;
  }

  /** state 變化（資源增減、人口變動）時重畫內容；未顯示時不做事。 */
  refresh(): void {}
}
