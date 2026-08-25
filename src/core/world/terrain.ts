import type { TerrainEconomy } from '../../data/types';

// 地形核心：程序生成的島嶼地形。純函數、無狀態、決定論——地形不進存檔，
// 只有玩家改動過的格子以 GameState.terrainOverrides（稀疏 map）記錄。
// 因此任何 (seed, worldSize, x, y) 都能單獨算出結果，不需先算鄰居、不需預先建網格。

/** 六種地形。新增地形時同步更新 data\terrain.json 與 isWalkable/isBuildable。 */
export const TERRAIN_TYPES = ['water', 'sand', 'grass', 'forest', 'rock', 'mountain'] as const;

export type TerrainType = (typeof TERRAIN_TYPES)[number];

/** 地形演算法版本：baseTerrainAt 的生成公式/常數改變時必須遞增。
 *  存檔記錄產生當下的版本（GameState.terrainGeneratorVersion），deserialize 時
 *  若存檔版本大於此常數（代表存檔來自比目前程式更新的地形演算法）即拒收——
 *  避免舊程式用新演算法的存檔算出與存檔記錄不一致的地形。 */
export const TERRAIN_GENERATOR_VERSION = 1;

/** 玩家對單一格的改動（整地/資源耗竭）。兩個欄位皆可省略：
 *  省略 type 代表地形本身沒被改過，查詢時落回程序生成的 baseTerrainAt。 */
export interface TerrainOverride {
  type?: TerrainType;
  /** 該格剩餘的可採集資源量，非負有限數 */
  resource?: number;
  /** 該格資源耗盡的遊戲日，供森林再生判斷使用 */
  depletedDay?: number;
}

/** 未注入經濟設定時的預設值；正式資料由 data/terrain-economy.json 注入。 */
export const FOREST_WOOD_CAPACITY = 2400;
export const ROCK_STONE_CAPACITY = 4800;
export const DEFAULT_TERRAIN_ECONOMY: TerrainEconomy = {
  forestWoodCapacity: FOREST_WOOD_CAPACITY,
  rockStoneCapacity: ROCK_STONE_CAPACITY,
  forestRegrowDays: 5,
};

const IMPASSABLE: ReadonlySet<TerrainType> = new Set<TerrainType>(['water', 'mountain']);

export function isWalkable(type: TerrainType): boolean {
  return !IMPASSABLE.has(type);
}

/** W2 才會加上「各建築各自的地形需求」，目前建造條件與可通行條件相同。 */
export function isBuildable(type: TerrainType): boolean {
  return isWalkable(type);
}

/**
 * 決定性雜訊：murmur3 的 fmix32 finalizer，套用在 x/y/seed 以 Math.imul 加權合成的整數上。
 * 全程 32 位元整數運算，故大座標與負座標都不會有浮點精度問題。回傳 [0,1)。
 */
export function hashNoise(seed: number, x: number, y: number): number {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(seed, 1274126177)) | 0;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

// ── 生成器參數 ────────────────────────────────────────────────────────────
// 調參目標（皆為測試鎖定的性質，seed=1 / worldSize=200）：陸地佔比 20~70%、
// 至少四種地形、中心可達陸地佔全部陸地 ≥60%。連通率與「地形夠碎才有變化」互相拉扯，
// 故：(1) 用 smoothstep 內插的 value noise 而非白雜訊，讓島形連成塊；
//     (2) 只用 4 個八度、gain 0.5，高頻僅提供海岸線鋸齒，不足以把主島切碎；
//     (3) 最粗的一層在整張圖上只有 CONTINENT_OCTAVES_ACROSS 個晶格，
//         使主島尺度與世界尺度綁定（worldSize 改變時地形形狀等比縮放）。

