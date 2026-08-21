// 等距座標模組：格座標 <-> 畫面座標純函式，供渲染定位／深度排序／滑鼠拾取共用。
// 純數學、零依賴，不驗證參數。

export const TILE_W = 64;
export const TILE_H = 32;

export interface ScreenPoint {
  x: number;
  y: number;
}

export interface GridPoint {
  gx: number;
  gy: number;
}

/** 格座標轉畫面座標（菱形頂端頂點）。 */
export function gridToScreen(gx: number, gy: number): ScreenPoint {
  return {
    x: ((gx - gy) * TILE_W) / 2,
    y: ((gx + gy) * TILE_H) / 2,
  };
}

/** 格子菱形的中心點（頂點再往下 TILE_H/2）。 */
export function tileCenter(gx: number, gy: number): ScreenPoint {
  const vertex = gridToScreen(gx, gy);
  return { x: vertex.x, y: vertex.y + TILE_H / 2 };
}

/** 畫面座標轉格座標，gridToScreen 的精確逆變換（回浮點）。 */
export function screenToGrid(x: number, y: number): GridPoint {
  return {
    gx: (x / (TILE_W / 2) + y / (TILE_H / 2)) / 2,
    gy: (y / (TILE_H / 2) - x / (TILE_W / 2)) / 2,
  };
}

/** 滑鼠拾取：screenToGrid 結果各自 floor 到整數格。 */
export function hitTile(x: number, y: number): GridPoint {
  const g = screenToGrid(x, y);
  return { gx: Math.floor(g.gx), gy: Math.floor(g.gy) };
}

/** 繪製深度排序鍵：畫面 y 越大（越靠前）者鍵越大。 */
export function depthKey(gx: number, gy: number): number {
  return gx + gy;
}
