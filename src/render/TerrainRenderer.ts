import Phaser from 'phaser';
import { terrainAt, type TerrainType } from '../core/world/terrain';
import type { GameState } from '../core/world/state';
import { EDGE_OFFSETS, terrainTextureKeyFor } from './terrainTiles';
import { ELEVATION_STEP, MAX_ELEVATION_LEVEL, levelAt } from './elevation';
import { TILE_H, TILE_W, gridToScreen } from './iso';
import { TERRAIN_DEPTH } from './placement';

export const TERRAIN_CHUNK_SIZE = 64;

const VIEW_PADDING_TILES = 4;
const MAX_RETAINED_CHUNKS = 12;

/** chunk RT 上下各留的高度餘裕：上排補畫半格 ＋ 最高三階的位移 ＋ 裙邊下延。 */
const ELEVATION_PADDING = TILE_H / 2 + MAX_ELEVATION_LEVEL * ELEVATION_STEP;

/** 裙邊（階地側面的土壁）的壓暗 tint：讓側面明顯暗於頂面，立體感來自明暗不是輪廓線。 */
const SKIRT_TINT = 0x8f8578;

/** 小地圖用的地形代表色（一格一像素）。地形 tile 本身有正式素材，烘焙時不再染色。 */
export const TERRAIN_TINT: Readonly<Record<TerrainType, number>> = {
  water: 0x4f79a8,
  sand: 0xd8bd78,
  grass: 0x8fcf62,
  forest: 0x42784a,
  rock: 0x8b9299,
  mountain: 0x665f76,
};

interface ChunkBounds {
  key: string;
  cx: number;
  cy: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  left: number;
  top: number;
  width: number;
  height: number;
}

interface ChunkEntry {
  texture: Phaser.GameObjects.RenderTexture;
  bounds: ChunkBounds;
  lastUsedFrame: number;
}

export interface TerrainRenderMetrics {
  cachedChunks: number;
  bakedChunks: number;
  totalBakeMs: number;
  lastBakeMs: number;
}

/**
 * 64×64 是 W1 spike 在 1000×1000 世界平移時較穩定的選擇（35.8 FPS，優於 32 的
 * 25.8 FPS）。單張 RT 為 4096×2048，仍落在 WebGL 常見的 4096 texture 上限內。
 *
 * 每個 chunk 只建立一個場景物件。烘焙時建立未加入 display list 的 Image 陣列，再以
 * RenderTexture.draw(images) 一次送出；逐格 draw 在 spike 中慢了約四個數量級。
 */
