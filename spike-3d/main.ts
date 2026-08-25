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
/** 山地帶（>0.72）的額外指數拉抬：Anno 的山是美術誇張的，線性高程下山區只是緩丘。 */
const MOUNTAIN_BOOST_FROM = 0.72;
const MOUNTAIN_BOOST = 1300; // 實測全圖最高 elevation 僅 0.8254，超出量 ~0.105，平方後要這個量級才抬得出 +14 單位的山

const TERRAIN_COLOR: Record<TerrainType, number> = {
  water: 0x2d6a94, // 海底色（水面另有半透明平面）
  sand: 0xd9b678,
  grass: 0x6fae4e,
  forest: 0x3e7a3a,
  rock: 0x8d9096,
  mountain: 0xb8bcc2,
};

const world = createDemoWorld();
const { state } = world;
const size = state.worldSize;
const seed = state.worldSeed;

function heightAt(x: number, y: number): number {
  const cx = Math.min(Math.max(x, 0), size - 1);
  const cy = Math.min(Math.max(y, 0), size - 1);
  const e = elevationValueAt(seed, size, cx, cy);
  // 海面下壓平成淺海底：spike 不需要海溝，讓海岸線出現平緩的入水坡即可
  const base = (Math.max(e, SEA_LEVEL - 0.03) - SEA_LEVEL) * HEIGHT_SCALE;
  // 山地帶指數拉抬：平原/丘陵維持緩起伏，山區陡然聳起（二次曲線在銜接處斜率連續為零，不會有折角）
  const over = Math.max(0, e - MOUNTAIN_BOOST_FROM);
  return base + over * over * MOUNTAIN_BOOST;
}

// ── 場景 ──────────────────────────────────────────────────────────────
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1a2130);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
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
terrain.receiveShadow = true;
terrain.castShadow = true; // 山體要能把影子投在自己的背光坡上
scene.add(terrain);

// 水面：海平面高度的半透明平面
const water = new THREE.Mesh(
  new THREE.PlaneGeometry(size * 1.4, size * 1.4),
  new THREE.MeshLambertMaterial({ color: 0x3f86c0, transparent: true, opacity: 0.82 }),
);
water.rotation.x = -Math.PI / 2;
water.position.y = 0.05;
scene.add(water);

// 建築：程序化的中世紀小屋（白牆＋木樑＋雙坡屋頂＋煙囪）。
// 正式版會換 KayKit/Quaternius 的 GLB 模型；spike 用組合幾何證明「風格可控」——
// lowpoly 半木屋本來就是簡單幾何的組合。
const wallMat = new THREE.MeshLambertMaterial({ color: 0xe9dfc8 });
const beamMat = new THREE.MeshLambertMaterial({ color: 0x5b4030 });
const ROOF_COLORS = [0xac3232, 0xc8a24a, 0x6f7480]; // 陶紅/茅草/石板，呼應 2D 的三種 house
const chimneyMat = new THREE.MeshLambertMaterial({ color: 0x8f8a84 });

/** 雙坡屋頂：三角柱 BufferGeometry（w=橫向寬、d=進深、h=脊高）。 */
function gableRoof(w: number, d: number, h: number, color: number): THREE.Mesh {
  const hw = w / 2;
  const hd = d / 2;
  // 兩個山牆三角 + 兩片坡面
  const vertices = new Float32Array([
    // 坡面（左）
    -hw, 0, -hd, 0, h, -hd, 0, h, hd,
    -hw, 0, -hd, 0, h, hd, -hw, 0, hd,
    // 坡面（右）
    hw, 0, -hd, 0, h, hd, 0, h, -hd,
    hw, 0, -hd, hw, 0, hd, 0, h, hd,
    // 山牆前後
    -hw, 0, hd, 0, h, hd, hw, 0, hd,
    -hw, 0, -hd, hw, 0, -hd, 0, h, -hd,
  ]);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
  geo.computeVertexNormals();
  return new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color }));
}

