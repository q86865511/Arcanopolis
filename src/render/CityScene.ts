// 城市場景：把 GameState 畫成等距地圖。
// 職責僅止於「讀狀態 → 產生／更新 sprite」與攝影機操作，不持有遊戲規則，也不寫回 state。

import Phaser from 'phaser';
import buildingsJson from '../../data/buildings.json';
import resourcesJson from '../../data/resources.json';
import { parseBuildingDefs, parseResourceDefs } from '../data/loader';
import { buildingTextureKey } from './assets';
import { CameraController } from './CameraController';
import { GRID_SIZE, createDemoState, terrainTextureAt } from './demoWorld';
import { TILE_H, TILE_W, gridToScreen, tileCenter } from './iso';
import {
  BUILDING_ORIGIN_X,
  BUILDING_ORIGIN_Y,
  TERRAIN_DEPTH,
  TERRAIN_ORIGIN_X,
  TERRAIN_ORIGIN_Y,
  buildingAnchor,
  buildingDepth,
  terrainAnchor,
} from './placement';
import type { GameState } from '../core/world/state';

export const CITY_SCENE_KEY = 'city';

const buildingDefs = parseBuildingDefs(
  buildingsJson,
  new Set(parseResourceDefs(resourcesJson).map((r) => r.id)),
);
const defsByType = new Map(buildingDefs.map((def) => [def.id, def]));

export class CityScene extends Phaser.Scene {
  private state!: GameState;
  private camera!: CameraController;

  constructor() {
    super(CITY_SCENE_KEY);
  }

  create(): void {
    this.state = createDemoState();

    this.drawTerrain();
    this.drawBuildings();

    this.camera = new CameraController(this);
    this.camera.attach();

    // 攝影機邊界＝地圖世界包圍盒外加一圈邊距（上方多留建築高度的頭部空間）
    const margin = TILE_W * 2;
    const left = gridToScreen(0, GRID_SIZE - 1).x - TILE_W / 2;
    const right = gridToScreen(GRID_SIZE - 1, 0).x + TILE_W / 2;
    const top = gridToScreen(0, 0).y;
    const bottom = gridToScreen(GRID_SIZE - 1, GRID_SIZE - 1).y + TILE_H;
    this.camera.setWorldBounds(
      left - margin,
      top - margin - TILE_H * 3,
      right - left + margin * 2,
      bottom - top + margin * 2 + TILE_H * 3,
    );

    // 開場把地圖中心對準畫面中央：地圖中心即中央那格的菱形中心
    const mid = (GRID_SIZE - 1) / 2;
    const center = tileCenter(mid, mid);
    this.camera.centerOn(center.x, center.y);
  }

  private drawTerrain(): void {
    for (let gy = 0; gy < GRID_SIZE; gy++) {
      for (let gx = 0; gx < GRID_SIZE; gx++) {
        const key = terrainTextureAt(gx, gy);
        if (!this.textures.exists(key)) {
          // 地形素材缺漏＝整張圖都會是 Phaser 的 __MISSING 綠白格，直接指路 assets.ts
          throw new Error(`CityScene: 地形素材 "${key}" 未載入——檢查 src/render/assets.ts 的 GAME_TEXTURES`);
        }
        const anchor = terrainAnchor(gx, gy);
        this.add
          .image(anchor.x, anchor.y, key)
          .setOrigin(TERRAIN_ORIGIN_X, TERRAIN_ORIGIN_Y)
          .setDepth(TERRAIN_DEPTH);
      }
    }
  }

  private drawBuildings(): void {
    for (const building of this.state.buildings) {
      const key = buildingTextureKey(building.type);
      if (!this.textures.exists(key)) {
        // 資料表新增了建築但素材還沒進 GAME_TEXTURES：跳過該棟而不是讓整個場景炸掉
        console.warn(`[CityScene] 找不到建築素材 "${key}"（建築 ${building.id}），略過不繪製`);
        continue;
      }
      const size = defsByType.get(building.type)?.size ?? { w: 1, h: 1 };
      const anchor = buildingAnchor(building.x, building.y);
      this.add
        .image(anchor.x, anchor.y, key)
        .setOrigin(BUILDING_ORIGIN_X, BUILDING_ORIGIN_Y)
        .setDepth(buildingDepth(building.x, building.y, size.w, size.h));
    }
  }
}
