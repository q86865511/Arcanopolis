// 擺放慣例：格座標 → sprite 錨點與 depth。iso.ts 是唯讀的純幾何模組，
// 「素材要怎麼貼在格子上」這層慣例集中在本檔，讓 CityScene 與後續的擺放 UI 共用同一份定義。

import { TILE_H, depthKey, gridToScreen, tileCenter, type ScreenPoint } from './iso';

/**
 * 建築 sprite 的錨點：origin(0.5, 1)（底邊中央）配本函式回傳的點。
 * y＝佔格「最前緣」那格（gx+w-1, gy+h-1）的地格菱形「底頂點」（tileCenter 再往下 TILE_H/2）
 * ——實測素材（house-01、farm-01、quarry-01）的底面菱形最後一列都落在圖的最底列，
 * 故底邊對齊底頂點時底面菱形正好蓋住地格；多格建築的最前緣格同理。
 * x＝整個 w×h footprint 的螢幕水平中心：footprint 各格的畫面 x 是 (gx-gy) 的線性函數，
 * 故中心 x 等於用「平均 gx、平均 gy」（gx+(w-1)/2, gy+(h-1)/2）代入同一公式；
 * w=h（含 1×1）時剛好與起點格 gridToScreen(gx,gy).x 相同。
 * w=h=1 時本式與舊版逐字相同（不得破壞既有呼叫端）。
 */
export function buildingAnchor(gx: number, gy: number, w = 1, h = 1): ScreenPoint {
  const centerX = gridToScreen(gx + (w - 1) / 2, gy + (h - 1) / 2).x;
  const front = tileCenter(gx + w - 1, gy + h - 1);
  return { x: centerX, y: front.y + TILE_H / 2 };
}

export const BUILDING_ORIGIN_X = 0.5;
export const BUILDING_ORIGIN_Y = 1;

/**
 * 地形統一壓在所有建築之下。
 * 建築 depth 走 depthKey()（可能為負——hitTile 支援負格座標），
 * 地形用一個遠低於任何實際格座標和的常數，保證負格建築也不會被地形蓋住。
 */
export const TERRAIN_DEPTH = -1_000_000;

/**
 * 建築 depth：取佔格「最前緣」那格（gx+w-1, gy+h-1）的 depthKey——
 * 多格建築若取起點格，會與其前緣同列的 1×1 建築同 depth，前後順序變成由插入順序決定。
 */
export function buildingDepth(gx: number, gy: number, w = 1, h = 1): number {
  return depthKey(gx + w - 1, gy + h - 1);
}
