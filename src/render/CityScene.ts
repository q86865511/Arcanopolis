// 城市場景：把 GameState 畫成等距地圖，並以固定時步驅動模擬。
// 職責僅止於「讀狀態 → 產生／更新 sprite」與攝影機操作，不持有遊戲規則，也不寫回 state。

import Phaser from 'phaser';
import { buildingTextureKey, villagerTextureKey } from './assets';
import { BuildController, PREVIEW_DEPTH } from './BuildController';
import { CameraController } from './CameraController';
import { computeCameraBounds } from './cameraBounds';
import { applyColorGrade, type ColorGradeHandle } from './colorGrade';
import { nightStrength } from './dayNight';
import { BUILDING_DEFS, buildingSize } from './defs';
import { createDemoWorld, createSimulationFor } from './demoWorld';
import { changeSpeed, speedMultiplier, togglePause, INITIAL_SPEED, type GameSpeed } from './gameSpeed';
import { barRect, filledWidth, progressRatio } from './progressBar';
import { browserStorage, clearSave, loadGame, saveGame, type SaveStorage } from './persistence';
import { TICKS_PER_DAY, timeFromTick } from '../core/sim/time';
import { Hud } from './hud';
import { TILE_H, TILE_W, gridToScreen, tileCenter } from './iso';
import { TerrainRenderer, type TerrainRenderMetrics } from './TerrainRenderer';
import {
  BUILDING_ORIGIN_X,
  BUILDING_ORIGIN_Y,
  buildingAnchor,
  buildingDepth,
} from './placement';
import { footprintTiles } from '../core/world/occupancy';
import type { Simulation } from '../core/sim/simulation';
import type { Building, Citizen, GameState } from '../core/world/state';
import { UI_COLOR } from './ui/theme';
import { ELEVATION_STEP, elevationOffsetY, floatElevationOffsetY } from './elevation';

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

/** 進度條配色：底用深墨、填色用與選單選中框同一個黃銅色，全介面一致。 */
const PROGRESS_BG = UI_COLOR.ink;
const PROGRESS_FILL = UI_COLOR.brass;

/** 單幀最多補跑幾個 tick。分頁切回來時一次補上千 tick 會直接凍住畫面。 */
export const MAX_TICKS_PER_FRAME = 5;

/** 僅供大世界驗收探針使用；一般開局不帶參數時仍採 core 的預設 worldSize。 */
function requestedWorldSize(): number | undefined {
  const raw = new URLSearchParams(window.location.search).get('worldSize');
  if (raw === null) return undefined;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 10 || value > 2000) {
    console.warn(`[CityScene] 忽略不合法的 worldSize query：${raw}`);
    return undefined;
  }
  return value;
}

/** `?new=1`：略過自動讀檔直接開新局（測試/驗收用；舊存檔會在第一次日界自動存檔時被覆蓋）。 */
function requestedNewGame(): boolean {
  return new URLSearchParams(window.location.search).get('new') === '1';
}

/**
 * `?tick=N`：開局後先 headless 快轉 N tick 再進畫面（驗收日夜、人口門檻這類要等的狀態）。
 * 上限一年（TICKS_PER_DAY × 120）：快轉在 create 內同步執行，太大會卡住頁面。
 */
function requestedFastForwardTicks(): number {
  const raw = new URLSearchParams(window.location.search).get('tick');
  if (raw === null) return 0;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0 || value > TICKS_PER_DAY * 120) {
    console.warn(`[CityScene] 忽略不合法的 tick query：${raw}`);
    return 0;
  }
  return value;
}

export class CityScene extends Phaser.Scene {
  private state!: GameState;
  private sim!: Simulation;
  private camera!: CameraController;
  private hud!: Hud;
  private build!: BuildController;
  private terrain!: TerrainRenderer;
  private colorGrade: ColorGradeHandle | null = null;
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
  /**
   * 只保存稀疏 terrainOverrides 的 key→type，不掃 worldSize²。每次 sim tick 後比較一次，
   * 可抓新增、刪除與 type 改變；resource-only 變動不重烘，因為畫面地形沒有改變。
   */
  private terrainOverrideTypes = new Map<string, string>();
  private progressBars!: Phaser.GameObjects.Graphics;
  private accumulator = 0;
  private speed: GameSpeed = INITIAL_SPEED;
  private storage: SaveStorage | null = null;
  /** 上次自動存檔時的遊戲日；日界才存一次，不是每 tick 都序列化整個世界。 */
  private savedDay = 0;
  /** 等待第二次按 N 確認的開新局請求。 */
  private pendingNewGame = false;

