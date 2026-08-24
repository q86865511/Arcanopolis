// UI 繪製 helper：把 HUD、選單、面板重複的「填底＋描框」與文字樣式收在一處。
// 樣式 token 在 ./theme.ts，本檔只負責把 token 套到 Phaser 物件上。

import Phaser from 'phaser';
import { UI_FONT, UI_FRAME } from './theme';

export interface FramedRectStyle {
  /** 底色（0x）。 */
  fill: number;
  fillAlpha?: number;
  /** 框線色（0x）。 */
  edge: number;
  edgeAlpha?: number;
  edgeWidth?: number;
}

/**
 * 畫一個「填底＋描框」的矩形——面板、按鈕、選單格子都是這個形狀。
 *
 * 框線刻意偏移半像素並把長寬各縮 1：Phaser 的 strokeRect 以線寬中心對齊路徑，
 * 1px 線畫在整數座標上會橫跨兩個像素、在 pixelArt 模式下糊成兩條半亮的邊。
 * 偏移 0.5 讓線正好落在一個像素裡，框才是銳利的一格。
 */
export function drawFramedRect(
  g: Phaser.GameObjects.Graphics,
  x: number,
  y: number,
  w: number,
  h: number,
  style: FramedRectStyle,
): void {
  g.fillStyle(style.fill, style.fillAlpha ?? 1);
  g.fillRect(x, y, w, h);
  const width = style.edgeWidth ?? UI_FRAME.defaultEdgeWidth;
  g.lineStyle(width, style.edge, style.edgeAlpha ?? 1);
  g.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
}

/**
 * UI 文字樣式：全 UI 統一 monospace ＋ 黑描邊。
 * monospace 的理由是數字等寬——數值跳動時欄位不會左右抖動；
 * 描邊的理由是 HUD 文字會壓在任意地形上，沒有描邊在草地與沙灘上的可讀性差很多。
 */
export function uiTextStyle(
  fontSize: number,
  color: string,
): Phaser.Types.GameObjects.Text.TextStyle {
  return {
    fontFamily: UI_FONT.family,
    fontSize: `${fontSize}px`,
    color,
    stroke: UI_FONT.stroke,
    strokeThickness: UI_FONT.strokeThickness,
  };
}
