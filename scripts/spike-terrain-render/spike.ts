// scripts/spike-terrain-render/spike.ts
// M3.9-T2 技術驗證 spike：兩種大地圖等距地形渲染方案的吞吐量比較。
// 這是驗證用途的獨立 Phaser Game 實例，不進遊戲正式渲染路徑，不被 src/ 下任何檔案 import。
// 唯讀依賴 src/render/iso.ts 的既有等距座標公式（gridToScreen/tileCenter），確保量到的
// 「無接縫」結果與正式遊戲的擺放慣例一致——見 CityScene.ts/placement.ts 的同款用法。
//
// 兩個方案：
// 1. rendertexture：地形依 chunkSize×chunkSize 格分塊烘進 RenderTexture，只烘攝影機視野
//    （含 padding）覆蓋到的區塊、快取數超過上限淘汰最舊者。這是刻意偏離「開場把全圖烘完，
//    只靠攝影機裁切顯示」的字面讀法——1000×1000 世界若開場全烘，總像素預算與世界格數成正比，
//    會需要數 GB 顯示記憶體（見報告第 3 節的算式），瀏覽器根本撐不住；因此改採「視野內才烘、
//    烘過的快取，遠離視野的淘汰」，也更貼近 W2 動態改地形時「只重烘受影響區塊」的實際用法。
// 2. tilemap：Phaser 內建 Tilemap 的 isometric orientation，開場建滿整張 worldSize×worldSize
//    的 tile 資料（Phaser Tilemap 本身沒有「只建可見範圍資料」的內建 API，這是它與方案 1 的
//    根本差異之一，也是要測的重點——見報告的物件數欄）。

import Phaser from 'phaser';
import { TILE_H, TILE_W, tileCenter } from '../../src/render/iso';

const moduleT0 = performance.now();

const TILE_URLS = {
  'tile-grass-01': new URL('../../assets/game/tile-grass-01.png', import.meta.url).href,
  'tile-grass-02': new URL('../../assets/game/tile-grass-02.png', import.meta.url).href,
  'tile-dirt-01': new URL('../../assets/game/tile-dirt-01.png', import.meta.url).href,
} as const;
const TILE_KEYS = Object.keys(TILE_URLS) as (keyof typeof TILE_URLS)[];

/**
 * 決定性地形變體挑選：純為 spike 內容生成，不追求正確地形（見派工簡報：
 * 「這個 spike 不需要正確的地形生成，重點是渲染吞吐量」）。同格永遠同一變體。
 */
function pickVariant(gx: number, gy: number): 0 | 1 | 2 {
  return (((gx * 928371 + gy * 12841 + gx * gy * 7) >>> 0) % 3) as 0 | 1 | 2;
}

interface SpikeParams {
  mode: 'rendertexture' | 'tilemap';
  worldSize: number;
  chunkSize: number;
  zoom: number;
}

function readParams(): SpikeParams {
  const p = new URLSearchParams(window.location.search);
  const mode = p.get('mode') === 'tilemap' ? 'tilemap' : 'rendertexture';
  const worldSize = Math.max(1, Number(p.get('worldSize') ?? '200') || 200);
  const chunkSize = Math.max(1, Number(p.get('chunkSize') ?? '32') || 32);
  const zoom = Number(p.get('zoom') ?? '2') || 2;
  return { mode, worldSize, chunkSize, zoom };
}

interface PanStats {
  avgFps: number;
  minFps: number;
  sampleCount: number;
}

interface SpikeApi {
  ready: boolean;
  metrics: Record<string, unknown> | null;
  objectCount(): number;
  heapBytes(): number | null;
  startPan(vx: number, vy: number): void;
  stopPan(): PanStats;
  rebakeCenter(): number;
}

declare global {
  interface Window {
    __spike: SpikeApi;
  }
}

interface Bbox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * 分塊 RenderTexture 管理器（見檔頭方案 1 說明）。
 * chunkBbox 只在建構時算一次（O((worldSize/chunkSize)²)，不是 O(worldSize²)）；
 * update() 每幀只掃這份區塊索引，不掃格子本身，故成本與世界格數無關、只與區塊數有關。
 */
