// 素材登錄表：texture key ↔ 圖檔 URL 的單一真相來源，BootScene 照本表 preload。
// URL 一律用 new URL(..., import.meta.url) 取得——Vite 在 dev 與 build 都會解析這個模式，
// 路徑寫死成字面值是必要條件（動態拼接會讓 Vite 靜態分析失效，build 後 404）。

import type { TerrainType } from '../core/world/terrain';

export interface TextureEntry {
  /** Phaser texture key，等於檔名去掉 .png */
  key: string;
  url: string;
}

/** 地形 texture key（64×32 完整菱形，圖中心即 tileCenter）。 */
export const TERRAIN_TEXTURE_BY_TYPE: Readonly<Record<TerrainType, string>> = {
  water: 'tile-water-01',
  sand: 'tile-sand-01',
  grass: 'tile-grass-01',
  forest: 'tile-forest-01',
  rock: 'tile-rock-01',
  mountain: 'tile-mountain-01',
};

export const GAME_TEXTURES: readonly TextureEntry[] = [
  { key: 'tile-grass-01', url: new URL('../../assets/game/tile-grass-01.png', import.meta.url).href },
  { key: 'tile-grass-02', url: new URL('../../assets/game/tile-grass-02.png', import.meta.url).href },
  { key: 'tile-dirt-01', url: new URL('../../assets/game/tile-dirt-01.png', import.meta.url).href },
  { key: 'tile-water-01', url: new URL('../../assets/game/tile-water-01.png', import.meta.url).href },
  { key: 'tile-sand-01', url: new URL('../../assets/game/tile-sand-01.png', import.meta.url).href },
  { key: 'tile-forest-01', url: new URL('../../assets/game/tile-forest-01.png', import.meta.url).href },
  { key: 'tile-rock-01', url: new URL('../../assets/game/tile-rock-01.png', import.meta.url).href },
  { key: 'tile-ore-01', url: new URL('../../assets/game/tile-ore-01.png', import.meta.url).href },
  { key: 'tile-mountain-01', url: new URL('../../assets/game/tile-mountain-01.png', import.meta.url).href },
  { key: 'lumber-camp-01', url: new URL('../../assets/game/lumber-camp-01.png', import.meta.url).href },
  { key: 'quarry-01', url: new URL('../../assets/game/quarry-01.png', import.meta.url).href },
  { key: 'farm-01', url: new URL('../../assets/game/farm-01.png', import.meta.url).href },
  { key: 'house-01', url: new URL('../../assets/game/house-01.png', import.meta.url).href },
  { key: 'tavern-01', url: new URL('../../assets/game/tavern-01.png', import.meta.url).href },
  { key: 'wall-01', url: new URL('../../assets/game/wall-01.png', import.meta.url).href },
  { key: 'watchtower-01', url: new URL('../../assets/game/watchtower-01.png', import.meta.url).href },
  { key: 'villager-01', url: new URL('../../assets/game/villager-01.png', import.meta.url).href },
  { key: 'villager-02', url: new URL('../../assets/game/villager-02.png', import.meta.url).href },
];

/** 居民 sprite key：依 citizen id 字元碼和決定性挑選（同一 id 永遠同一張圖，重繪也一致）。 */
export const VILLAGER_TEXTURES = ['villager-01', 'villager-02'] as const;

export function villagerTextureKey(citizenId: string): string {
  let sum = 0;
  for (let i = 0; i < citizenId.length; i++) {
    sum += citizenId.charCodeAt(i);
  }
  return VILLAGER_TEXTURES[sum % VILLAGER_TEXTURES.length];
}

/**
 * 建築 type（data\buildings.json 的 id）→ sprite key。
 * 慣例：素材檔名 = type + 版本後綴，目前每種建築只有一版（-01）。
 */
export function buildingTextureKey(type: string): string {
  return `${type}-01`;
}
