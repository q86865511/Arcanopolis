// 3D 路線可行性 spike：用「同一份 core 資料」渲染有真實坡度的島嶼。
//
// 目的：給美術方向裁決當證據，不是產品程式碼。它證明三件事——
// 1. src/core 零改動可直接餵 3D 渲染（純 TS、零 Phaser 依賴的架構鐵則兌現）；
// 2. elevationValueAt 的連續高程直接就是地形 mesh 的高度場，山有坡面、海岸有緩坡；
// 3. 建築/樹木是站在坡地上的 3D 物件，會被地形起伏遮擋。
//
// URL 參數 ?view=island（全島）| mountain（山區近景）。

import * as THREE from 'three';
import { createDemoWorld } from '../src/render/demoWorld';
import { baseTerrainAt, elevationValueAt, type TerrainType } from '../src/core/world/terrain';

const SEA_LEVEL = 0.44;
/** 高程 → 世界單位的放大係數：山頂（~1.0）比海平面高約 22 格，近 Anno 的山體量感。 */
const HEIGHT_SCALE = 40;

const TERRAIN_COLOR: Record<TerrainType, number> = {
  water: 0x2d6a94, // 海底色（水面另有半透明平面）
  sand: 0xd9b678,
  grass: 0x6fae4e,
  forest: 0x3e7a3a,
  rock: 0x8d9096,
  mountain: 0xb8bcc2,
};

const { state } = createDemoWorld();
const size = state.worldSize;
const seed = state.worldSeed;

function heightAt(x: number, y: number): number {
  const cx = Math.min(Math.max(x, 0), size - 1);
  const cy = Math.min(Math.max(y, 0), size - 1);
  const e = elevationValueAt(seed, size, cx, cy);
  // 海面下壓平成淺海底：spike 不需要海溝，讓海岸線出現平緩的入水坡即可
  return (Math.max(e, SEA_LEVEL - 0.03) - SEA_LEVEL) * HEIGHT_SCALE;
}

// ── 場景 ──────────────────────────────────────────────────────────────
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1a2130);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.style.margin = '0';
document.body.appendChild(renderer.domElement);

// 地形：每格一個頂點的 heightmap mesh，頂點色依地形分類
const geometry = new THREE.PlaneGeometry(size, size, size - 1, size - 1);
geometry.rotateX(-Math.PI / 2); // plane 預設立在 XY，轉成 XZ 地面、Y 朝上
const positions = geometry.attributes.position;
const colors = new Float32Array(positions.count * 3);
const color = new THREE.Color();
for (let i = 0; i < positions.count; i++) {
  const gx = Math.round(positions.getX(i) + size / 2);
  const gy = Math.round(positions.getZ(i) + size / 2);
  positions.setY(i, heightAt(gx, gy));
  const type = baseTerrainAt(seed, size, Math.min(gx, size - 1), Math.min(gy, size - 1));
  color.setHex(TERRAIN_COLOR[type]);
  colors[i * 3] = color.r;
  colors[i * 3 + 1] = color.g;
  colors[i * 3 + 2] = color.b;
}
geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
geometry.computeVertexNormals();
const terrain = new THREE.Mesh(
  geometry,
  new THREE.MeshLambertMaterial({ vertexColors: true }),
);
scene.add(terrain);

// 水面：海平面高度的半透明平面
const water = new THREE.Mesh(
  new THREE.PlaneGeometry(size * 1.4, size * 1.4),
  new THREE.MeshLambertMaterial({ color: 0x3f86c0, transparent: true, opacity: 0.82 }),
);
water.rotation.x = -Math.PI / 2;
water.position.y = 0.05;
scene.add(water);

// 建築：core 的 state.buildings 直接放 box + 屋頂（示意，正式版換 KayKit GLB 模型）
const wallMat = new THREE.MeshLambertMaterial({ color: 0xe8dcc0 });
const roofMat = new THREE.MeshLambertMaterial({ color: 0xac3232 });
for (const building of state.buildings) {
  const wx = building.x - size / 2;
  const wz = building.y - size / 2;
  const base = heightAt(building.x, building.y);
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.0, 0.9), wallMat);
  body.position.set(wx, base + 0.5, wz);
  scene.add(body);
  const roof = new THREE.Mesh(new THREE.ConeGeometry(0.75, 0.7, 4), roofMat);
  roof.rotation.y = Math.PI / 4;
  roof.position.set(wx, base + 1.35, wz);
  scene.add(roof);
}

// 樹：森林格抽樣放 lowpoly 樹（決定論 hash，非 Math.random——沿用專案的決定論紀律）
const trunkMat = new THREE.MeshLambertMaterial({ color: 0x6b4a2f });
const crownMat = new THREE.MeshLambertMaterial({ color: 0x2e6b2e });
function hash2(x: number, y: number): number {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  return ((h ^ (h >>> 13)) >>> 0) / 4294967296;
}
for (let gy = 0; gy < size; gy += 1) {
  for (let gx = 0; gx < size; gx += 1) {
    if (baseTerrainAt(seed, size, gx, gy) !== 'forest') continue;
    if (hash2(gx, gy) > 0.22) continue;
    const base = heightAt(gx, gy);
    const wx = gx - size / 2 + (hash2(gx + 7, gy) - 0.5) * 0.6;
    const wz = gy - size / 2 + (hash2(gx, gy + 7) - 0.5) * 0.6;
    const s = 0.8 + hash2(gx + 3, gy + 3) * 0.6;
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.08 * s, 0.1 * s, 0.5 * s), trunkMat);
    trunk.position.set(wx, base + 0.25 * s, wz);
    scene.add(trunk);
    const crown = new THREE.Mesh(new THREE.ConeGeometry(0.45 * s, 1.1 * s, 6), crownMat);
    crown.position.set(wx, base + 1.0 * s, wz);
    scene.add(crown);
  }
}

// 光：方向光自左上（沿用 art-bible 的光源方向慣例）＋ 環境光
const sun = new THREE.DirectionalLight(0xfff4e0, 1.6);
sun.position.set(-1, 1.2, -0.6);
scene.add(sun);
scene.add(new THREE.AmbientLight(0x8899bb, 0.9));

// 等距視角的正交相機；?view= 切換全島/山區近景
const view = new URLSearchParams(window.location.search).get('view') ?? 'island';
const aspect = window.innerWidth / window.innerHeight;
const zoom = view === 'mountain' ? 24 : 65;
const camera = new THREE.OrthographicCamera(-zoom * aspect, zoom * aspect, zoom, -zoom, 1, 1000);
const target =
  view === 'mountain'
    ? new THREE.Vector3(112 - size / 2, 8, 98 - size / 2)
    : new THREE.Vector3(0, 0, 0);
camera.position.set(target.x + 60, target.y + 55, target.z + 60);
camera.lookAt(target);

renderer.render(scene, camera);
// 給截圖工具一個穩定的完成訊號
(window as unknown as Record<string, unknown>).__spikeReady = true;