class ChunkedTerrain {
  private readonly cache = new Map<string, { rt: Phaser.GameObjects.RenderTexture; lastUsed: number; bbox: Bbox }>();
  private readonly chunkBbox = new Map<string, Bbox>();
  private tick = 0;
  private bakeCount = 0;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly worldSize: number,
    private readonly chunkSize: number,
    private readonly maxCached = 160,
  ) {
    const chunksPerAxis = Math.ceil(worldSize / chunkSize);
    for (let cy = 0; cy < chunksPerAxis; cy++) {
      for (let cx = 0; cx < chunksPerAxis; cx++) {
        this.chunkBbox.set(`${cx},${cy}`, this.computeBbox(cx, cy));
      }
    }
  }

  /**
   * 區塊的畫面座標包圍盒：tileCenter.x = (gx-gy)*TILE_W/2 在 (x1,y0) 取最大、(x0,y1) 取最小；
   * tileCenter.y = (gx+gy)*TILE_H/2+TILE_H/2 在 (x1,y1) 取最大、(x0,y0) 取最小（見 iso.ts）。
   */
  private computeBbox(cx: number, cy: number): Bbox {
    const x0 = cx * this.chunkSize;
    const y0 = cy * this.chunkSize;
    const x1 = Math.min(x0 + this.chunkSize, this.worldSize) - 1;
    const y1 = Math.min(y0 + this.chunkSize, this.worldSize) - 1;
    const leftPoint = tileCenter(x0, y1);
    const rightPoint = tileCenter(x1, y0);
    const topPoint = tileCenter(x0, y0);
    const bottomPoint = tileCenter(x1, y1);
    const left = leftPoint.x - TILE_W / 2;
    const right = rightPoint.x + TILE_W / 2;
    const top = topPoint.y - TILE_H / 2;
    const bottom = bottomPoint.y + TILE_H / 2;
    return { x0, y0, x1, y1, left, top, width: right - left, height: bottom - top };
  }

  /**
   * 烘一個區塊：已存在就清空重畫（供「重烘成本」量測用），不存在就新建 RenderTexture。
   *
   * 效能坑記錄：一開始用「每格呼叫一次 rt.draw(key,x,y)」的寫法，chunkSize=64（每區塊 4096 格）
   * 實測初始化耗時飆到 130 秒，遠不成比例（chunkSize=32 只要 12.6 秒，格數只差 4 倍，耗時卻差
   * 超過 10 倍）——原因是 RenderTexture.draw() 每呼叫一次就是一次 render target 切換，
   * Phaser 官方文件本身就提醒「一次畫一堆物件時，應該傳陣列一次呼叫，而不是分開呼叫很多次」。
   * 改成：先建一批「未掛進場景」的 Image 物件（new Phaser.GameObjects.Image，不經 scene.add，
   * 不會被主場景重複畫到），塞進陣列，一次 `rt.draw(images)` 呼叫（內部單一 batch flush），
   * 畫完立刻 destroy 釋放。這是本 spike 最重要的實作教訓，寫進報告第 3 節。
   */
  private bake(key: string): number {
    const bbox = this.chunkBbox.get(key);
    if (bbox === undefined) return -1;
    const t0 = performance.now();
    let entry = this.cache.get(key);
    if (entry === undefined) {
      const rt = this.scene.add.renderTexture(bbox.left, bbox.top, Math.ceil(bbox.width), Math.ceil(bbox.height));
      entry = { rt, lastUsed: this.tick, bbox };
      this.cache.set(key, entry);
    } else {
      entry.rt.clear();
      entry.lastUsed = this.tick;
    }
    const batch: Phaser.GameObjects.Image[] = [];
    for (let gy = bbox.y0; gy <= bbox.y1; gy++) {
      for (let gx = bbox.x0; gx <= bbox.x1; gx++) {
        const center = tileCenter(gx, gy);
        const localX = center.x - TILE_W / 2 - bbox.left;
        const localY = center.y - TILE_H / 2 - bbox.top;
        const img = new Phaser.GameObjects.Image(this.scene, localX, localY, TILE_KEYS[pickVariant(gx, gy)]);
        img.setOrigin(0, 0);
        batch.push(img);
      }
    }
    entry.rt.draw(batch);
    for (const img of batch) {
      img.destroy();
    }
    this.bakeCount += 1;
    return performance.now() - t0;
  }

  private evictIfNeeded(): void {
    if (this.cache.size <= this.maxCached) return;
    let oldestKey: string | null = null;
    let oldestTick = Infinity;
    for (const [key, entry] of this.cache) {
      if (entry.lastUsed < oldestTick) {
        oldestTick = entry.lastUsed;
        oldestKey = key;
      }
    }
    if (oldestKey !== null) {
      this.cache.get(oldestKey)?.rt.destroy();
      this.cache.delete(oldestKey);
    }
  }

  /** 依攝影機視野（含固定像素 padding）烘出交集到的區塊；已烘過的只更新 lastUsed。 */
  update(camera: Phaser.Cameras.Scene2D.Camera): void {
    this.tick += 1;
    const view = camera.worldView;
    const pad = Math.max(TILE_W, TILE_H) * 4;
    for (const [key, bbox] of this.chunkBbox) {
      const intersects =
        bbox.left < view.right + pad &&
        bbox.left + bbox.width > view.x - pad &&
        bbox.top < view.bottom + pad &&
        bbox.top + bbox.height > view.y - pad;
      if (!intersects) continue;
      const cached = this.cache.get(key);
      if (cached === undefined) {
        this.bake(key);
      } else {
        cached.lastUsed = this.tick;
      }
    }
    this.evictIfNeeded();
  }

  /** 找出攝影機視野中心所在的區塊，強制重烘（模擬 W2 砍樹之類的地形變動）。 */
  rebakeCenter(camera: Phaser.Cameras.Scene2D.Camera): number {
    const view = camera.worldView;
    const cx = view.centerX;
    const cy = view.centerY;
    for (const [key, bbox] of this.chunkBbox) {
      if (cx >= bbox.left && cx <= bbox.left + bbox.width && cy >= bbox.top && cy <= bbox.top + bbox.height) {
        return this.bake(key);
      }
    }
    return -1;
  }

  get objectCount(): number {
    return this.cache.size;
  }

  get totalBakeCount(): number {
    return this.bakeCount;
  }
}

