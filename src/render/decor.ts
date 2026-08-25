// 地面裝飾散佈物（W2）：在草地/沙灘上決定論撒一些石頭/灌木/花草，消除大片同地形的空曠感。
//
// 純函數、只吃 (seed, gx, gy, type)：與 terrainTiles.ts 的變體選圖同一個道理——
// 分塊 RenderTexture 會重烘，散佈結果若不是 state 的純函數，重烘時裝飾物就會跳動/閃爍。

import { hashNoise, type TerrainType } from '../core/world/terrain';

/** 一格裝飾物的擺放結果：key 為 texture key，dx/dy 為相對格中心的螢幕像素偏移。 */
export interface DecorPlacement {
  key: string;
  dx: number;
  dy: number;
}

/** 各地形出現裝飾物的機率；未列出的地形（water/forest/rock/mountain）一律不放。
 *  森林本身已有樹冠當視覺主體、岩地/高山紋理已夠碎，草地與沙灘才是「大片單調」的問題所在。 */
const DECOR_DENSITY: Readonly<Partial<Record<TerrainType, number>>> = {
  grass: 0.12,
  sand: 0.06,
};

/** 各地形的候選 texture key；草地用滿 12 種裝飾，沙灘只用石頭（灌木/花草在沙地上不合理）。 */
const DECOR_KEYS: Readonly<Partial<Record<TerrainType, readonly string[]>>> = {
  grass: [
    'decor-rock-01',
    'decor-rock-02',
    'decor-rock-03',
    'decor-bush-01',
    'decor-bush-02',
    'decor-bush-03',
    'decor-flower-01',
    'decor-flower-02',
    'decor-stump-01',
    'decor-log-01',
    'decor-puddle-01',
    'decor-rut-01',
  ],
  sand: ['decor-rock-01', 'decor-rock-02', 'decor-rock-03'],
};

/** 子格偏移範圍（px）：4px 高的裝飾物不出格，故內縮在菱形內側，遠小於半格寬 32px。 */
const OFFSET_RANGE = 12;

/** 三個 roll（是否有／挑哪張／偏移）各自的 salt，避免彼此相關。 */
const PRESENCE_SALT = 421_301;
const PICK_SALT = 733_027;
const OFFSET_SALT_X = 158_753;
const OFFSET_SALT_Y = 269_987;

/**
 * 決定性計算一格是否有裝飾物、放哪張、偏移多少。
 * 回傳 0 或 1 個元素——每格最多一件裝飾物即可打散壁紙感，不需要堆疊多件。
 */
export function decorPlacementsFor(seed: number, gx: number, gy: number, type: TerrainType): DecorPlacement[] {
  const density = DECOR_DENSITY[type];
  const keys = DECOR_KEYS[type];
  if (density === undefined || keys === undefined || keys.length === 0) return [];

  const presence = hashNoise((seed + PRESENCE_SALT) | 0, gx, gy);
  if (presence >= density) return [];

  const pickRoll = hashNoise((seed + PICK_SALT) | 0, gx, gy);
  const key = keys[Math.min(keys.length - 1, Math.floor(pickRoll * keys.length))];

  const offsetXRoll = hashNoise((seed + OFFSET_SALT_X) | 0, gx, gy);
  const offsetYRoll = hashNoise((seed + OFFSET_SALT_Y) | 0, gx, gy);
  const dx = (offsetXRoll * 2 - 1) * OFFSET_RANGE;
  const dy = (offsetYRoll * 2 - 1) * OFFSET_RANGE;

  return [{ key, dx, dy }];
}
