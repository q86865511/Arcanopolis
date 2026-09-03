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
  // 地表變體：同一種地形的第二/第三張圖，供渲染層決定論挑選以打散鋪排的重複感。
  { key: 'tile-grass-03', url: new URL('../../assets/game/tile-grass-03.png', import.meta.url).href },
  { key: 'tile-forest-02', url: new URL('../../assets/game/tile-forest-02.png', import.meta.url).href },
  { key: 'tile-sand-02', url: new URL('../../assets/game/tile-sand-02.png', import.meta.url).href },
  { key: 'tile-rock-02', url: new URL('../../assets/game/tile-rock-02.png', import.meta.url).href },
  { key: 'tile-mountain-02', url: new URL('../../assets/game/tile-mountain-02.png', import.meta.url).href },
  { key: 'tile-mountain-03', url: new URL('../../assets/game/tile-mountain-03.png', import.meta.url).href },
  { key: 'tile-water-shore-tl', url: new URL('../../assets/game/tile-water-shore-tl.png', import.meta.url).href },
  { key: 'tile-water-shore-tr', url: new URL('../../assets/game/tile-water-shore-tr.png', import.meta.url).href },
  { key: 'tile-water-shore-br', url: new URL('../../assets/game/tile-water-shore-br.png', import.meta.url).href },
  { key: 'tile-water-shore-bl', url: new URL('../../assets/game/tile-water-shore-bl.png', import.meta.url).href },
  { key: 'tile-sand-grass-tl', url: new URL('../../assets/game/tile-sand-grass-tl.png', import.meta.url).href },
  { key: 'tile-sand-grass-tr', url: new URL('../../assets/game/tile-sand-grass-tr.png', import.meta.url).href },
  { key: 'tile-sand-grass-br', url: new URL('../../assets/game/tile-sand-grass-br.png', import.meta.url).href },
  { key: 'tile-sand-grass-bl', url: new URL('../../assets/game/tile-sand-grass-bl.png', import.meta.url).href },
  { key: 'tile-slope-01', url: new URL('../../assets/game/tile-slope-01.png', import.meta.url).href },
  // 資源圖示（24×24）：key 是 `icon-${資源 id}`，HUD 資源列依 RESOURCE_DEFS 的 id 找圖。
  { key: 'icon-wood', url: new URL('../../assets/game/icon-wood.png', import.meta.url).href },
  { key: 'icon-stone', url: new URL('../../assets/game/icon-stone.png', import.meta.url).href },
  { key: 'icon-food', url: new URL('../../assets/game/icon-food.png', import.meta.url).href },
  { key: 'icon-gold', url: new URL('../../assets/game/icon-gold.png', import.meta.url).href },
  { key: 'icon-grain', url: new URL('../../assets/game/icon-grain.png', import.meta.url).href },
  { key: 'icon-flour', url: new URL('../../assets/game/icon-flour.png', import.meta.url).href },
  { key: 'icon-plank', url: new URL('../../assets/game/icon-plank.png', import.meta.url).href },
  { key: 'icon-iron-ore', url: new URL('../../assets/game/icon-iron-ore.png', import.meta.url).href },
  { key: 'icon-iron', url: new URL('../../assets/game/icon-iron.png', import.meta.url).href },
  { key: 'icon-ale', url: new URL('../../assets/game/icon-ale.png', import.meta.url).href },
  { key: 'icon-tools', url: new URL('../../assets/game/icon-tools.png', import.meta.url).href },
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
  // 建築外觀變體與建造中鷹架：變體避免整排建築長得一模一樣，
  // scaffold 是疊在建築上表示「建造中」的外框式素材。兩者的挑選/疊加邏輯屬渲染層。
  { key: 'house-02', url: new URL('../../assets/game/house-02.png', import.meta.url).href },
  { key: 'house-03', url: new URL('../../assets/game/house-03.png', import.meta.url).href },
  { key: 'farm-02', url: new URL('../../assets/game/farm-02.png', import.meta.url).href },
  { key: 'scaffold-01', url: new URL('../../assets/game/scaffold-01.png', import.meta.url).href },
  // 地面裝飾散佈物：8-21px 的小 sprite，由渲染層決定論散佈到地格上消除空曠感。
  // 無底座、可疊在任何地形之上。
  { key: 'decor-rock-01', url: new URL('../../assets/game/decor-rock-01.png', import.meta.url).href },
  { key: 'decor-rock-02', url: new URL('../../assets/game/decor-rock-02.png', import.meta.url).href },
  { key: 'decor-rock-03', url: new URL('../../assets/game/decor-rock-03.png', import.meta.url).href },
  { key: 'decor-bush-01', url: new URL('../../assets/game/decor-bush-01.png', import.meta.url).href },
  { key: 'decor-bush-02', url: new URL('../../assets/game/decor-bush-02.png', import.meta.url).href },
  { key: 'decor-bush-03', url: new URL('../../assets/game/decor-bush-03.png', import.meta.url).href },
  { key: 'decor-flower-01', url: new URL('../../assets/game/decor-flower-01.png', import.meta.url).href },
  { key: 'decor-flower-02', url: new URL('../../assets/game/decor-flower-02.png', import.meta.url).href },
  { key: 'decor-stump-01', url: new URL('../../assets/game/decor-stump-01.png', import.meta.url).href },
  { key: 'decor-log-01', url: new URL('../../assets/game/decor-log-01.png', import.meta.url).href },
  { key: 'decor-puddle-01', url: new URL('../../assets/game/decor-puddle-01.png', import.meta.url).href },
  { key: 'decor-rut-01', url: new URL('../../assets/game/decor-rut-01.png', import.meta.url).href },
  { key: 'villager-01', url: new URL('../../assets/game/villager-01.png', import.meta.url).href },
  { key: 'villager-02', url: new URL('../../assets/game/villager-02.png', import.meta.url).href },
];

/** 道路路面：地形烘焙時疊在原地形之上，選單的道路格也用同一張當縮圖。 */
export const ROAD_TEXTURE_KEY = 'tile-dirt-01';

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