class SpikeScene extends Phaser.Scene {
  private params!: SpikeParams;
  private chunked?: ChunkedTerrain;
  private panVX = 0;
  private panVY = 0;
  private collecting = false;
  private fpsSamples: number[] = [];
  private lastInstFps = 0;

  constructor() {
    super('spike');
  }

  preload(): void {
    for (const key of TILE_KEYS) {
      this.load.image(key, TILE_URLS[key]);
    }
  }

  create(): void {
    this.params = readParams();
    const buildT0 = performance.now();

    let tileObjectCount: number | null = null;
    if (this.params.mode === 'tilemap') {
      tileObjectCount = this.createTilemap();
    } else {
      this.chunked = new ChunkedTerrain(this, this.params.worldSize, this.params.chunkSize);
    }

    const camera = this.cameras.main;
    camera.setZoom(this.params.zoom);
    const mid = (this.params.worldSize - 1) / 2;
    const center = tileCenter(mid, mid);
    camera.centerOn(center.x, center.y);

    // 首幀先烘出目前視野範圍：rendertexture 模式的「初始化到第一幀可見」包含這一步
    if (this.chunked !== undefined) {
      this.chunked.update(camera);
    }
    const buildMs = performance.now() - buildT0;

    window.__spike.metrics = {
      mode: this.params.mode,
      worldSize: this.params.worldSize,
      chunkSize: this.params.chunkSize,
      buildMs,
      moduleToCreateMs: buildT0 - moduleT0,
      tileObjectCount,
      initialBakedChunks: this.chunked?.objectCount ?? null,
    };
    window.__spike.objectCount = () => this.children.list.length;
    window.__spike.heapBytes = () => {
      const perf = performance as Performance & { memory?: { usedJSHeapSize: number } };
      return perf.memory?.usedJSHeapSize ?? null;
    };
    window.__spike.startPan = (vx: number, vy: number) => {
      this.panVX = vx;
      this.panVY = vy;
      this.fpsSamples = [];
      this.collecting = true;
    };
    window.__spike.stopPan = () => {
      this.panVX = 0;
      this.panVY = 0;
      this.collecting = false;
      const samples = this.fpsSamples;
      const avgFps = samples.length > 0 ? samples.reduce((a, b) => a + b, 0) / samples.length : 0;
      const minFps = samples.length > 0 ? Math.min(...samples) : 0;
      return { avgFps, minFps, sampleCount: samples.length };
    };
    window.__spike.rebakeCenter = () =>
      this.chunked !== undefined ? this.chunked.rebakeCenter(this.cameras.main) : -1;
    window.__spike.ready = true;
  }

