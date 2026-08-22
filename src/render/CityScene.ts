// 城市場景：把 GameState 畫成等距地圖，並以固定時步驅動模擬。
// 職責僅止於「讀狀態 → 產生／更新 sprite」與攝影機操作，不持有遊戲規則，也不寫回 state。

import Phaser from 'phaser';
import { buildingTextureKey, villagerTextureKey } from './assets';
import { BuildController } from './BuildController';
import { CameraController } from './CameraController';
import { computeCameraBounds } from './cameraBounds';
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
import { footprintTiles } from '../core/world/occupancy';
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
  /** 目前 state 中所有建築的 id：syncBuildings 用它偵測「這 tick 有沒有增減建築」。
   *  不能拿 buildingSprites 當這份清單——缺素材的建築沒有 sprite，卻仍佔格。 */
  private readonly knownBuildingIds = new Set<string>();
  /** 所有建築 footprint 的格集合（key `${x},${y}`），只在建築增減時重建。
   *  用途見 positionCitizenSprite：踩在建築格上的居民＝已進到建築裡，該隱藏。 */
  private readonly buildingTiles = new Set<string>();
  /** 已警告過素材缺漏的 texture key（建築 type 或居民 texture key）：
   *  缺素材的居民每 tick 都會重試建 sprite（警告只出一次）；缺素材的建築因 knownBuildingIds
   *  只嘗試一次就永久放棄——見 syncBuildings 註解，日後動態載素材時不會補畫。 */
  private readonly warnedMissingTextures = new Set<string>();
  /** 世界包圍盒（地圖 + 邊距，世界座標）。固定值，只在 create 算一次。 */
  private worldBounds = { x: 0, y: 0, w: 0, h: 0 };
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
    this.knownBuildingIds.clear();
    this.buildingTiles.clear();

    // UI 攝影機要先建立：之後每個「世界」物件建立時都得叫它忽略，否則會被畫第二次
    this.uiCamera = this.cameras.add(0, 0, this.scale.width, this.scale.height);
    this.uiCamera.setName('ui');

    this.drawTerrain();
    this.syncBuildings();
    this.syncCitizens();

    this.camera = new CameraController(this);
    this.camera.attach();

    // 世界包圍盒＝地圖外加一圈邊距（上方多留建築高度的頭部空間）。
    // 這是「世界有多大」，與視窗無關；攝影機實際 bounds 由 applyCameraBounds 依視窗再算。
    const margin = TILE_W * 2;
    const left = gridToScreen(0, GRID_SIZE - 1).x - TILE_W / 2;
    const right = gridToScreen(GRID_SIZE - 1, 0).x + TILE_W / 2;
    const top = gridToScreen(0, 0).y;
    const bottom = gridToScreen(GRID_SIZE - 1, GRID_SIZE - 1).y + TILE_H;
    this.worldBounds = {
      x: left - margin,
      y: top - margin - TILE_H * 3,
      w: right - left + margin * 2,
      h: bottom - top + margin * 2 + TILE_H * 3,
    };
    this.applyCameraBounds();

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

    // 視窗大小會變（Scale.RESIZE）：監聽要在場景關閉時解掉，否則場景重啟會疊上第二個
    // 監聽器，而舊監聽器持有的是已被銷毀的 hud/uiCamera。
    this.scale.on(Phaser.Scale.Events.RESIZE, this.handleResize, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.scale.off(Phaser.Scale.Events.RESIZE, this.handleResize, this);
    });
  }

  /**
   * 視窗尺寸變更：Scale.RESIZE 下畫布恆等於 parent 尺寸，但攝影機 viewport 與 HUD 版面
   * 都停在建立當下的尺寸，不同步就會出現「HUD 被裁掉一半、畫面右下角空白」。
   * 世界大小本身不變（applyCameraBounds 只是依新視窗重算可捲動範圍）；視窗大於世界時
   * 世界四周留 BACKGROUND_COLOR 的底色（見 game.ts），地圖不會被推出畫面。
   */
  private handleResize(gameSize: Phaser.Structs.Size): void {
    const width = Math.floor(gameSize.width);
    const height = Math.floor(gameSize.height);
    // 視窗最小化時 parent 尺寸會量到 0：套下去會讓攝影機 viewport 歸零而整片黑，直接忽略
    if (width <= 0 || height <= 0) {
      return;
    }
    this.cameras.main.setSize(width, height);
    this.uiCamera.setSize(width, height);
    this.hud.layout(width, height);
    this.applyCameraBounds();
  }

  /**
   * 依「世界包圍盒」與「當前可視範圍」算出攝影機 bounds（取大＋置中，逐軸判定，
   * 算式見 cameraBounds.ts）。可視範圍會隨視窗尺寸與滾輪縮放變動，故 resize 與每幀都呼叫；
   * 目標值與攝影機當前 bounds 相同即早退，避免每幀打髒攝影機。
   *
   * 為什麼跟攝影機自身的 getBounds() 比對，而不是快取一份簽章實例欄位：
   * scene.restart() 會銷毀舊 camera、造一台全新的（useBounds=false），若拿實例欄位當簽章，
   * 新 camera 面對「世界大小與 zoom 都沒變」的情況會誤判成「已經設過」而早退，
   * 新 camera 就永遠沒被 setBounds（見 M3.5 審查 F1，實測 restart 後拖曳完全未被 clamp）。
   * 讀 camera 自身狀態比對，這類殘留狀態從結構上就不存在——新 camera 的 getBounds()
   * 預設是 (0,0,0,0) 且 useBounds=false，必定與算出來的目標值不同，一定會被重新 setBounds。
   */
  private applyCameraBounds(): void {
    const camera = this.cameras.main;
    const target = computeCameraBounds(this.worldBounds, camera.displayWidth, camera.displayHeight);
    const current = camera.getBounds();
    if (
      camera.useBounds &&
      current.x === target.x &&
      current.y === target.y &&
      current.width === target.w &&
      current.height === target.h
    ) {
      return;
    }
    this.camera.setWorldBounds(target.x, target.y, target.w, target.h);
  }

  update(_time: number, deltaMs: number): void {
    // 滾輪縮放會改變可視範圍，而 CameraController 不知道世界邊界；每幀對一次簽章即可
    this.applyCameraBounds();

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
    let changed = false;
    for (const building of this.state.buildings) {
      alive.add(building.id);
      if (this.knownBuildingIds.has(building.id)) {
        continue;
      }
      this.knownBuildingIds.add(building.id);
      changed = true;
      const sprite = this.createBuildingSprite(building);
      if (sprite !== null) {
        this.buildingSprites.set(building.id, sprite);
      }
    }
    for (const id of this.knownBuildingIds) {
      if (alive.has(id)) {
        continue;
      }
      this.knownBuildingIds.delete(id);
      changed = true;
      const sprite = this.buildingSprites.get(id);
      if (sprite !== undefined) {
        sprite.destroy();
        this.buildingSprites.delete(id);
      }
    }
    // 佔格表只在建築增減時重建：建築不會移動，每 tick 重掃全城 footprint 純屬浪費
    if (changed) {
      this.rebuildBuildingTiles();
    }
  }

  /** 重建 buildingTiles：全城建築的 footprint 攤平成格集合。 */
  private rebuildBuildingTiles(): void {
    this.buildingTiles.clear();
    for (const building of this.state.buildings) {
      const size = buildingSize(building.type);
      for (const tile of footprintTiles(building.x, building.y, size.w, size.h)) {
        this.buildingTiles.add(`${tile.x},${tile.y}`);
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
   *
   * 可見性：所在格（四捨五入到最近格）落在任一建築 footprint 內 → 視為「進到建築裡」而隱藏。
   * movement system 把所有建築格都當阻擋、只對居民自己的目標建築開放（見 movement.ts 檔頭），
   * 所以居民能站上的建築格只可能是他的 home/job——踩到就是抵達目的地，不會誤隱藏路過的人。
   * 沒有這層隱藏，居民會直接疊在建築 sprite 上，看起來像站在屋頂。
   */
  private positionCitizenSprite(sprite: Phaser.GameObjects.Image, citizen: Citizen): void {
    const inside = this.buildingTiles.has(`${Math.round(citizen.x)},${Math.round(citizen.y)}`);
    sprite.setVisible(!inside);
    if (inside) {
      return;
    }
    const center = tileCenter(citizen.x, citizen.y);
    const offset = citizenOffset(citizen.id);
    sprite.setPosition(center.x + offset.dx, center.y + CITIZEN_Y_OFFSET + offset.dy);
    sprite.setDepth(citizen.x + citizen.y + 0.5);
  }
}
