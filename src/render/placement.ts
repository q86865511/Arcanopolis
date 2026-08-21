// 擺放慣例：格座標 → sprite 錨點與 depth。iso.ts 是唯讀的純幾何模組，
// 「素材要怎麼貼在格子上」這層慣例集中在本檔，讓 CityScene 與後續的擺放 UI 共用同一份定義。

import { TILE_H, depthKey, tileCenter, type ScreenPoint } from './iso';

/**
 * 地形 sprite 的錨點：origin(0.5, 0.5) 配 tileCenter。
 * 地形圖是 64×32 的完整菱形，圖中心恰為菱形中心。
 */
export function terrainAnchor(gx: number, gy: number): ScreenPoint {
  return tileCenter(gx, gy);
}

export const TERRAIN_ORIGIN_X = 0.5;
export const TERRAIN_ORIGIN_Y = 0.5;

/**
 * 建築 sprite 的錨點：origin(0.5, 1)（底邊中央）配本函式回傳的點。
 * 回傳點 = 地格菱形的「底頂點」（tileCenter 再往下 TILE_H/2）——實測素材（house-01、farm-01、
 * quarry-01）的底面菱形最後一列都落在圖的最底列，故底邊對齊底頂點時底面菱形正好蓋住地格。
 * 若改對齊 tileCenter，建築會整體上浮半格。
 */
export function buildingAnchor(gx: number, gy: number): ScreenPoint {
  const center = tileCenter(gx, gy);
  return { x: center.x, y: center.y + TILE_H / 2 };
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
