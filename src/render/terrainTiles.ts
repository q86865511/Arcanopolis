// 地形選圖：一格地形要畫哪一張 tile，由「本格地形 ＋ 四個正交鄰格地形」決定。
//
// 為什麼需要它：先前每格一律用該地形的底圖，海岸線與林緣因此是一條硬邊菱形折線，
// 遠看像馬賽克而不是地貌。單邊過渡 tile 讓交界處長出浪花與草緣，輪廓就軟下來了。
//
// 這是「最小版」：只有單邊過渡素材，所以一格最多套用一個方向的過渡。多個方向同時
// 臨界時取固定優先序的第一個（tl→tr→br→bl），保證同一份 state 永遠畫出同一張圖——
// 渲染必須是 state 的純函數，否則分塊重烘會出現閃爍。
//
// 直線海岸會完全正確；凹凸角落退回單邊過渡或底圖，那是素材量與效果的取捨，不是缺陷。

import type { TerrainType } from '../core/world/terrain';

/** 菱形四條邊在螢幕上的方位。 */
export type EdgeDir = 'tl' | 'tr' | 'br' | 'bl';

/**
 * 螢幕方位 → 格座標偏移。
 * 由 iso.ts 的投影 screenX=(gx-gy)*32、screenY=(gx+gy)*16 推得：
 * (gx-1,gy) 落在左上、(gx,gy-1) 右上、(gx+1,gy) 右下、(gx,gy+1) 左下。
 * 陣列順序即優先序，不可任意調換（會改變多邊臨界時選中的那一張）。
 */
export const EDGE_OFFSETS: readonly { readonly dir: EdgeDir; readonly dx: number; readonly dy: number }[] = [
  { dir: 'tl', dx: -1, dy: 0 },
  { dir: 'tr', dx: 0, dy: -1 },
  { dir: 'br', dx: 1, dy: 0 },
  { dir: 'bl', dx: 0, dy: 1 },
];

/** 地形底圖（無過渡時使用）。 */
export const TERRAIN_BASE_TEXTURE: Readonly<Record<TerrainType, string>> = {
  water: 'tile-water-01',
  sand: 'tile-sand-01',
  grass: 'tile-grass-01',
  forest: 'tile-forest-01',
  rock: 'tile-rock-01',
  mountain: 'tile-mountain-01',
};

/**
 * 決定這一格要畫的 texture key。
 *
 * @param self 本格地形
 * @param neighbor 取鄰格地形；世界邊界外請回傳 self（邊界不該長出海岸線）
 */
export function terrainTextureKeyFor(
  self: TerrainType,
  neighbor: (dx: number, dy: number) => TerrainType,
): string {
  // 水面靠上任何陸地就長浪花——岩岸與沙灘都適用，浪打在什麼上面不影響水這一側的樣子。
  if (self === 'water') {
    for (const { dir, dx, dy } of EDGE_OFFSETS) {
      if (neighbor(dx, dy) !== 'water') return `tile-water-shore-${dir}`;
    }
    return TERRAIN_BASE_TEXTURE.water;
  }

  // 沙灘靠上草地時讓草鬚延伸過來。只認 grass 不認 forest：森林自己的樹冠邊緣已經
  // 是不規則的，再加一層草緣會讓林緣糊成一片。
  if (self === 'sand') {
    for (const { dir, dx, dy } of EDGE_OFFSETS) {
      if (neighbor(dx, dy) === 'grass') return `tile-sand-grass-${dir}`;
    }
    return TERRAIN_BASE_TEXTURE.sand;
  }

  return TERRAIN_BASE_TEXTURE[self];
}
