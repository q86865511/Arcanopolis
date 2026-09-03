import Phaser from 'phaser';
import { terrainAt, type TerrainType } from '../core/world/terrain';
import { hasRoad } from '../core/world/roads';
import type { GameState } from '../core/world/state';
import { TILE_H, screenToGrid } from './iso';

const MAX_DISPLAY_SIZE = 160;
const EDGE_PADDING = 12;
const MIN_DISPLAY_SIZE = 32;

// 代表色取自 assets\game 對應 tile 的實際表面均色（W1 AoE2 定調重生後同步，2026-08-25）。
const TERRAIN_COLOR: Readonly<Record<TerrainType, readonly [number, number, number]>> = {
  water: [43, 74, 78],
  sand: [213, 185, 116],
  grass: [84, 89, 39],
  forest: [56, 61, 25],
  rock: [124, 132, 139],
  mountain: [83, 73, 96],
};

// 道路蓋過地形色：路網的形狀是玩家在小地圖上要讀的第一件事，被底下的草綠切斷就看不出連通。
// 選暖土色而非中性灰——六種地形色裡只有 sand 偏暖，而 sand 亮得多，兩者在 160px 縮圖上仍分得開。
const ROAD_COLOR: readonly [number, number, number] = [150, 106, 62];

export interface MinimapTile {
  x: number;
  y: number;
}

/**
 * 地形底圖是一格一像素的 CanvasTexture：開場完整產生一次，之後只改 override 影響的像素，
 * 不會每幀掃描世界。每幀只有相機視野的四邊形 Graphics 會重畫，成本固定。
 */
export class Minimap {
  private readonly objects: Phaser.GameObjects.GameObject[] = [];
  private readonly canvas = document.createElement('canvas');
  private readonly textureKey: string;
  private context!: CanvasRenderingContext2D;
  private image!: Phaser.GameObjects.Image;
  private frame!: Phaser.GameObjects.Graphics;
  private viewport!: Phaser.GameObjects.Graphics;
  private left = 0;
  private top = 0;
  private displaySize = MAX_DISPLAY_SIZE;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly state: GameState,
    private readonly depth: number,
  ) {
    this.textureKey = `minimap-terrain-${scene.sys.settings.key}`;
  }

  create(): void {
    const size = this.state.worldSize;
    this.canvas.width = size;
    this.canvas.height = size;
    const context = this.canvas.getContext('2d');
    if (context === null) throw new Error('Minimap: 無法建立 2D canvas context');
    this.context = context;
    this.drawAllTerrain();

    if (this.scene.textures.exists(this.textureKey)) this.scene.textures.remove(this.textureKey);
    const texture = this.scene.textures.addCanvas(this.textureKey, this.canvas);
    if (texture === null) throw new Error('Minimap: 無法建立 CanvasTexture');

    this.frame = this.scene.add.graphics().setScrollFactor(0).setDepth(this.depth);
    this.image = this.scene.add
      .image(0, 0, this.textureKey)
      .setOrigin(0, 0)
      .setScrollFactor(0)
      .setDepth(this.depth + 1);
    this.viewport = this.scene.add.graphics().setScrollFactor(0).setDepth(this.depth + 2);
    this.objects.push(this.frame, this.image, this.viewport);

    this.scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      if (this.scene.textures.exists(this.textureKey)) this.scene.textures.remove(this.textureKey);
    });
  }

  layout(width: number, height: number, topBarHeight: number, bottomBarHeight: number): void {
    const availableHeight = Math.max(MIN_DISPLAY_SIZE, height - topBarHeight - bottomBarHeight - EDGE_PADDING * 2);
    this.displaySize = Math.max(
      MIN_DISPLAY_SIZE,
      Math.min(MAX_DISPLAY_SIZE, width - EDGE_PADDING * 2, availableHeight),
    );
    this.left = Math.max(EDGE_PADDING, width - this.displaySize - EDGE_PADDING);
    this.top = topBarHeight + EDGE_PADDING;

    this.frame.clear();
    this.frame.fillStyle(0x0d1118, 0.88);
    this.frame.fillRect(this.left - 3, this.top - 3, this.displaySize + 6, this.displaySize + 6);
    this.frame.lineStyle(1, 0xe7ddc4, 0.9);
    this.frame.strokeRect(this.left - 2, this.top - 2, this.displaySize + 4, this.displaySize + 4);
    this.image.setPosition(this.left, this.top).setDisplaySize(this.displaySize, this.displaySize);
  }

  updateTerrain(tiles: readonly MinimapTile[]): void {
    if (tiles.length === 0) return;
    for (const tile of tiles) {
      if (tile.x < 0 || tile.y < 0 || tile.x >= this.state.worldSize || tile.y >= this.state.worldSize) continue;
      const [r, g, b] = this.colorAt(tile.x, tile.y);
      this.context.fillStyle = `rgb(${r}, ${g}, ${b})`;
      this.context.fillRect(tile.x, tile.y, 1, 1);
    }
    const texture = this.scene.textures.get(this.textureKey) as Phaser.Textures.CanvasTexture;
    texture.refresh();
  }

  updateViewport(camera: Phaser.Cameras.Scene2D.Camera): void {
    const view = camera.worldView;
    const corners = [
      screenToGrid(view.left, view.top - TILE_H / 2),
      screenToGrid(view.right, view.top - TILE_H / 2),
      screenToGrid(view.right, view.bottom - TILE_H / 2),
      screenToGrid(view.left, view.bottom - TILE_H / 2),
    ].map(({ gx, gy }) =>
      new Phaser.Geom.Point(
        this.left + (Phaser.Math.Clamp(gx, 0, this.state.worldSize) / this.state.worldSize) * this.displaySize,
        this.top + (Phaser.Math.Clamp(gy, 0, this.state.worldSize) / this.state.worldSize) * this.displaySize,
      ),
    );

    this.viewport.clear();
    this.viewport.fillStyle(0xffffff, 0.08);
    this.viewport.fillPoints(corners, true);
    this.viewport.lineStyle(1, 0xffffff, 0.95);
    this.viewport.strokePoints(corners, true);
  }

  get displayObjects(): Phaser.GameObjects.GameObject[] {
    return this.objects;
  }

  /** 一格在小地圖上的代表色：有路畫路色，否則畫地形色。 */
  private colorAt(x: number, y: number): readonly [number, number, number] {
    if (hasRoad(this.state, x, y)) return ROAD_COLOR;
    return TERRAIN_COLOR[terrainAt(this.state, x, y)];
  }

  private drawAllTerrain(): void {
    const size = this.state.worldSize;
    const image = this.context.createImageData(size, size);
    const data = image.data;
    let offset = 0;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const [r, g, b] = this.colorAt(x, y);
        data[offset] = r;
        data[offset + 1] = g;
        data[offset + 2] = b;
        data[offset + 3] = 255;
        offset += 4;
      }
    }
    this.context.putImageData(image, 0, 0);
  }
}