  constructor() {
    super(CITY_SCENE_KEY);
  }

  create(): void {
    this.storage = browserStorage();
    const world = createDemoWorld(requestedWorldSize());
    this.state = world.state;
    this.sim = world.sim;
    this.accumulator = 0;
    this.pendingNewGame = false;

    // 開機自動續上次進度。做成自動而非「按鍵讀檔」是因為真正的痛點是
    // 重新整理就整座城市歸零——會忘記按鍵的情境正好就是會弄丟進度的情境。
    let loadNotice: string | null = null;
    if (this.storage !== null && !requestedNewGame()) {
      const outcome = loadGame(this.storage);
      if (outcome.status === 'loaded') {
        this.state = outcome.state;
        this.sim = createSimulationFor(this.state);
        loadNotice = `已接續上次進度（第 ${timeFromTick(this.state.tick).totalDay} 天）`;
      } else if (outcome.status === 'outdated') {
        // 舊版存檔作廢是預期內的結果，不是故障——訊息不帶「讀不回來」那種故障語氣。
        // 也不主動刪檔：新局的第一次日界自動存檔就會覆蓋掉它。
        loadNotice = `舊版存檔（v${outcome.savedVersion}）不相容，已開新局`;
      } else if (outcome.status === 'corrupt') {
        // 壞檔不自動刪：玩家可能想手動搶救，靜默清掉會讓「城市不見了」毫無線索。
        loadNotice = `存檔讀不回來，已開新局（原檔仍保留）：${outcome.reason}`;
      }
    }
    for (let remaining = requestedFastForwardTicks(); remaining > 0; remaining -= 1) {
      this.sim.tick();
    }
    this.savedDay = timeFromTick(this.state.tick).totalDay;
    this.buildingSprites.clear();
    this.citizenSprites.clear();
    this.knownBuildingIds.clear();
    this.buildingTiles.clear();
    this.terrainOverrideTypes = this.snapshotTerrainOverrideTypes();

    // UI 攝影機要先建立：之後每個「世界」物件建立時都得叫它忽略，否則會被畫第二次
    this.uiCamera = this.cameras.add(0, 0, this.scale.width, this.scale.height);
    this.uiCamera.setName('ui');

    this.camera = new CameraController(this);
    this.camera.attach();
    this.colorGrade = applyColorGrade(this.cameras.main);
    this.colorGrade?.setNight(nightStrength(timeFromTick(this.state.tick).tickOfDay));

    // 世界包圍盒＝地圖外加一圈邊距（上方多留建築高度的頭部空間）。
    // 這是「世界有多大」，與視窗無關；攝影機實際 bounds 由 applyCameraBounds 依視窗再算。
    const margin = TILE_W * 2;
    const worldSize = this.state.worldSize;
    const left = gridToScreen(0, worldSize - 1).x - TILE_W / 2;
    const right = gridToScreen(worldSize - 1, 0).x + TILE_W / 2;
    // 頂部多留三階位移：墊高的山地會畫在平面投影之上，不留的話鏡頭捲到世界頂端時山被裁掉。
    const top = gridToScreen(0, 0).y - 3 * ELEVATION_STEP;
    const bottom = gridToScreen(worldSize - 1, worldSize - 1).y + TILE_H;
    this.worldBounds = {
      x: left - margin,
      y: top - margin - TILE_H * 3,
      w: right - left + margin * 2,
      h: bottom - top + margin * 2 + TILE_H * 3,
    };
    this.applyCameraBounds();

    // 開場把地圖中心對準畫面中央：地圖中心即中央那格的菱形中心
    const center = tileCenter(world.startCenter.x, world.startCenter.y);
    this.camera.centerOn(center.x, center.y);

    this.terrain = new TerrainRenderer(this, this.state, this.uiCamera);
    this.terrain.update(this.cameras.main);
    this.syncBuildings();
    this.syncCitizens();

    // onPick 在點擊當下才解參考 this.build——Hud 先建立（BuildController 的 HUD 死區要問它列高），
    // 但格子被點到必定晚於兩者都建好。
    this.hud = new Hud(
      this,
      this.state,
      this.sim,
      (def) => this.build.selectDef(def),
      (tab) => this.build.selectTab(tab),
    );
    this.hud.create();
    this.hud.updateViewport(this.cameras.main);
    this.cameras.main.ignore(this.hud.displayObjects);

    // 進度條掛在世界層（會跟著捲動縮放），depth 壓在建造預覽之下、所有建築之上
    this.progressBars = this.add.graphics().setDepth(PREVIEW_DEPTH - 1);
    this.uiCamera.ignore(this.progressBars);

    this.build = new BuildController(
      this,
      this.state,
      this.sim,
      (def, tab) => this.hud.setSelection(def, tab),
      (x, y) => this.hud.handlePalettePointer(x, y),
      (message) => this.hud.setNotice(message),
    );
    this.build.attach();
    this.uiCamera.ignore(this.build.displayObjects);

    this.attachSpeedKeys();
    this.attachSaveKeys();
    if (loadNotice !== null) this.hud.setNotice(loadNotice);

    // 視窗大小會變（Scale.RESIZE）：監聽要在場景關閉時解掉，否則場景重啟會疊上第二個
    // 監聽器，而舊監聽器持有的是已被銷毀的 hud/uiCamera。
    this.scale.on(Phaser.Scale.Events.RESIZE, this.handleResize, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.scale.off(Phaser.Scale.Events.RESIZE, this.handleResize, this);
      this.terrain.destroy();
      this.hud.destroy();
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

  /**
   * 重畫所有可見建築的進度條。每次 sim tick 後呼叫一次，不逐幀重畫——
   * 進度只在 tick 中變動，逐幀重畫等於每秒白做 50 次。
   *
   * 只畫視野內的建築：大地圖上建築可能上千棟，畫面外的條沒人看得到卻照樣要算。
   */
  private drawProgressBars(): void {
    const g = this.progressBars;
    g.clear();
    const view = this.cameras.main.worldView;
    for (const building of this.state.buildings) {
      const def = BUILDING_DEFS.find((candidate) => candidate.id === building.type);
      const ratio = progressRatio(building, def);
      if (ratio === null || ratio <= 0) continue;

      const size = buildingSize(building.type);
      const anchor = buildingAnchor(building.x, building.y, size.w, size.h);
      anchor.y += elevationOffsetY(this.state, building.x + size.w - 1, building.y + size.h - 1);
      const sprite = this.buildingSprites.get(building.id);
      const rect = barRect(anchor.x, anchor.y, sprite?.displayHeight ?? 0);
      if (
        rect.x + rect.w < view.x ||
        rect.x > view.right ||
        rect.y + rect.h < view.y ||
        rect.y > view.bottom
      ) {
        continue;
      }

      g.fillStyle(PROGRESS_BG, 0.75);
      g.fillRect(rect.x - 1, rect.y - 1, rect.w + 2, rect.h + 2);
      g.fillStyle(PROGRESS_FILL, 1);
      g.fillRect(rect.x, rect.y, filledWidth(ratio), rect.h);
    }
  }

  /**
   * 每跨過一個遊戲日存一次檔。以「日」為粒度而非每 tick：序列化整個世界並不便宜，
   * 而日界正好是人口、糧食、稅收結算的時點，存在這裡損失上限就是一天的進度。
   */
  private autoSaveOnDayBoundary(): void {
    if (this.storage === null) return;
    const day = timeFromTick(this.state.tick).totalDay;
    if (day === this.savedDay) return;
    this.savedDay = day;
    const outcome = saveGame(this.storage, this.state);
    if (!outcome.ok) {
      // 存檔失敗最可能是配額用盡，而且會在城市變大後才發生——要說出來，
      // 不然玩家會在完全不知情的狀況下繼續玩，直到某次重新整理才發現進度停在很久以前。
      this.hud.setNotice(`自動存檔失敗：${outcome.reason}`);
    }
  }

  /** N：開新局（兩段確認，比照拆除民居）。存檔是自動的，所以只需要一個「重來」的出口。 */
  private attachSaveKeys(): void {
    const keyboard = this.input.keyboard;
    if (!keyboard) return;
    keyboard.on('keydown-N', () => {
      if (!this.pendingNewGame) {
        this.pendingNewGame = true;
        this.hud.setNotice('再按一次 N 確認開新局——目前的城市會被覆蓋，或按 Esc 取消');
        return;
      }
      this.pendingNewGame = false;
      if (this.storage !== null) clearSave(this.storage);
      this.scene.restart();
    });
    keyboard.on('keydown-ESC', () => {
      if (!this.pendingNewGame) return;
      this.pendingNewGame = false;
      this.hud.setNotice(null);
    });
  }

  /** 速度鍵獨立於 BuildController：數字鍵已被建築選單佔滿，這裡用空白鍵與 - = 一組。 */
  private attachSpeedKeys(): void {
    const keyboard = this.input.keyboard;
    if (!keyboard) return;
    const apply = (next: GameSpeed): void => {
      this.speed = next;
      this.hud.setSpeed(next);
    };
    keyboard.on('keydown-SPACE', () => apply(togglePause(this.speed)));
    keyboard.on('keydown-M', () => {
      if (!this.hud.toggleMarket()) {
        this.hud.setNotice('還沒有市場——先蓋一座市場才能交易');
      }
    });
    // Esc 已被 BuildController 用來取消選取；市場開著時它優先關面板，符合「Esc 收掉最上層」的直覺
    keyboard.on('keydown-ESC', () => {
      if (this.hud.marketOpen) this.hud.closeMarket();
    });
    keyboard.on('keydown-MINUS', () => apply(changeSpeed(this.speed, -1)));
    keyboard.on('keydown-EQUALS', () => apply(changeSpeed(this.speed, 1)));
  }

  update(_time: number, deltaMs: number): void {
    // 滾輪縮放會改變可視範圍，而 CameraController 不知道世界邊界；每幀對一次簽章即可
    this.applyCameraBounds();

    let ticks = 0;
    const terrainChanges = new Map<string, { x: number; y: number }>();
    // 倍率直接乘在累積的實時毫秒上：模擬本身仍是固定時步（SIM_TICK_MS），
    // 只是每幀餵給它的時間變多，決定論不受影響。暫停時倍率為 0，accumulator 完全不動。
    this.accumulator += deltaMs * speedMultiplier(this.speed);
    while (this.accumulator >= SIM_TICK_MS && ticks < MAX_TICKS_PER_FRAME) {
      this.sim.tick();
      for (const tile of this.detectTerrainOverrideChanges()) {
        this.terrain.invalidateTile(tile.x, tile.y);
        terrainChanges.set(`${tile.x},${tile.y}`, tile);
      }
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
      this.drawProgressBars();
      this.hud.refresh();
      this.colorGrade?.setNight(nightStrength(timeFromTick(this.state.tick).tickOfDay));
      this.autoSaveOnDayBoundary();
    }
    if (terrainChanges.size > 0) this.hud.updateTerrain([...terrainChanges.values()]);

    this.terrain.update(this.cameras.main);
    this.hud.updateViewport(this.cameras.main);
    // 預覽每幀更新：滑鼠沒動但攝影機動了，hover 的格子也會變
    this.build.update();
  }

  /** 提供瀏覽器效能探針讀取，不暴露或改寫 core state。 */
  getTerrainMetrics(): TerrainRenderMetrics {
    return this.terrain.metrics;
  }

  private snapshotTerrainOverrideTypes(): Map<string, string> {
    const snapshot = new Map<string, string>();
    for (const [key, override] of Object.entries(this.state.terrainOverrides)) {
      snapshot.set(key, override.type ?? '');
    }
    return snapshot;
  }

  private detectTerrainOverrideChanges(): Array<{ x: number; y: number }> {
    const next = this.snapshotTerrainOverrideTypes();
    const changedKeys = new Set<string>();
    for (const [key, type] of next) {
      if (!this.terrainOverrideTypes.has(key) || this.terrainOverrideTypes.get(key) !== type) {
        changedKeys.add(key);
      }
    }
    for (const key of this.terrainOverrideTypes.keys()) {
      if (!next.has(key)) changedKeys.add(key);
    }
    this.terrainOverrideTypes = next;

    const changed: Array<{ x: number; y: number }> = [];
    for (const key of changedKeys) {
      const [xText, yText] = key.split(',');
      const x = Number(xText);
      const y = Number(yText);
      if (Number.isInteger(x) && Number.isInteger(y)) changed.push({ x, y });
    }
    return changed;
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
    const anchor = buildingAnchor(building.x, building.y, size.w, size.h);
    anchor.y += elevationOffsetY(this.state, building.x + size.w - 1, building.y + size.h - 1);
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
    // 高度用雙線性插值：座標 0.1 格步進，取所在格會在跨過階地邊緣的瞬間垂直跳 8px，
    // 插值讓居民看起來沿斜坡走上去。
    const lift = floatElevationOffsetY(this.state, citizen.x, citizen.y);
    sprite.setPosition(center.x + offset.dx, center.y + CITIZEN_Y_OFFSET + offset.dy + lift);
    sprite.setDepth(citizen.x + citizen.y + 0.5);
  }
}
