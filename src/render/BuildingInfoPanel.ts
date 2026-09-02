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
import { getResource, type GameState } from '../core/world/state';
import type { BuildingDef } from '../data/types';
import { ERA_DEFS, resourceName, terrainName } from './defs';
import { PAD, computeInfoPanelRect, lineY } from './buildingInfoLayout';
import { buildingInfoLines, type InfoLine } from './buildingInfoText';
import { drawFramedRect, uiTextStyle } from './ui/draw';
import { UI_COLOR, UI_FRAME } from './ui/theme';

const MAX_INFO_LINES = 9;
const PANEL_BG_ALPHA = 0.97;

function colorOf(tone: InfoLine['tone']): string {
  switch (tone) {
    case 'title': return UI_COLOR.brassText;
    case 'normal': return UI_COLOR.text;
    case 'dim': return UI_COLOR.textDim;
    case 'danger': return UI_COLOR.dangerText;
    case 'ok': return UI_COLOR.okText;
  }
}

export class BuildingInfoPanel {
  private readonly objects: Phaser.GameObjects.GameObject[] = [];
  private graphics!: Phaser.GameObjects.Graphics;
  private texts: Phaser.GameObjects.Text[] = [];
  private current: BuildingDef | null = null;
  private anchorX = 0;
  private anchorY = 0;
  private viewportWidth = 0;
  private viewportHeight = 0;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly state: GameState,
    private readonly depth: number,
  ) {}

  /** 建立所有顯示物件（初始隱藏）。 */
  create(): void {
    this.viewportWidth = this.scene.scale.width;
    this.viewportHeight = this.scene.scale.height;
    this.graphics = this.scene.add.graphics();
    this.register(this.graphics);

    for (let index = 0; index < MAX_INFO_LINES; index++) {
      const text = this.scene.add.text(
        0,
        0,
        '',
        uiTextStyle(index === 0 ? 14 : 12, index === 0 ? UI_COLOR.brassText : UI_COLOR.text),
      );
      this.register(text);
      this.texts.push(text);
    }
    this.setObjectsVisible(false);
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
    this.anchorX = anchorX;
    this.anchorY = anchorY;
    this.redraw();
  }

  hide(): void {
    this.current = null;
    this.setObjectsVisible(false);
  }

  /** 視窗尺寸變化：記住畫面寬高供夾邊用；顯示中則就地重畫。 */
  layout(width: number, height: number): void {
    this.viewportWidth = width;
    this.viewportHeight = height;
    if (this.current !== null) this.redraw();
  }

  /** state 變化（資源增減、人口變動）時重畫內容；未顯示時不做事。 */
  refresh(): void {
    if (this.current !== null) this.redraw();
  }

  private redraw(): void {
    if (this.current === null) return;
    const lines = buildingInfoLines(this.current, {
      population: this.state.citizens.length,
      resourceAmount: (id) => getResource(this.state, id),
      resourceName,
      terrainName,
      eras: ERA_DEFS,
    });
    const rect = computeInfoPanelRect(this.anchorX, this.anchorY, lines.length, this.viewportWidth);

    this.graphics.clear();
    drawFramedRect(this.graphics, rect.x, rect.y, rect.w, rect.h, {
      fill: UI_COLOR.ink,
      fillAlpha: PANEL_BG_ALPHA,
      edge: UI_COLOR.brass,
      edgeAlpha: UI_FRAME.panelEdgeAlpha,
    });
    this.graphics.setVisible(true);

    for (const [index, text] of this.texts.entries()) {
      const line = lines[index];
      if (line === undefined) {
        text.setVisible(false);
        continue;
      }
      text
        .setText(line.text)
        .setColor(colorOf(line.tone))
        .setPosition(rect.x + PAD, lineY(rect, index))
        .setVisible(true);
    }
    void this.viewportHeight;
  }

  private setObjectsVisible(visible: boolean): void {
    this.graphics.setVisible(visible);
    for (const text of this.texts) text.setVisible(visible);
  }

  private register(object: Phaser.GameObjects.Graphics | Phaser.GameObjects.Text): void {
    object.setScrollFactor(0).setDepth(this.depth);
    this.objects.push(object);
  }
}
