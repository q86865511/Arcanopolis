// 2D 地形重塑 spike：向量多邊形地形——擺脫菱形格子感。
//
// 使用者裁決（2026-08-25）：留在 2D，但地形要重塑——輪廓要圓弧/多邊形的有機曲線、
// 保留連續高低漸層、風格與建築統一。本 spike 驗證這條渲染路線：
// 1. marching squares 從地形分類場抽出每類地形的輪廓（不再逐格貼菱形 tile）；
// 2. Chaikin 平滑兩輪 → 輪廓變圓弧；
// 3. 頂點投影時以連續高程位移 y（2.5D）→ 高低漸層不是階梯；
// 4. 坡向光照（高程梯度）→ 地形有立體明暗；
// 5. 疊上現有的建築像素 sprite 看風格融合度。
//
// 產品化時同樣的幾何可進 Phaser（Graphics→RenderTexture 分塊），本 spike 用
// Canvas2D 是為了最快看到畫面。

import { createDemoWorld } from '../src/render/demoWorld';
import { baseTerrainAt, elevationValueAt, type TerrainType } from '../src/core/world/terrain';

const SEA_LEVEL = 0.44;
/** 高程 → 像素的垂直位移：漸層感的來源（連續，不量化）。 */
const HEIGHT_PX = 110;
/** 山地帶指數拉抬（同 3D spike 的教訓：實測最高高程僅 0.8254，係數要大才有山）。 */
const MOUNTAIN_BOOST_FROM = 0.72;
const MOUNTAIN_BOOST_PX = 2600;

const TILE_W = 64;
const TILE_H = 32;

/** 分層畫序：後層蓋前層。v4 改暖調——中世紀城鄉的橄欖綠與土色，不是桌遊的鮮綠。 */
const LAYERS: { type: TerrainType; fill: string; edge: string }[] = [
  { type: 'sand', fill: '#d3b070', edge: '#ab8a4e' },
  { type: 'grass', fill: '#8a9e4d', edge: '#6d8140' },
  { type: 'rock', fill: '#98948c', edge: '#736f68' },
  { type: 'forest', fill: '#4d6e35', edge: '#3a5429' },
  { type: 'mountain', fill: '#c2bfb6', edge: '#8d897f' },
];

const world = createDemoWorld();
const { state } = world;
const size = state.worldSize;
const seed = state.worldSeed;

function elevAt(x: number, y: number): number {
  const cx = Math.min(Math.max(Math.round(x), 0), size - 1);
  const cy = Math.min(Math.max(Math.round(y), 0), size - 1);
  return elevationValueAt(seed, size, cx, cy);
}

/** 雙線性插值的連續高程（marching squares 的頂點落在格邊分數座標上）。 */
function elevSmooth(fx: number, fy: number): number {
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const tx = fx - x0;
  const ty = fy - y0;
  const e00 = elevAt(x0, y0);
  const e10 = elevAt(x0 + 1, y0);
  const e01 = elevAt(x0, y0 + 1);
  const e11 = elevAt(x0 + 1, y0 + 1);
  return (e00 * (1 - tx) + e10 * tx) * (1 - ty) + (e01 * (1 - tx) + e11 * tx) * ty;
}

function heightPx(e: number): number {
  const base = (Math.max(e, SEA_LEVEL) - SEA_LEVEL) * HEIGHT_PX;
  const over = Math.max(0, e - MOUNTAIN_BOOST_FROM);
  return base + over * over * MOUNTAIN_BOOST_PX;
}

/** 格座標 → 畫布座標（等距投影 ＋ 連續高程位移）。 */
function project(fx: number, fy: number): [number, number] {
  const sx = ((fx - fy) * TILE_W) / 2;
  const sy = ((fx + fy) * TILE_H) / 2 - heightPx(elevSmooth(fx, fy));
  return [sx, sy];
}

// ── marching squares：對「該格是否屬於某類別集合」的 0/1 場抽輪廓 ────────────
type Loop = [number, number][];