/** 最粗一層雜訊在整張地圖上的晶格數：越小島越完整，越大越破碎 */
const CONTINENT_OCTAVES_ACROSS = 3.5;
/** fBm 八度數與每層衰減：4 層足夠有海岸細節，再多只會加碎片 */
const FBM_OCTAVES = 4;
const FBM_GAIN = 0.5;
/** 雜訊在高程中的權重；其餘由徑向圓頂項提供 */
const NOISE_WEIGHT = 0.55;
/** 徑向衰減次方：值越大則中央平原越廣、海岸線推得越外面（陸地變多） */
const FALLOFF_POWER = 2;
/** 海平面：低於此高程為水，決定陸地佔比。
 *  必須 < 1 - NOISE_WEIGHT，中心恆為陸地才是代數保證而非運氣（見 baseTerrainAt 註解）。 */
const SEA_LEVEL = 0.44;
/** 海平面之上這個帶寬內為沙灘（海岸線） */
const SAND_BAND = 0.05;
/** 高於此高程為山地。取 seed=1/size=200 全圖陸地高程的 p96（實測 0.8036，最高 0.8254），
 *  使山地約佔陸地 4%——有山可看、又不會把中央平原封成不可通行 */
const MOUNTAIN_LEVEL = 0.8;
/** 濕度雜訊的晶格數：比高程細，讓森林/草地/岩地在同一座島上交錯 */
const MOISTURE_OCTAVES_ACROSS = 9;
/** 濕度分界：低→岩地、中→草地、高→森林。取全圖陸地濕度的 p25/p75（實測 0.3685/0.5493），
 *  使三者約為 1:2:1——fbm 的值集中在中位數附近，用固定的 0.33/0.66 會讓岩地與森林過少 */
const ROCK_MOISTURE = 0.37;
const GRASS_MOISTURE = 0.55;

/** 各八度使用不同的雜訊場，避免各層完全重疊（互質常數，無特殊意義） */
const OCTAVE_SEED_STEP = 7919;
/** 濕度場相對高程場的 seed 位移，使兩場互不相關 */
const MOISTURE_SEED_OFFSET = 104729;

/** 以 smoothstep 內插的 value noise：讓相鄰格的值連續變化，地形才會連成塊而非白雜訊。 */
function valueNoise(seed: number, fx: number, fy: number): number {
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const tx = fx - x0;
  const ty = fy - y0;
  const sx = tx * tx * (3 - 2 * tx);
  const sy = ty * ty * (3 - 2 * ty);

  const n00 = hashNoise(seed, x0, y0);
  const n10 = hashNoise(seed, x0 + 1, y0);
  const n01 = hashNoise(seed, x0, y0 + 1);
  const n11 = hashNoise(seed, x0 + 1, y0 + 1);

  const top = n00 + (n10 - n00) * sx;
  const bottom = n01 + (n11 - n01) * sx;
  return top + (bottom - top) * sy;
}

/** 多層 value noise 疊加（fBm），回傳 [0,1)。cellsAcross 為最粗一層在整張圖上的晶格數。 */
function fbm(seed: number, x: number, y: number, worldSize: number, cellsAcross: number): number {
  let frequency = cellsAcross / worldSize;
  let amplitude = 1;
  let sum = 0;
  let total = 0;
  for (let octave = 0; octave < FBM_OCTAVES; octave++) {
    sum += amplitude * valueNoise((seed + octave * OCTAVE_SEED_STEP) | 0, x * frequency, y * frequency);
    total += amplitude;
    amplitude *= FBM_GAIN;
    frequency *= 2;
  }
  return sum / total;
}

/**
 * 連續高程值 ∈ 約 [0.11, 1)：徑向衰減的圓頂 ＋ fBm 雜訊。
 * baseTerrainAt 用它分類地形，elevationLevelAt 用它量化階梯高度——同一份數值，
 * 保證「山地一定比平原高、水面一定最低」不需要額外對齊。
 *
 * 呼叫端保證 x/y 為整數且在界內（本函數不重複驗證，是兩個公開函數的共用內核）。
 */
