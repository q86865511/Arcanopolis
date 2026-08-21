// 素材登錄表：texture key ↔ 圖檔 URL 的單一真相來源，BootScene 照本表 preload。
// URL 一律用 new URL(..., import.meta.url) 取得——Vite 在 dev 與 build 都會解析這個模式，
// 路徑寫死成字面值是必要條件（動態拼接會讓 Vite 靜態分析失效，build 後 404）。

export interface TextureEntry {
  /** Phaser texture key，等於檔名去掉 .png */
  key: string;
  url: string;
}

/** 地形 texture key（64×32 完整菱形，圖中心即 tileCenter）。 */
export const TERRAIN_TEXTURES = {
  grassA: 'tile-grass-01',
  grassB: 'tile-grass-02',
  dirt: 'tile-dirt-01',
} as const;

export const GAME_TEXTURES: readonly TextureEntry[] = [
  { key: 'tile-grass-01', url: new URL('../../assets/game/tile-grass-01.png', import.meta.url).href },
  { key: 'tile-grass-02', url: new URL('../../assets/game/tile-grass-02.png', import.meta.url).href },
  { key: 'tile-dirt-01', url: new URL('../../assets/game/tile-dirt-01.png', import.meta.url).href },
  { key: 'lumber-camp-01', url: new URL('../../assets/game/lumber-camp-01.png', import.meta.url).href },
  { key: 'quarry-01', url: new URL('../../assets/game/quarry-01.png', import.meta.url).href },
  { key: 'farm-01', url: new URL('../../assets/game/farm-01.png', import.meta.url).href },
  { key: 'house-01', url: new URL('../../assets/game/house-01.png', import.meta.url).href },
  { key: 'tavern-01', url: new URL('../../assets/game/tavern-01.png', import.meta.url).href },
  { key: 'wall-01', url: new URL('../../assets/game/wall-01.png', import.meta.url).href },
  { key: 'watchtower-01', url: new URL('../../assets/game/watchtower-01.png', import.meta.url).href },
];

/**
 * 建築 type（data\buildings.json 的 id）→ sprite key。
 * 慣例：素材檔名 = type + 版本後綴，目前每種建築只有一版（-01）。
 */
export function buildingTextureKey(type: string): string {
  return `${type}-01`;
}
