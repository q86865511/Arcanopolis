// 城市場景：把 GameState 畫成等距地圖，並以固定時步驅動模擬。
// 職責僅止於「讀狀態 → 產生／更新 sprite」與攝影機操作，不持有遊戲規則，也不寫回 state。

import Phaser from 'phaser';
import { buildingTextureKey, villagerTextureKey } from './assets';
import { BuildController } from './BuildController';
import { CameraController } from './CameraController';
import { buildingSize } from './defs';
import { GRID_SIZE, createDemoWorld, terrainTextureAt } from './demoWorld';
import { Hud } from './hud';
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
import type { Simulation } from '../core/sim/simulation';
import type { Building, Citizen, GameState } from '../core/world/state';

/** 居民 sprite 錨點原點：底邊中央，與建築一致。 */
const CITIZEN_ORIGIN_X = 0.5;
const CITIZEN_ORIGIN_Y = 1;
/** 腳踩格心的微調：origin(0.5,1) 貼齊 tileCenter 會讓腳陷入地面，上移少許視覺才對齊。 */
const CITIZEN_Y_OFFSET = -2;

/**
 * 個體視覺偏移的範圍（單位：像素）：同 home/job 的居民因 movement 決定論會走到同一格心，
 * 不加偏移就會完全重合——玩家會把「疊在一起看不見」誤判成渲染壞掉（見 M3-W3 審查 F1）。
 * 純顯示層微調，不影響 citizen.x/y 的模擬座標。
 */
const CITIZEN_OFFSET_X_RANGE = 4;
const CITIZEN_OFFSET_Y_RANGE = 2;

/**
 * 依 citizen id 決定性算出視覺偏移：同一 id 永遠得到同一組偏移，重繪/重開都一致。
 * 用 FNV-1a 而非簡單字元碼和——`citizen#<tick>-<seq>` 這類前綴固定的 id，字元碼和的分佈
 * 幾乎只看數字位數奇偶，偏移會明顯偏斜（見 villagerTextureKey 的同類已知限制）。
 */