export function elevationValueAt(seed: number, worldSize: number, x: number, y: number): number {
  const half = worldSize / 2;
  const dx = (x + 0.5 - half) / half;
  const dy = (y + 0.5 - half) / half;
  const nd = Math.sqrt(dx * dx + dy * dy);
  const dome = 1 - Math.pow(nd, FALLOFF_POWER);
  return NOISE_WEIGHT * fbm(seed, x, y, worldSize, CONTINENT_OCTAVES_ACROSS) + (1 - NOISE_WEIGHT) * dome;
}

/**
 * 階梯高度分界（配合 SEA_LEVEL=0.44、SAND_BAND=0.05、MOUNTAIN_LEVEL=0.8）：
 * 0＝水面與沙灘（貼海平面）、1＝低地平原、2＝高地丘陵、3＝山地。
 * 0.64 是平原/丘陵的切分，取平地帶（0.49–0.8）的中點偏上，讓丘陵約佔陸地三分之一；
 * 它**刻意不對齊任何地形分類門檻**——同一種草地可以出現在平原也可以出現在丘陵，
 * 階地邊緣才會穿過草原形成有趣的地貌，而不是每種地形各據一階。
 */
const HILL_LEVEL = 0.64;

/**
 * 決定性的階梯高度 ∈ {0,1,2,3}，**純粹是視覺屬性**：只由 seed 推導、不吃
 * terrainOverrides——砍掉森林、採乾岩石都不會讓地面升降。
 * render 層據此把 tile 與其上的物件墊高（階高由 render 決定），core 玩法不讀它。
 */
export function elevationLevelAt(seed: number, worldSize: number, x: number, y: number): number {
  if (!Number.isInteger(x) || !Number.isInteger(y)) {
    throw new Error(`elevationLevelAt: x/y 必須是整數，收到 (${x}, ${y})`);
  }
  if (x < 0 || y < 0 || x >= worldSize || y >= worldSize) {
    return 0;
  }
  const elevation = elevationValueAt(seed, worldSize, x, y);
  if (elevation < SEA_LEVEL + SAND_BAND) return 0;
  if (elevation < HILL_LEVEL) return 1;
  if (elevation < MOUNTAIN_LEVEL) return 2;
  return 3;
}

/**
 * 程序生成的地形：徑向衰減的圓頂 + fBm 雜訊合成高程，再依高程與濕度分類。
 * 越界座標一律回 water（世界之外就是海）。
 *
 * 高程 = NOISE_WEIGHT * fbm + (1 - NOISE_WEIGHT) * (1 - nd^FALLOFF_POWER)，
 * nd 為以「半個世界」為單位的中心距。fbm ∈ [0,1)，故兩個硬性性質是代數保證而非運氣：
 *   - 中心 nd≈0 → 高程 ≥ (1 - NOISE_WEIGHT) = 0.45 > SEA_LEVEL(0.44)，恆為陸地；
 *   - 四角 nd≈1.41 → (1 - nd²) ≈ -0.98，高程 ≤ NOISE_WEIGHT - 0.45*0.98 ≈ 0.11 < SEA_LEVEL，恆為 water。
 */
export function baseTerrainAt(seed: number, worldSize: number, x: number, y: number): TerrainType {
  // 先驗整數再判界：小數座標永遠查不到 override 且會被 fbm 內插成鄰格之間的值，
  // 不是任何一格的真實地形——fail fast 而非悄悄回傳誤導性結果。
  if (!Number.isInteger(x) || !Number.isInteger(y)) {
    throw new Error(`baseTerrainAt: x/y 必須是整數，收到 (${x}, ${y})`);
  }
  if (x < 0 || y < 0 || x >= worldSize || y >= worldSize) {
    return 'water';
  }

  const elevation = elevationValueAt(seed, worldSize, x, y);

  if (elevation < SEA_LEVEL) {
    return 'water';
  }
  if (elevation < SEA_LEVEL + SAND_BAND) {
    return 'sand';
  }
  if (elevation >= MOUNTAIN_LEVEL) {
    return 'mountain';
  }

  const moisture = fbm((seed + MOISTURE_SEED_OFFSET) | 0, x, y, worldSize, MOISTURE_OCTAVES_ACROSS);
  if (moisture < ROCK_MOISTURE) {
    return 'rock';
  }
  if (moisture < GRASS_MOISTURE) {
    return 'grass';
  }
  return 'forest';
}