function marchingSquares(inside: (x: number, y: number) => boolean): Loop[] {
  // 邊字典：以「邊中點」為節點串線段成 loop
  const segments: [string, string, [number, number], [number, number]][] = [];
  const key = (p: [number, number]) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`;
  for (let y = -1; y < size; y++) {
    for (let x = -1; x < size; x++) {
      const a = inside(x, y) ? 1 : 0;
      const b = inside(x + 1, y) ? 1 : 0;
      const c = inside(x + 1, y + 1) ? 1 : 0;
      const d = inside(x, y + 1) ? 1 : 0;
      const idx = a * 8 + b * 4 + c * 2 + d;
      if (idx === 0 || idx === 15) continue;
      const top: [number, number] = [x + 0.5, y];
      const right: [number, number] = [x + 1, y + 0.5];
      const bottom: [number, number] = [x + 0.5, y + 1];
      const left: [number, number] = [x, y + 0.5];
      // 每 case 輸出的線段方向讓 inside 在左側（形成一致繞向）
      const table: Record<number, [[number, number], [number, number]][]> = {
        1: [[left, bottom]],
        2: [[bottom, right]],
        3: [[left, right]],
        4: [[right, top]],
        5: [[left, top], [right, bottom]],
        6: [[bottom, top]],
        7: [[left, top]],
        8: [[top, left]],
        9: [[top, bottom]],
        10: [[top, right], [bottom, left]],
        11: [[top, right]],
        12: [[right, left]],
        13: [[right, bottom]],
        14: [[bottom, left]],
      };
      for (const [p, q] of table[idx]) segments.push([key(p), key(q), p, q]);
    }
  }
  // 串線段成封閉 loop
  const byStart = new Map<string, [string, string, [number, number], [number, number]][]>();
  for (const s of segments) {
    const list = byStart.get(s[0]) ?? [];
    list.push(s);
    byStart.set(s[0], list);
  }
  const used = new Set<(typeof segments)[number]>();
  const loops: Loop[] = [];
  for (const seg of segments) {
    if (used.has(seg)) continue;
    const loop: Loop = [seg[2]];
    let current = seg;
    used.add(current);
    for (let guard = 0; guard < segments.length + 1; guard++) {
      const nextList = byStart.get(current[1]);
      const next = nextList?.find((s) => !used.has(s));
      if (next === undefined) break;
      loop.push(next[2]);
      used.add(next);
      current = next;
      if (current[1] === seg[0]) break;
    }
    if (loop.length >= 3) loops.push(loop);
  }
  return loops;
}

/** Chaikin 角切平滑：一輪把每個角換成 1/4 與 3/4 點，兩輪已近圓弧。 */
function chaikin(loop: Loop, rounds: number): Loop {
  let points = loop;
  for (let r = 0; r < rounds; r++) {
    const next: Loop = [];
    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      const q = points[(i + 1) % points.length];
      next.push([p[0] * 0.75 + q[0] * 0.25, p[1] * 0.75 + q[1] * 0.25]);
      next.push([p[0] * 0.25 + q[0] * 0.75, p[1] * 0.25 + q[1] * 0.75]);
    }
    points = next;
  }
  return points;
}

// ── 繪製 ──────────────────────────────────────────────────────────────
const params = new URLSearchParams(window.location.search);
const centerX = Number(params.get('cx') ?? Math.round(world.startCenter.x));
const centerY = Number(params.get('cy') ?? Math.round(world.startCenter.y));
const scale = Number(params.get('scale') ?? '1');

const canvas = document.createElement('canvas');
canvas.width = window.innerWidth;
canvas.height = window.innerHeight;
document.body.style.margin = '0';
document.body.appendChild(canvas);
const ctx = canvas.getContext('2d')!;
ctx.imageSmoothingEnabled = false;

const [ccx, ccy] = project(centerX, centerY);
const offsetX = canvas.width / 2 - ccx * scale;
const offsetY = canvas.height / 2 - ccy * scale;

function toScreen(fx: number, fy: number): [number, number] {
  const [sx, sy] = project(fx, fy);
  return [sx * scale + offsetX, sy * scale + offsetY];
}

// 海底色打底
ctx.fillStyle = '#2d6a94';
ctx.fillRect(0, 0, canvas.width, canvas.height);

// 陸地各層：marching squares → Chaikin → 投影填色。
// 「層」的成員定義成「這一類與畫序在它之後的所有類」——layer union 保證上層永遠
// 站在下層之内，邊界曲線彼此巢狀不交錯。
const typeAt = (x: number, y: number): TerrainType => baseTerrainAt(seed, size, Math.min(Math.max(x, 0), size - 1), Math.min(Math.max(y, 0), size - 1));
const landTypes: TerrainType[][] = [
  ['sand', 'grass', 'rock', 'forest', 'mountain'],
  ['grass', 'rock', 'forest', 'mountain'],
  ['rock', 'mountain'],
  ['forest'],
  ['mountain'],
];
for (let layer = 0; layer < LAYERS.length; layer++) {
  const members = new Set(landTypes[layer]);
  const inBounds = (x: number, y: number) => x >= 0 && y >= 0 && x < size && y < size;
  const loops = marchingSquares((x, y) => inBounds(x, y) && members.has(typeAt(x, y)));
  ctx.fillStyle = LAYERS[layer].fill;
  ctx.strokeStyle = LAYERS[layer].edge;
  ctx.lineWidth = 2.5 * scale;
  // 兩遍：先畫下移的暗色複本當「地形厚度」陰影（手繪地圖的立面感），再畫本體。
  const paths: Path2D[] = [];
  for (const loop of loops) {
    const smooth = chaikin(loop, 2);
    const path = new Path2D();
    for (let i = 0; i < smooth.length; i++) {
      const [px, py] = toScreen(smooth[i][0], smooth[i][1]);
      if (i === 0) path.moveTo(px, py);
      else path.lineTo(px, py);
    }
    path.closePath();
    paths.push(path);
  }
  if (layer >= 1) {
    ctx.save();
    ctx.translate(0, 7 * scale);
    ctx.fillStyle = 'rgba(20,24,40,0.30)';
    for (const path of paths) ctx.fill(path);
    ctx.restore();
  }
  ctx.fillStyle = LAYERS[layer].fill;
  for (const path of paths) {
    ctx.fill(path);
    ctx.stroke(path);
  }
}

// 坡向光照：在「格空間」畫一張 size×size 的離屏光照圖（每格一像素），
// 再用等距仿射變換整張貼上——瀏覽器的雙線性放大讓光照連續平滑。
// 第一版用逐格橢圓筆刷，半透明圓斑互相疊出明顯的點狀花紋；光照必須是連續場。
// （貼圖忽略高度位移——光照本來就柔，仿射近似的誤差看不出來。）
{
  const lightCanvas = document.createElement('canvas');
  lightCanvas.width = size;
  lightCanvas.height = size;
  const lctx = lightCanvas.getContext('2d')!;
  const img = lctx.createImageData(size, size);
  for (let gy = 0; gy < size; gy++) {
    for (let gx = 0; gx < size; gx++) {
      const i = (gy * size + gx) * 4;
      const e = elevAt(gx, gy);
      if (e < SEA_LEVEL) continue; // 海面不打光（保持透明）
      const dx = heightPx(elevAt(Math.min(gx + 1, size - 1), gy)) - heightPx(elevAt(Math.max(gx - 1, 0), gy));
      const dy = heightPx(elevAt(gx, Math.min(gy + 1, size - 1))) - heightPx(elevAt(gx, Math.max(gy - 1, 0)));
      const lit = (dx + dy) / 8; // 光自左上：往右下降的坡受光（增益校準：平地梯度僅 ~1px/格）
      const alpha = Math.min(110, Math.abs(lit) * 60);
      if (lit > 0) {
        img.data[i] = 255; img.data[i + 1] = 244; img.data[i + 2] = 214;
      } else {
        img.data[i] = 20; img.data[i + 1] = 24; img.data[i + 2] = 40;
      }
      img.data[i + 3] = alpha;
    }
  }
  lctx.putImageData(img, 0, 0);
  ctx.save();
  ctx.imageSmoothingEnabled = true; // 光照圖要平滑放大，與像素素材相反
  // 等距仿射：格 (fx,fy) → 螢幕 ((fx-fy)*32, (fx+fy)*16)，含全域縮放與平移
  ctx.setTransform(
    (TILE_W / 2) * scale, (TILE_H / 2) * scale,
    -(TILE_W / 2) * scale, (TILE_H / 2) * scale,
    offsetX, offsetY,
  );
  ctx.drawImage(lightCanvas, 0, 0);
  ctx.restore();
  ctx.imageSmoothingEnabled = false;
}

// ── 中世紀城鄉元素（v4）────────────────────────────────────────────────
function hashXY(x: number, y: number): number {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263)) | 0;
  h = ((h ^ (h >>> 15)) >>> 0) / 4294967296;
  return h;
}

/** 畫一個對齊格子的菱形（田塊/格線都用它）。 */
function cellPath(gx: number, gy: number): Path2D {
  const path = new Path2D();
  const corners: [number, number][] = [[gx, gy], [gx + 1, gy], [gx + 1, gy + 1], [gx, gy + 1]];
  corners.forEach(([fx, fy], i) => {
    const [px, py] = toScreen(fx, fy);
    if (i === 0) path.moveTo(px, py);
    else path.lineTo(px, py);
  });
  path.closePath();
  return path;
}

// 田野拼布：村莊外圍的環帶上，格狀田塊兩色交錯——中世紀城鄉的「格」
// 本來就以田地的形式存在，這是「保留格子要素」最自然的方式。
const FIELD_COLORS = ['#c2a355', '#a58a49', '#b5975c', '#8f9b52'];
for (let dy = -9; dy <= 9; dy++) {
  for (let dx = -9; dx <= 9; dx++) {
    const gx = centerX + dx;
    const gy = centerY + dy;
    const dist = Math.hypot(dx, dy);
    if (dist < 3.5 || dist > 9) continue;
    if (typeAt(gx, gy) !== 'grass') continue;
    if (hashXY(gx * 5 + 3, gy * 7 + 1) > 0.4) continue;
    const path = cellPath(gx, gy);
    ctx.fillStyle = FIELD_COLORS[Math.floor(hashXY(gx, gy) * FIELD_COLORS.length)];
    ctx.fill(path);
    ctx.strokeStyle = 'rgba(90,70,40,0.55)';
    ctx.lineWidth = 1.5 * scale;
    ctx.stroke(path);
  }
}

// 建造格線：村莊核心區淡淡的等距格——遊戲的放置對位要素在畫面上保留
ctx.strokeStyle = 'rgba(60,50,30,0.10)';
ctx.lineWidth = 1;
for (let dy = -4; dy <= 4; dy++) {
  for (let dx = -4; dx <= 4; dx++) {
    if (typeAt(centerX + dx, centerY + dy) !== 'grass') continue;
    ctx.stroke(cellPath(centerX + dx, centerY + dy));
  }
}

// 建築選址：核心區決定論散佈，彼此不相鄰（上一版擠成一團）
const SPRITES = ['house-01', 'house-02', 'mill-01', 'bakery-01', 'house-03', 'blacksmith-01', 'tavern-01'];
const buildingSpots: [number, number, string][] = [];
{
  const taken = new Set<string>();
  let i = 0;
  for (let dy = -4; dy <= 4 && buildingSpots.length < 9; dy++) {
    for (let dx = -4; dx <= 4 && buildingSpots.length < 9; dx++) {
      const gx = centerX + dx;
      const gy = centerY + dy;
      if (typeAt(gx, gy) !== 'grass') continue;
      if (hashXY(gx, gy) > 0.3) continue;
      // 建築 sprite 寬 2 格，間距要到曼哈頓半徑 2 視覺上才不會貼在一起
      let free = true;
      for (let oy = -2; oy <= 2 && free; oy++) {
        for (let ox = -2; ox <= 2 && free; ox++) {
          if (taken.has(`${gx + ox},${gy + oy}`)) free = false;
        }
      }
      if (!free) continue;
      taken.add(`${gx},${gy}`);
      buildingSpots.push([gx, gy, SPRITES[i % SPRITES.length]]);
      i++;
    }
  }
}

// 泥土路：村中心廣場向每棟建築的土色路徑——城鄉感的動線
{
  const [cx, cy] = toScreen(centerX, centerY);
  ctx.strokeStyle = '#93744a';
  ctx.lineCap = 'round';
  ctx.lineWidth = 11 * scale;
  for (const [gx, gy] of buildingSpots) {
    const [bx, by] = toScreen(gx + 0.5, gy + 1);
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    // 微彎的二次曲線比直線自然
    ctx.quadraticCurveTo((cx + bx) / 2 + 12, (cy + by) / 2 - 8, bx, by);
    ctx.stroke();
  }
  // 廣場
  ctx.fillStyle = '#ab8c5e';
  ctx.beginPath();
  ctx.ellipse(cx, cy, 26 * scale, 14 * scale, 0, 0, Math.PI * 2);
  ctx.fill();
}

// 城寨：村莊東北的高地上，用現有的 wall-01/watchtower-01 素材組一座小城堡
const castleSpots: [number, number, string][] = [];
{
  // 固定在村莊東北的空地（動態搜尋會掉進森林區找不到落點，spike 不值得為此糾結）
  const best: [number, number] = [centerX + 7, centerY - 5];
  {
    const [bx, by] = best;
    // 城丘底座：先畫一座灰色高台，城牆與角樓站在上面才有「堡」的氣勢
    const [hx, hy] = toScreen(bx + 0.5, by + 0.5);
    ctx.fillStyle = '#9a968c';
    ctx.strokeStyle = '#736f68';
    ctx.lineWidth = 2.5 * scale;
    ctx.beginPath();
    ctx.ellipse(hx, hy, 120 * scale, 66 * scale, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    // 角樓四座＋城牆段圍出方寨，中央主樓
    castleSpots.push(
      [bx - 1, by - 1, 'watchtower-01'],
      [bx + 1, by - 1, 'watchtower-01'],
      [bx, by - 1, 'wall-01'],
      [bx - 1, by, 'wall-01'],
      [bx + 1, by, 'wall-01'],
      [bx - 1, by + 1, 'watchtower-01'],
      [bx + 1, by + 1, 'watchtower-01'],
      [bx, by + 1, 'wall-01'],
      [bx, by, 'tavern-01'],
    );
  }
}

// 疊 sprite：先遠後近（畫面 y 序）確保遮擋正確；城堡與村莊建築一起排序
const allSprites = [...buildingSpots, ...castleSpots].sort((a, b) => a[0] + a[1] - (b[0] + b[1]));
let pending = allSprites.length;
if (pending === 0) done();
const cache = new Map<string, HTMLImageElement>();
function drawSprite(gx: number, gy: number, img: HTMLImageElement): void {
  const [px, py] = toScreen(gx + 0.5, gy);
  const w = img.width * 2 * scale;
  const h = img.height * 2 * scale;
  ctx.drawImage(img, px - w / 2, py + (TILE_H / 2) * scale - h, w, h);
}
(async () => {
  for (const [gx, gy, name] of allSprites) {
    let img = cache.get(name);
    if (img === undefined) {
      img = new Image();
      img.src = new URL(`../assets/game/${name}.png`, import.meta.url).href;
      await new Promise((resolve) => {
        img!.onload = resolve;
        img!.onerror = resolve;
      });
      cache.set(name, img);
    }
    if (img.width > 0) drawSprite(gx, gy, img);
    pending--;
  }
  done();
})();

function done(): void {
  (window as unknown as Record<string, unknown>).__spikeReady = true;
}