function citizenOffset(citizenId: string): { dx: number; dy: number } {
  let hash = 0x811c9dc5;
  for (let i = 0; i < citizenId.length; i++) {
    hash ^= citizenId.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  hash >>>= 0;
  const xBucket = CITIZEN_OFFSET_X_RANGE * 2 + 1;
  const yBucket = CITIZEN_OFFSET_Y_RANGE * 2 + 1;
  const dx = (hash % xBucket) - CITIZEN_OFFSET_X_RANGE;
  const dy = (Math.floor(hash / xBucket) % yBucket) - CITIZEN_OFFSET_Y_RANGE;
  return { dx, dy };
}

export const CITY_SCENE_KEY = 'city';

/** 一個 sim tick 的實時長度：每秒 10 tick。改這裡等於改遊戲速度，模擬本身仍是固定時步。 */
export const SIM_TICK_MS = 100;

/** 單幀最多補跑幾個 tick。分頁切回來時一次補上千 tick 會直接凍住畫面。 */
export const MAX_TICKS_PER_FRAME = 5;

export class CityScene extends Phaser.Scene {
  private state!: GameState;
  private sim!: Simulation;
  private camera!: CameraController;
  private hud!: Hud;
  private build!: BuildController;
  /** 只渲染 HUD 的第二台攝影機（zoom 固定 1），見 hud.ts 開頭說明。 */
  private uiCamera!: Phaser.Cameras.Scene2D.Camera;
  private readonly buildingSprites = new Map<string, Phaser.GameObjects.Image>();
  private readonly citizenSprites = new Map<string, Phaser.GameObjects.Image>();
  /** 已警告過素材缺漏的 texture key（建築 type 或居民 texture key）：
   *  缺素材的建築/居民每 tick 都會重試建 sprite，警告只出一次 */
  private readonly warnedMissingTextures = new Set<string>();
  private accumulator = 0;

  constructor() {
    super(CITY_SCENE_KEY);
  }

  create(): void {
    const world = createDemoWorld();
    this.state = world.state;
    this.sim = world.sim;
    this.accumulator = 0;
    this.buildingSprites.clear();
    this.citizenSprites.clear();

    // UI 攝影機要先建立：之後每個「世界」物件建立時都得叫它忽略，否則會被畫第二次
    this.uiCamera = this.cameras.add(0, 0, this.scale.width, this.scale.height);
    this.uiCamera.setName('ui');

    this.drawTerrain();
    this.syncBuildings();
    this.syncCitizens();

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

    this.hud = new Hud(this, this.state);
    this.hud.create();
    this.cameras.main.ignore(this.hud.displayObjects);

    this.build = new BuildController(this, this.state, this.sim, (def) => this.hud.setSelection(def));
    this.build.attach();
    this.uiCamera.ignore(this.build.displayObjects);
  }

  update(_time: number, deltaMs: number): void {
    let ticks = 0;
    this.accumulator += deltaMs;
    while (this.accumulator >= SIM_TICK_MS && ticks < MAX_TICKS_PER_FRAME) {
      this.sim.tick();
      this.accumulator -= SIM_TICK_MS;
      ticks += 1;
    }
    // 補跑被截斷時把積欠鎖在一幀的量：不然分頁掛在背景幾分鐘後，
    // 每幀都補滿 5 tick 卻永遠追不上，畫面持續卡頓（spiral of death）。
    if (this.accumulator > SIM_TICK_MS * MAX_TICKS_PER_FRAME) {
      this.accumulator = SIM_TICK_MS * MAX_TICKS_PER_FRAME;
    }

    // 建築清單、居民位置與資源只會在 tick 中變動，沒跑 tick 就不必重算
    if (ticks > 0) {
      this.syncBuildings();
      this.syncCitizens();
      this.hud.refresh();
    }
    // 預覽每幀更新：滑鼠沒動但攝影機動了，hover 的格子也會變
    this.build.update();
  }

  private drawTerrain(): void {
    const images: Phaser.GameObjects.Image[] = [];
    for (let gy = 0; gy < GRID_SIZE; gy++) {
      for (let gx = 0; gx < GRID_SIZE; gx++) {
        const key = terrainTextureAt(gx, gy);
        if (!this.textures.exists(key)) {
          // 地形素材缺漏＝整張圖都會是 Phaser 的 __MISSING 綠白格，直接指路 assets.ts
          throw new Error(`CityScene: 地形素材 "${key}" 未載入——檢查 src/render/assets.ts 的 GAME_TEXTURES`);
        }
        const anchor = terrainAnchor(gx, gy);
        images.push(
          this.add
            .image(anchor.x, anchor.y, key)
            .setOrigin(TERRAIN_ORIGIN_X, TERRAIN_ORIGIN_Y)
            .setDepth(TERRAIN_DEPTH),
        );
      }
    }
    this.uiCamera.ignore(images);
  }

  /**
   * 依 state.buildings 增刪 sprite：新出現的建 sprite、消失的銷毀，其餘原封不動。
   * 用 diff 而非每 tick 全刪重建——後者每秒重建十次 sprite，之後要加動畫/選取狀態也全會被沖掉。
   */
  private syncBuildings(): void {
    const alive = new Set<string>();
    for (const building of this.state.buildings) {
      alive.add(building.id);
      if (!this.buildingSprites.has(building.id)) {
        const sprite = this.createBuildingSprite(building);
        if (sprite !== null) {
          this.buildingSprites.set(building.id, sprite);
        }
      }
    }
    for (const [id, sprite] of this.buildingSprites) {
      if (!alive.has(id)) {
        sprite.destroy();
        this.buildingSprites.delete(id);
      }
    }
  }

  private createBuildingSprite(building: Building): Phaser.GameObjects.Image | null {
    const key = buildingTextureKey(building.type);
    if (!this.textures.exists(key)) {
      // 資料表新增了建築但素材還沒進 GAME_TEXTURES：跳過該棟而不是讓整個場景炸掉
      if (!this.warnedMissingTextures.has(building.type)) {
        this.warnedMissingTextures.add(building.type);
        console.warn(`[CityScene] 找不到建築素材 "${key}"（建築 ${building.id}），略過不繪製`);
      }
      return null;
    }
    const size = buildingSize(building.type);
    const anchor = buildingAnchor(building.x, building.y);
    const sprite = this.add
      .image(anchor.x, anchor.y, key)
      .setOrigin(BUILDING_ORIGIN_X, BUILDING_ORIGIN_Y)
      .setDepth(buildingDepth(building.x, building.y, size.w, size.h));
    this.uiCamera.ignore(sprite);
    return sprite;
  }

  /**
   * 依 state.citizens 增刪並定位居民 sprite：與 syncBuildings 同法用 diff，
   * 但居民每 tick 都會移動，故存活者的位置每次呼叫都要重算（不只新增/刪除時）。
   */
  private syncCitizens(): void {
    const alive = new Set<string>();
    for (const citizen of this.state.citizens) {
      alive.add(citizen.id);
      let sprite = this.citizenSprites.get(citizen.id);
      if (sprite === undefined) {
        const created = this.createCitizenSprite(citizen);
        if (created !== null) {
          this.citizenSprites.set(citizen.id, created);
        }
        sprite = created ?? undefined;
      }
      if (sprite !== undefined) {
        this.positionCitizenSprite(sprite, citizen);
      }
    }
    for (const [id, sprite] of this.citizenSprites) {
      if (!alive.has(id)) {
        sprite.destroy();
        this.citizenSprites.delete(id);
      }
    }
  }

  private createCitizenSprite(citizen: Citizen): Phaser.GameObjects.Image | null {
    const key = villagerTextureKey(citizen.id);
    if (!this.textures.exists(key)) {
      // 比照 createBuildingSprite：素材缺漏就跳過該居民而非讓整個場景炸掉，警告只出一次
      if (!this.warnedMissingTextures.has(key)) {
        this.warnedMissingTextures.add(key);
        console.warn(`[CityScene] 找不到居民素材 "${key}"（居民 ${citizen.id}），略過不繪製`);
      }
      return null;
    }
    const sprite = this.add.image(0, 0, key).setOrigin(CITIZEN_ORIGIN_X, CITIZEN_ORIGIN_Y);
    this.uiCamera.ignore(sprite);
    return sprite;
  }

  /**
   * 位置＝格心（浮點座標直接代入 tileCenter）疊加個體視覺偏移（見 citizenOffset），
   * depth 壓在同格建築之上、下一列地物之下即可。
   */
  private positionCitizenSprite(sprite: Phaser.GameObjects.Image, citizen: Citizen): void {
    const center = tileCenter(citizen.x, citizen.y);
    const offset = citizenOffset(citizen.id);
    sprite.setPosition(center.x + offset.dx, center.y + CITIZEN_Y_OFFSET + offset.dy);
    sprite.setDepth(citizen.x + citizen.y + 0.5);
  }
}
