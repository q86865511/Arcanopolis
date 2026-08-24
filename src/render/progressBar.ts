// 建築進度條的純算式：抽離自繪製層以便單元測試（比照 hudLayout/paletteLayout）。
//
// 進度條同時是「效率指示器」：條走得慢就代表在崗人力不足或原料短缺，
// 玩家不必另外開面板就看得出哪棟建築沒在好好運轉。

import type { BuildingDef } from '../data/types';

/** 條的寬度貼齊一格地磚的視覺寬度，高度取細一點免得蓋住建築本體。 */
export const BAR_W = 30;
export const BAR_H = 4;
/** 條掛在建築錨點上方多少像素（錨點＝底面菱形中心，見 placement.ts）。 */
export const BAR_OFFSET_Y = 10;

/**
 * 進度比例（0~1）。沒有 workTicks（不分批）或沒有產出的建築回 null＝不該畫條：
 * 對它們而言「一批」不存在，畫一條永遠停在某處的條只會誤導。
 */
export function progressRatio(
  building: { progress?: number },
  def: BuildingDef | undefined,
): number | null {
  if (def === undefined) return null;
  const workTicks = def.workTicks;
  if (workTicks === undefined || workTicks <= 0) return null;
  if (Object.keys(def.production).length === 0) return null;
  const progress = building.progress ?? 0;
  if (progress <= 0) return 0;
  return Math.min(1, progress / workTicks);
}

export interface BarRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 依建築錨點算出條的外框；錨點由 placement.buildingAnchor 提供（世界座標）。 */
export function barRect(anchorX: number, anchorY: number, buildingHeight: number): BarRect {
  return {
    x: Math.round(anchorX - BAR_W / 2),
    y: Math.round(anchorY - buildingHeight - BAR_OFFSET_Y),
    w: BAR_W,
    h: BAR_H,
  };
}

/** 已完成部分的寬度（像素，取整避免半像素造成閃爍）。 */
export function filledWidth(ratio: number): number {
  return Math.round(BAR_W * Math.min(1, Math.max(0, ratio)));
}
