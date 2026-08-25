// 階梯高度的渲染慣例：core 的 elevationLevelAt 給每格 0-3 的階層，
// 本檔決定「一階畫多高」以及所有因墊高而生的座標修正。
//
// 高度是純視覺屬性（core 玩法不讀它），所以階高、裙邊、拾取修正全部留在 render 層；
// 但「哪一格多高」必須是 state 的純函數（seed 推導、不吃 override），
// 否則砍樹會讓地面升降、分塊重烘會閃爍。

import { elevationLevelAt } from '../core/world/terrain';
import { hitTile, type GridPoint } from './iso';

/** 一階的螢幕高度（px）。3 階最高 24px，不到一個 tile 高，山地有立體感又不會遮死後排。 */
export const ELEVATION_STEP = 8;

/** 最高階層（與 core 的量化一致；拾取要從這裡往下枚舉）。 */
export const MAX_ELEVATION_LEVEL = 3;

export interface ElevationSource {
  worldSeed: number;
  worldSize: number;
}

/** 整數格的階層。越界回 0（世界之外是海）。 */
export function levelAt(state: ElevationSource, gx: number, gy: number): number {
  return elevationLevelAt(state.worldSeed, state.worldSize, gx, gy);
}

/** 整數格的 y 位移（負值＝往螢幕上方墊高）。 */
export function elevationOffsetY(state: ElevationSource, gx: number, gy: number): number {
  return -levelAt(state, gx, gy) * ELEVATION_STEP;
}

/**
 * 浮點座標的 y 位移：對四鄰階層做雙線性插值。
 * 給居民用——他們的座標以 0.1 格步進，若直接取所在格的階層，
 * 跨過階地邊緣的瞬間會垂直跳 8px；插值讓他們沿斜坡走上去。
 */
export function floatElevationOffsetY(state: ElevationSource, fx: number, fy: number): number {
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const tx = fx - x0;
  const ty = fy - y0;
  const l00 = levelAt(state, x0, y0);
  const l10 = levelAt(state, x0 + 1, y0);
  const l01 = levelAt(state, x0, y0 + 1);
  const l11 = levelAt(state, x0 + 1, y0 + 1);
  const level = (l00 * (1 - tx) + l10 * tx) * (1 - ty) + (l01 * (1 - tx) + l11 * tx) * ty;
  return -level * ELEVATION_STEP;
}

/**
 * 高度感知的滑鼠拾取，取代平面版 hitTile。
 *
 * 原理：階層 L 的格子頂面畫在「平面位置再上移 L×STEP」，所以點 (wx, wy) 命中
 * 該格頂面 ⟺ hitTile(wx, wy + L×STEP) 就是該格且該格階層恰為 L。
 * 由高階往低階枚舉：高階頂面畫在上層、視覺在前，先匹配到的就是玩家看到的那格。
 *
 * 全部不匹配時退回平面拾取（點在裙邊岩壁上等縫隙情況）——寧可回一個近似格，
 * 也不要回 null 讓「點地面沒反應」。
 */
export function pickElevatedTile(
  wx: number,
  wy: number,
  level: (gx: number, gy: number) => number,
): GridPoint {
  for (let l = MAX_ELEVATION_LEVEL; l >= 1; l--) {
    const candidate = hitTile(wx, wy + l * ELEVATION_STEP);
    if (level(candidate.gx, candidate.gy) === l) return candidate;
  }
  return hitTile(wx, wy);
}