export class TerrainRenderer {
  private readonly chunks = new Map<string, ChunkBounds>();
  private readonly cache = new Map<string, ChunkEntry>();
  private readonly dirty = new Set<string>();
  private frame = 0;
  private bakedChunks = 0;
  private totalBakeMs = 0;
  private lastBakeMs = 0;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly state: GameState,
    private readonly uiCamera?: Phaser.Cameras.Scene2D.Camera,
    private readonly chunkSize = TERRAIN_CHUNK_SIZE,
  ) {
    const chunksPerAxis = Math.ceil(state.worldSize / chunkSize);
    for (let cy = 0; cy < chunksPerAxis; cy++) {
      for (let cx = 0; cx < chunksPerAxis; cx++) {
        const bounds = this.computeBounds(cx, cy);
        this.chunks.set(bounds.key, bounds);
      }
    }
  }

  update(camera: Phaser.Cameras.Scene2D.Camera): void {
    this.frame += 1;
    const view = camera.worldView;
    const viewPadding = VIEW_PADDING_TILES * Math.max(TILE_W, TILE_H);
    const wanted = [...this.chunks.values()]
      .filter((bounds) => this.intersects(bounds, view, viewPadding))
      .sort((a, b) => this.distanceToViewCenter(a, view) - this.distanceToViewCenter(b, view));
    const wantedKeys = new Set(wanted.map((bounds) => bounds.key));

    // 開場一次烘完可視區；之後平移每幀最多新增一塊，避免跨 chunk 時同幀多次烘焙。
    let newChunkBudget = this.cache.size === 0 ? Number.POSITIVE_INFINITY : 1;
    for (const bounds of wanted) {
      const cached = this.cache.get(bounds.key);
      if (cached !== undefined) {
        cached.lastUsedFrame = this.frame;
        if (this.dirty.has(bounds.key)) this.bake(bounds);
        continue;
      }
      if (newChunkBudget > 0) {
        this.bake(bounds);
        newChunkBudget -= 1;
      }
    }

    // retention padding 約為一個 chunk 的水平投影；超出後立刻釋放，近邊界則保留以防抖動。
    const retentionPadding = (this.chunkSize * TILE_W) / 2;
    for (const [key, entry] of this.cache) {
      if (!wantedKeys.has(key) && !this.intersects(entry.bounds, view, retentionPadding)) {
        this.evict(key);
      }
    }

    // 可視 chunk 數可能因 viewport 而超過固定上限，這時只淘汰非可視 LRU。
    const limit = Math.max(MAX_RETAINED_CHUNKS, wantedKeys.size);
    while (this.cache.size > limit) {
      let oldest: ChunkEntry | undefined;
      for (const entry of this.cache.values()) {
        if (wantedKeys.has(entry.bounds.key)) continue;
        if (oldest === undefined || entry.lastUsedFrame < oldest.lastUsedFrame) oldest = entry;
      }
      if (oldest === undefined) break;
      this.evict(oldest.bounds.key);
    }
  }

  /**
   * 只標記目前有 cache 的 chunk；未烘 chunk 首次出現時自然會讀到最新 core state。
   *
   * 連四個鄰格所屬的 chunk 一起標髒：地形過渡讓一格的選圖依賴鄰格，變動格落在 chunk
   * 邊界時，隔壁 chunk 那一排的過渡邊也失效了。只標自己會在 chunk 交界留下一條
   * 沒更新的舊接縫，而且它只在「剛好改到邊界格」時出現，極難重現。
   */
  invalidateTile(x: number, y: number): void {
    if (x < 0 || y < 0 || x >= this.state.worldSize || y >= this.state.worldSize) return;
    this.markChunkDirty(x, y);
    for (const { dx, dy } of EDGE_OFFSETS) this.markChunkDirty(x + dx, y + dy);
  }

  private markChunkDirty(x: number, y: number): void {
    if (x < 0 || y < 0 || x >= this.state.worldSize || y >= this.state.worldSize) return;
    const key = `${Math.floor(x / this.chunkSize)},${Math.floor(y / this.chunkSize)}`;
    if (this.cache.has(key)) this.dirty.add(key);
  }

  destroy(): void {
    for (const entry of this.cache.values()) entry.texture.destroy();
    this.cache.clear();
    this.dirty.clear();
  }

  get metrics(): TerrainRenderMetrics {
    return {
      cachedChunks: this.cache.size,
      bakedChunks: this.bakedChunks,
      totalBakeMs: this.totalBakeMs,
      lastBakeMs: this.lastBakeMs,
    };
  }

  private bake(bounds: ChunkBounds): void {
    const startedAt = performance.now();
    let entry = this.cache.get(bounds.key);
    if (entry === undefined) {
      const texture = this.scene.add
        .renderTexture(bounds.left, bounds.top, bounds.width, bounds.height)
        .setOrigin(0, 0)
        .setDepth(TERRAIN_DEPTH);
      this.uiCamera?.ignore(texture);
      entry = { texture, bounds, lastUsedFrame: this.frame };
      this.cache.set(bounds.key, entry);
    } else {
      entry.texture.clear();
      entry.lastUsedFrame = this.frame;
    }

    const patch = this.readTerrainPatch(bounds);
    const images: Phaser.GameObjects.Image[] = [];
    // 範圍比 chunk 多畫「上一排」與左右各一格：墊高與裙邊讓一格的像素越出自己的
    // chunk 矩形，交界區域改由兩側 chunk 各自重複繪製同一格（內容一致、各裁各的界），
    // 跨 RT 的遮擋就不必依賴 RenderTexture 的加入順序。
    for (let gy = bounds.y0 - 1; gy <= bounds.y1; gy++) {
      for (let gx = bounds.x0 - 1; gx <= bounds.x1 + 1; gx++) {
        const type = patch.type(gx, gy);
        const level = patch.level(gx, gy);
        const textureKey = terrainTextureKeyFor(type, (dx, dy) => patch.type(gx + dx, gy + dy));
        if (!this.scene.textures.exists(textureKey)) {
          throw new Error(`TerrainRenderer: texture key "${textureKey}" 尚未載入`);
        }
        const screen = gridToScreen(gx, gy);
        const drawX = screen.x - bounds.left;
        const topY = screen.y - bounds.top - level * ELEVATION_STEP;

        // 裙邊：本格比「螢幕前方」的兩個鄰格（右下 gx+1、左下 gy+1）高出幾階，
        // 就往下鋪幾層壓暗的土 tile 當側壁。多鋪的部分會被同高或更高的前鄰蓋住
        // （前鄰在迴圈中較晚繪製），所以取兩鄰的較小值即可，不必分側處理。
        const frontLevel = Math.min(patch.level(gx + 1, gy), patch.level(gx, gy + 1));
        for (let k = level - frontLevel; k >= 1; k--) {
          const skirt = new Phaser.GameObjects.Image(
            this.scene,
            drawX,
            topY + k * ELEVATION_STEP,
            'tile-dirt-01',
          ).setOrigin(0, 0);
          skirt.setTint(SKIRT_TINT);
          images.push(skirt);
        }

        const image = new Phaser.GameObjects.Image(this.scene, drawX, topY, textureKey).setOrigin(0, 0);
        images.push(image);
      }
    }
    entry.texture.draw(images);
    for (const image of images) image.destroy();

    this.dirty.delete(bounds.key);
    this.bakedChunks += 1;
    this.lastBakeMs = performance.now() - startedAt;
    this.totalBakeMs += this.lastBakeMs;
  }

  /**
   * 把 chunk 範圍外擴兩圈的地形與階層一次讀進陣列，回傳查表函式。
   *
   * 為什麼不逐格現查：過渡選圖要看四個鄰格，逐格呼叫會讓 terrainAt 從每格 1 次變 5 次，
   * 而 terrainAt 是程序生成（sqrt/pow 加兩組 fBm），是烘焙成本的大頭。預讀後每格只算一次。
   * 外擴**兩圈**：繪製範圍本身已外擴一格（見 bake 的迴圈註解），那些格的過渡選圖與
   * 裙邊判定還要再往外看一格鄰居。
   *
   * 世界邊界外一律視為 water／階層 0：地圖邊緣不該長出海岸線，島嶼地圖的邊緣本來就是海。
   */
  private readTerrainPatch(bounds: ChunkBounds): {
    type: (gx: number, gy: number) => TerrainType;
    level: (gx: number, gy: number) => number;
  } {
    const x0 = bounds.x0 - 2;
    const y0 = bounds.y0 - 2;
    const w = bounds.x1 - bounds.x0 + 5;
    const h = bounds.y1 - bounds.y0 + 5;
    const size = this.state.worldSize;
    const cells: TerrainType[] = new Array<TerrainType>(w * h);
    const levels = new Int8Array(w * h);
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) {
        const gx = x0 + i;
        const gy = y0 + j;
        const inside = gx >= 0 && gy >= 0 && gx < size && gy < size;
        cells[j * w + i] = inside ? terrainAt(this.state, gx, gy) : 'water';
        levels[j * w + i] = inside ? levelAt(this.state, gx, gy) : 0;
      }
    }
    return {
      type: (gx, gy) => cells[(gy - y0) * w + (gx - x0)],
      level: (gx, gy) => levels[(gy - y0) * w + (gx - x0)],
    };
  }

  private evict(key: string): void {
    const entry = this.cache.get(key);
    if (entry === undefined) return;
    entry.texture.destroy();
    this.cache.delete(key);
    this.dirty.delete(key);
  }

  private computeBounds(cx: number, cy: number): ChunkBounds {
    const x0 = cx * this.chunkSize;
    const y0 = cy * this.chunkSize;
    const x1 = Math.min(x0 + this.chunkSize, this.state.worldSize) - 1;
    const y1 = Math.min(y0 + this.chunkSize, this.state.worldSize) - 1;
    const left = gridToScreen(x0, y1).x - TILE_W / 2;
    const right = gridToScreen(x1, y0).x + TILE_W / 2;
    // 上下各留一段 padding：墊高的頂排 tile 會畫出原本的上緣（最多 TILE_H/2 的上排補畫
    // ＋ 3 階位移），底排的裙邊會延伸出原本的下緣。沒有 padding 這些像素會被 RT 裁掉，
    // 在 chunk 交界露出破洞。
    const top = gridToScreen(x0, y0).y - ELEVATION_PADDING;
    const bottom = gridToScreen(x1, y1).y + TILE_H + ELEVATION_PADDING;
    return {
      key: `${cx},${cy}`,
      cx,
      cy,
      x0,
      y0,
      x1,
      y1,
      left,
      top,
      width: right - left,
      height: bottom - top,
    };
  }

  private intersects(
    bounds: ChunkBounds,
    view: Phaser.Geom.Rectangle,
    padding: number,
  ): boolean {
    return (
      bounds.left < view.right + padding &&
      bounds.left + bounds.width > view.left - padding &&
      bounds.top < view.bottom + padding &&
      bounds.top + bounds.height > view.top - padding
    );
  }

  private distanceToViewCenter(bounds: ChunkBounds, view: Phaser.Geom.Rectangle): number {
    const dx = bounds.left + bounds.width / 2 - view.centerX;
    const dy = bounds.top + bounds.height / 2 - view.centerY;
    return dx * dx + dy * dy;
  }
}
