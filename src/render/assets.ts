// 素材登錄表：texture key ↔ 圖檔 URL 的單一真相來源，BootScene 照本表 preload。
// URL 一律用 new URL(..., import.meta.url) 取得——Vite 在 dev 與 build 都會解析這個模式，
// 路徑寫死成字面值是必要條件（動態拼接會讓 Vite 靜態分析失效，build 後 404）。

export interface TextureEntry {
  /** Phaser texture key，等於檔名去掉 .png */
  key: string;
  url: string;
}

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
  { key: 'tile-water-shore-tl', url: new URL('../../assets/game/tile-water-shore-tl.png', import.meta.url).href },
  { key: 'tile-water-shore-tr', url: new URL('../../assets/game/tile-water-shore-tr.png', import.meta.url).href },
  { key: 'tile-water-shore-br', url: new URL('../../assets/game/tile-water-shore-br.png', import.meta.url).href },
  { key: 'tile-water-shore-bl', url: new URL('../../assets/game/tile-water-shore-bl.png', import.meta.url).href },
  { key: 'tile-sand-grass-tl', url: new URL('../../assets/game/tile-sand-grass-tl.png', import.meta.url).href },
  { key: 'tile-sand-grass-tr', url: new URL('../../assets/game/tile-sand-grass-tr.png', import.meta.url).href },
  { key: 'tile-sand-grass-br', url: new URL('../../assets/game/tile-sand-grass-br.png', import.meta.url).href },
  { key: 'tile-sand-grass-bl', url: new URL('../../assets/game/tile-sand-grass-bl.png', import.meta.url).href },
  { key: 'lumber-camp-01', url: new URL('../../assets/game/lumber-camp-01.png', import.meta.url).href },
  { key: 'quarry-01', url: new URL('../../assets/game/quarry-01.png', import.meta.url).href },
  { key: 'farm-01', url: new URL('../../assets/game/farm-01.png', import.meta.url).href },
  { key: 'house-01', url: new URL('../../assets/game/house-01.png', import.meta.url).href },
  { key: 'tavern-01', url: new URL('../../assets/game/tavern-01.png', import.meta.url).href },
  { key: 'mill-01', url: new URL('../../assets/game/mill-01.png', import.meta.url).href },
  { key: 'bakery-01', url: new URL('../../assets/game/bakery-01.png', import.meta.url).href },
  { key: 'sawmill-01', url: new URL('../../assets/game/sawmill-01.png', import.meta.url).href },
  { key: 'mine-01', url: new URL('../../assets/game/mine-01.png', import.meta.url).href },
  { key: 'smelter-01', url: new URL('../../assets/game/smelter-01.png', import.meta.url).href },
  { key: 'blacksmith-01', url: new URL('../../assets/game/blacksmith-01.png', import.meta.url).href },
  { key: 'market-01', url: new URL('../../assets/game/market-01.png', import.meta.url).href },
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
