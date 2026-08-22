import Phaser from 'phaser';
import { terrainAt, type TerrainType } from '../core/world/terrain';
import type { GameState } from '../core/world/state';
import { TERRAIN_TEXTURE_BY_TYPE } from './assets';
import { TILE_H, TILE_W, gridToScreen } from './iso';
import { TERRAIN_DEPTH } from './placement';

export const TERRAIN_CHUNK_SIZE = 64;

const VIEW_PADDING_TILES = 4;
const MAX_RETAINED_CHUNKS = 12;

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

  /** 只標記目前有 cache 的 chunk；未烘 chunk 首次出現時自然會讀到最新 core state。 */
  invalidateTile(x: number, y: number): void {
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

    const images: Phaser.GameObjects.Image[] = [];
    for (let gy = bounds.y0; gy <= bounds.y1; gy++) {
      for (let gx = bounds.x0; gx <= bounds.x1; gx++) {
        const type = terrainAt(this.state, gx, gy);
        const textureKey = TERRAIN_TEXTURE_BY_TYPE[type];
        if (!this.scene.textures.exists(textureKey)) {
          throw new Error(`TerrainRenderer: texture key "${textureKey}" 尚未載入`);
        }
        const screen = gridToScreen(gx, gy);
        const image = new Phaser.GameObjects.Image(
          this.scene,
          screen.x - bounds.left,
          screen.y - bounds.top,
          textureKey,
        ).setOrigin(0, 0);
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
    const top = gridToScreen(x0, y0).y;
    const bottom = gridToScreen(x1, y1).y + TILE_H;
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