  update(_time: number, deltaMs: number): void {
    if (deltaMs > 0) {
      this.lastInstFps = 1000 / deltaMs;
    }
    if (this.collecting) {
      this.fpsSamples.push(this.lastInstFps);
    }
    if (this.panVX !== 0 || this.panVY !== 0) {
      this.cameras.main.scrollX += (this.panVX * deltaMs) / 1000;
      this.cameras.main.scrollY += (this.panVY * deltaMs) / 1000;
    }
    if (this.chunked !== undefined) {
      this.chunked.update(this.cameras.main);
    }
  }

  /**
   * 建滿整張世界的 isometric Tilemap：先把三種地形圖組成一張橫排 tileset canvas
   * （addTilesetImage 靠等寬切格自動識別 3 個 tile frame，不必手動註冊 frame），
   * 再用 Parse2DArray 建 MapData（比逐格 putTileAt 快很多，見 Phaser 原始碼），
   * 手動把 orientation 覆寫成 ISOMETRIC——ParseToTilemap 的公開介面不支援指定 orientation，
   * 但 Parse2DArray 回傳的 MapData 物件本身可寫。回傳格數供報告記錄 Tile 物件量。
   */
  private createTilemap(): number {
    const { worldSize } = this.params;
    const canvas = document.createElement('canvas');
    canvas.width = TILE_W * TILE_KEYS.length;
    canvas.height = TILE_H;
    const ctx = canvas.getContext('2d');
    if (ctx === null) {
      throw new Error('spike: 無法取得 2d context 組合 tileset');
    }
    TILE_KEYS.forEach((key, i) => {
      const img = this.textures.get(key).getSourceImage() as HTMLImageElement;
      ctx.drawImage(img, i * TILE_W, 0, TILE_W, TILE_H);
    });
    this.textures.addCanvas('terrain-packed', canvas);

    const data: number[][] = [];
    for (let gy = 0; gy < worldSize; gy++) {
      const row = new Array<number>(worldSize);
      for (let gx = 0; gx < worldSize; gx++) {
        row[gx] = 1 + pickVariant(gx, gy);
      }
      data.push(row);
    }

    // 陷阱記錄：mapData.orientation 與 layerData.orientation 是兩個獨立欄位（Tile 的
    // pixelX/pixelY 只認 layer.orientation，見 Phaser 原始碼 Tile.js updatePixelXY）。
    // Parse2DArray 建 Tile 當下 layerData.orientation 還是預設的 ORTHOGONAL，只改
    // mapData.orientation 不會讓已建好的 Tile 重算座標——實測會拿到「方格網」而非等距菱形
    // （每格各自方正排列、彼此間留白），必須連 layerData.orientation 一起改，
    // 且要對每個既有 Tile 呼叫 updatePixelXY() 補算，才會是等距交錯排列。
    const mapData = Phaser.Tilemaps.Parsers.Parse2DArray('spike', data, TILE_W, TILE_H, false);
    mapData.orientation = Phaser.Tilemaps.Orientation.ISOMETRIC;
    const layerData = mapData.layers[0];
    layerData.orientation = Phaser.Tilemaps.Orientation.ISOMETRIC;
    for (const row of layerData.data) {
      for (const tile of row) {
        tile?.updatePixelXY();
      }
    }
    const tilemap = new Phaser.Tilemaps.Tilemap(this, mapData);
    const tileset = tilemap.addTilesetImage('terrain-packed', 'terrain-packed', TILE_W, TILE_H, 0, 0);
    if (tileset === null) {
      throw new Error('spike: addTilesetImage 失敗');
    }
    tilemap.createLayer(0, tileset, 0, 0);
    return worldSize * worldSize;
  }
}

window.__spike = {
  ready: false,
  metrics: null,
  objectCount: () => 0,
  heapBytes: () => null,
  startPan: () => {},
  stopPan: () => ({ avgFps: 0, minFps: 0, sampleCount: 0 }),
  rebakeCenter: () => -1,
};

new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'app',
  width: window.innerWidth,
  height: window.innerHeight,
  backgroundColor: '#1c2030',
  pixelArt: true,
  roundPixels: true,
  scale: {
    mode: Phaser.Scale.RESIZE,
    autoCenter: Phaser.Scale.NO_CENTER,
  },
  scene: [SpikeScene],
});