// terrainOverrides 的鍵來自存檔，可能出現與 Object.prototype 成員同名的損毀鍵
// （constructor、__proto__…）：一律以 own-property 語義查詢，比照 state.ts 的資源 helper。
function ownOverride(
  overrides: Record<string, TerrainOverride>,
  key: string,
): TerrainOverride | undefined {
  return Object.prototype.hasOwnProperty.call(overrides, key) ? overrides[key] : undefined;
}

/** 查詢單格地形：玩家改動過（override 有 type）以 override 為準，否則回程序生成結果。
 *  越界座標一律回 water（在 override 查詢之前判定——即使損毀存檔在越界鍵塞了 override 也不採信）。 */
export function terrainAt(
  state: { worldSeed: number; worldSize: number; terrainOverrides: Record<string, TerrainOverride> },
  x: number,
  y: number,
): TerrainType {
  // 先驗整數再判界，理由同 baseTerrainAt。
  if (!Number.isInteger(x) || !Number.isInteger(y)) {
    throw new Error(`terrainAt: x/y 必須是整數，收到 (${x}, ${y})`);
  }
  if (x < 0 || y < 0 || x >= state.worldSize || y >= state.worldSize) {
    return 'water';
  }
  const override = ownOverride(state.terrainOverrides, `${x},${y}`);
  if (override !== undefined && override.type !== undefined) {
    return override.type;
  }
  return baseTerrainAt(state.worldSeed, state.worldSize, x, y);
}

/** 尚未開採的單格地形資源容量。 */
export function terrainResourceCapacity(
  type: TerrainType,
  economy: TerrainEconomy = DEFAULT_TERRAIN_ECONOMY,
): number {
  if (type === 'forest') return economy.forestWoodCapacity;
  if (type === 'rock') return economy.rockStoneCapacity;
  return 0;
}

type TerrainState = {
  worldSeed: number;
  worldSize: number;
  terrainOverrides: Record<string, TerrainOverride>;
};

/** 查詢單格剩餘資源；override.resource 優先，否則視為該地形尚未開採、容量全滿。 */
export function getTerrainResource(
  state: TerrainState,
  x: number,
  y: number,
  economy: TerrainEconomy = DEFAULT_TERRAIN_ECONOMY,
): number {
  const override = ownOverride(state.terrainOverrides, `${x},${y}`);
  if (override?.resource !== undefined) {
    return override.resource;
  }
  return terrainResourceCapacity(terrainAt(state, x, y), economy);
}

/** 扣除單格地形資源並回傳實際扣除量；耗盡時地形翻為 grass，耗盡日由呼叫端填入。 */
export function consumeTerrainResource(
  state: TerrainState,
  x: number,
  y: number,
  amount: number,
  economy: TerrainEconomy = DEFAULT_TERRAIN_ECONOMY,
): number {
  if (!Number.isFinite(amount) || amount < 0) {
    throw new Error(`consumeTerrainResource: amount 必須是有限非負數，收到 ${amount}`);
  }
  if (amount === 0) return 0;

  const available = getTerrainResource(state, x, y, economy);
  if (available <= 0) return 0;

  const consumed = Math.min(available, amount);
  const remaining = available - consumed;
  const key = `${x},${y}`;
  const previous = ownOverride(state.terrainOverrides, key);
  state.terrainOverrides[key] = {
    ...previous,
    ...(remaining === 0 ? { type: 'grass' as const } : {}),
    resource: remaining,
  };
  return consumed;
}