function addHouse(gx: number, gy: number, variant: number): void {
  const wx = gx - size / 2;
  const wz = gy - size / 2;
  const base = heightAt(gx, gy);
  const group = new THREE.Group();

  const body = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.7, 0.65), wallMat);
  body.position.y = 0.35;
  body.castShadow = true;
  group.add(body);

  // 半木結構的木樑：四角立柱＋一道橫樑，遠景讀得出「深色線條切割白牆」就夠
  for (const [bx, bz] of [[-0.38, -0.28], [0.38, -0.28], [-0.38, 0.28], [0.38, 0.28]] as const) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.7, 0.08), beamMat);
    post.position.set(bx, 0.35, bz);
    group.add(post);
  }
  const lintel = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.07, 0.7), beamMat);
  lintel.position.y = 0.66;
  group.add(lintel);

  const roof = gableRoof(1.0, 0.8, 0.45, ROOF_COLORS[variant % ROOF_COLORS.length]);
  roof.position.y = 0.7;
  roof.castShadow = true;
  group.add(roof);

  const chimney = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.35, 0.12), chimneyMat);
  chimney.position.set(0.22, 0.95, -0.12);
  group.add(chimney);

  group.position.set(wx, base, wz);
  // 朝向依格座標決定性微轉，整排房子不會像閱兵
  group.rotation.y = (hash2(gx, gy) - 0.5) * 0.5;
  scene.add(group);
}

for (const building of state.buildings) {
  addHouse(building.x, building.y, (building.x * 7 + building.y * 13) % 3);
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
    // 兩種樹型混生：針葉錐與闊葉團（低面數二十面體），森林才不是一片複製的三角形
    const broadleaf = hash2(gx + 11, gy) < 0.4;
    const crown = broadleaf
      ? new THREE.Mesh(new THREE.IcosahedronGeometry(0.5 * s, 0), crownMat)
      : new THREE.Mesh(new THREE.ConeGeometry(0.45 * s, 1.1 * s, 6), crownMat);
    crown.position.set(wx, base + (broadleaf ? 0.85 : 1.0) * s, wz);
    crown.castShadow = true;
    scene.add(crown);
  }
}

// 光：方向光自左上（沿用 art-bible 的光源方向慣例）＋ 環境光；投影涵蓋全島
const sun = new THREE.DirectionalLight(0xfff4e0, 1.6);
sun.position.set(-90, 110, -55);
sun.castShadow = true;
sun.shadow.mapSize.set(4096, 4096);
sun.shadow.camera.left = -150;
sun.shadow.camera.right = 150;
sun.shadow.camera.top = 150;
sun.shadow.camera.bottom = -150;
sun.shadow.camera.far = 500;
sun.shadow.bias = -0.0005;
scene.add(sun);
scene.add(new THREE.AmbientLight(0x8899bb, 0.9));

// 等距視角的正交相機；?view= 切換全島/山區近景/村莊近景
const view = new URLSearchParams(window.location.search).get('view') ?? 'island';
const aspect = window.innerWidth / window.innerHeight;
const zoom = view === 'island' ? 65 : view === 'mountain' ? 28 : 14;
const camera = new THREE.OrthographicCamera(-zoom * aspect, zoom * aspect, zoom, -zoom, 1, 1000);
const target =
  view === 'mountain'
    ? new THREE.Vector3(112 - size / 2, 10, 98 - size / 2)
    : view === 'town'
      ? new THREE.Vector3(
          world.startCenter.x - size / 2,
          heightAt(world.startCenter.x, world.startCenter.y),
          world.startCenter.y - size / 2,
        )
      : new THREE.Vector3(0, 0, 0);
camera.position.set(target.x + 60, target.y + 55, target.z + 60);
camera.lookAt(target);

renderer.render(scene, camera);
// 給截圖工具一個穩定的完成訊號
(window as unknown as Record<string, unknown>).__spikeReady = true;
