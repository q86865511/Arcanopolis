// 存檔序列化與遷移。GameState 為純資料，序列化即 JSON；還原時逐欄驗證，
// 版本不符時先跑 migrations 補到 SAVE_SCHEMA_VERSION 再驗證欄位內容。
//
// v6（M6-W1，roads 進 schema）起 SAVE_MIGRATIONS 清空：v1–v5 的存檔一律作廢，
// 載入時丟 OutdatedSaveError 讓呼叫端開新局。遷移機制本身保留給未來升版。

import { validateCommand, type Command } from '../sim/commands';
import {
  SAVE_SCHEMA_VERSION,
  type Building,
  type Citizen,
  type GameState,
} from '../world/state';
import { TERRAIN_GENERATOR_VERSION, TERRAIN_TYPES, type TerrainOverride } from '../world/terrain';

/** citizens 的 id/home/job 字串長度上限：擋存檔異常巨大字串撐爆記憶體/顯示 */
const MAX_CITIZEN_ID_LENGTH = 128;

/** citizens 座標絕對值上限：世界座標不應離譜到這個量級，擋資料損壞的離譜座標 */
const MAX_CITIZEN_COORD_ABS = 1e6;

/** citizens 陣列長度上限：擋存檔異常巨大陣列撐爆記憶體 */
const MAX_CITIZENS = 100000;

/** worldSize 上限：2000×2000＝400 萬格，已是單機模擬的合理天花板；更大多半是資料損壞 */
const MAX_WORLD_SIZE = 2000;

/** terrainOverrides 鍵數上限：地形不進存檔的前提就是 override 稀疏，
 *  超過此量級代表存檔被塞進整張地圖（或已損壞），拒收而非讓它撐爆記憶體 */
const MAX_TERRAIN_OVERRIDES = 200000;

/** worldSeed 上限：hashNoise 以 Math.imul 截成 32 位元，超出此範圍的值只是別名 */
const MAX_WORLD_SEED = 0xffffffff;

/** worldSize 下限：baseTerrainAt 的「四角必為海／中心必為陸」代數保證需要
 *  足夠大的 worldSize 才成立（角落保證代數上需 size ≥ 5，中心保證需 size ≥ 10，
 *  取較嚴者）；低於此值時上述保證會在部分 seed 上失效（審查 F5 實測）。 */
const MIN_WORLD_SIZE = 10;

/** roads 鍵數上限：理由同 MAX_TERRAIN_OVERRIDES——道路是稀疏集合，
 *  整張圖等級的鍵數代表存檔損壞或被塞爆，拒收而非讓它撐爆記憶體 */
const MAX_ROADS = 200000;

/** 格座標鍵格式：`x,y`，非負整數、無前導零（"01,0" 不合法）。
 *  terrainOverrides 與 roads 共用同一種鍵。 */
const TILE_KEY_PATTERN = /^(0|[1-9]\d*),(0|[1-9]\d*)$/;

const TERRAIN_TYPE_SET: ReadonlySet<string> = new Set<string>(TERRAIN_TYPES);

export interface Migration {
  /** 此遷移把存檔從版本 from 升到 from+1 */
  from: number;
  migrate: (raw: unknown) => unknown;
}

/** 存檔版本比程式舊、且沒有對應的遷移可走——玩家該做的是開新局。
 *  與一般的驗證失敗分成兩類，是因為玩家訊息完全不同：「舊版不相容」是預期內的，
 *  「讀不回來」則暗示程式或存檔真的壞了。 */
export class OutdatedSaveError extends Error {
  readonly savedVersion: number;
  readonly supportedVersion: number;

  constructor(savedVersion: number, supportedVersion: number) {
    super(
      `deserializeGameState: 存檔版本 ${savedVersion} 已不受支援（目前 ${supportedVersion}），沒有對應的遷移`,
    );
    this.name = 'OutdatedSaveError';
    this.savedVersion = savedVersion;
    this.supportedVersion = supportedVersion;
  }
}

/** 序列化端守門：與 deserializeGameState 的上限對稱，避免「存得下、讀不回」——
 *  超限的 state 拒絕存出，而不是留到下次載入才 throw。 */
export function serializeGameState(state: GameState): string {
  if (state.citizens.length > MAX_CITIZENS) {
    throw new Error(`serializeGameState: citizens 長度不可超過 ${MAX_CITIZENS}，收到 ${state.citizens.length}`);
  }
  const overrideCount = Object.keys(state.terrainOverrides).length;
  if (overrideCount > MAX_TERRAIN_OVERRIDES) {
    throw new Error(
      `serializeGameState: terrainOverrides 鍵數不可超過 ${MAX_TERRAIN_OVERRIDES}，收到 ${overrideCount}`,
    );
  }
  const roadCount = Object.keys(state.roads).length;
  if (roadCount > MAX_ROADS) {
    throw new Error(`serializeGameState: roads 鍵數不可超過 ${MAX_ROADS}，收到 ${roadCount}`);
  }
  return JSON.stringify(state);
}

/** 已知遷移的 registry。v6 起清空：v1–v5 的存檔一律作廢（deserializeGameState 丟
 *  OutdatedSaveError，由呼叫端開新局），不再維護那條「Command 聯集擴充 → 補 citizens →
 *  補地形欄位 → progress 選填」的遷移鏈。遊戲尚未發行，維護五代遷移的正確性成本
 *  遠高於它保住的存檔價值。
 *  機制本身完整保留（Migration 型別、applyMigrations、deserializeGameState 的遷移分支）：
 *  日後要對某一版做向下相容，在此加回 from=N 的項目即可。
 *  deserializeGameState 預設吃這份清單。 */
export const SAVE_MIGRATIONS: Migration[] = [];

/** 依序套用 from=fromVersion..toVersion-1 的遷移；缺任一步即 throw，不部分套用 */
export function applyMigrations(
  raw: unknown,
  fromVersion: number,
  toVersion: number,
  migrations: Migration[],
): unknown {
  let current = raw;
  for (let version = fromVersion; version < toVersion; version++) {
    const migration = migrations.find((m) => m.from === version);
    if (!migration) {
      throw new Error(
        `applyMigrations: 缺少 from=${version} 的遷移（需要 ${fromVersion}→${toVersion}），收到 migrations=[${migrations
          .map((m) => m.from)
          .join(',')}]`,
      );
    }
    current = migration.migrate(current);
  }
  return current;
}

export function deserializeGameState(json: string, migrations: Migration[] = SAVE_MIGRATIONS): GameState {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error(`deserializeGameState: JSON 解析失敗，收到 ${json}`);
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(`deserializeGameState: 存檔必須是物件，收到 ${typeof parsed}`);
  }

  let raw = parsed as Record<string, unknown>;

  const schemaVersion = raw.schemaVersion;
  if (typeof schemaVersion !== 'number' || !Number.isInteger(schemaVersion) || schemaVersion <= 0) {
    throw new Error(`deserializeGameState: schemaVersion 必須是正整數，收到 ${schemaVersion}`);
  }
  if (schemaVersion > SAVE_SCHEMA_VERSION) {
    throw new Error(
      `deserializeGameState: schemaVersion 超過目前支援版本 ${SAVE_SCHEMA_VERSION}，收到 ${schemaVersion}`,
    );
  }
  // 只看「起始那一步存不存在」而非整條鏈是否完整：鏈中斷代表 registry 寫壞了（程式 bug），
  // 該由 applyMigrations 丟明確錯誤，不能混進「舊檔作廢」這個對玩家而言完全正常的結果。
  if (schemaVersion < SAVE_SCHEMA_VERSION && !migrations.some((m) => m.from === schemaVersion)) {
    throw new OutdatedSaveError(schemaVersion, SAVE_SCHEMA_VERSION);
  }
  if (schemaVersion < SAVE_SCHEMA_VERSION) {
    const migrated = applyMigrations(raw, schemaVersion, SAVE_SCHEMA_VERSION, migrations);
    if (typeof migrated !== 'object' || migrated === null || Array.isArray(migrated)) {
      throw new Error(`deserializeGameState: 遷移輸出必須是物件，收到 ${JSON.stringify(migrated)}`);
    }
    raw = migrated as Record<string, unknown>;
  }

  const tick = raw.tick;
  if (typeof tick !== 'number' || !Number.isInteger(tick) || tick < 0) {
    throw new Error(`deserializeGameState: tick 必須是非負整數，收到 ${tick}`);
  }

  const rngState = raw.rngState;
  if (typeof rngState !== 'number' || !Number.isInteger(rngState) || rngState < 0 || rngState > 0xffffffff) {
    throw new Error(`deserializeGameState: rngState 必須是 0~4294967295 的整數，收到 ${rngState}`);
  }

  const resources = raw.resources;
  if (typeof resources !== 'object' || resources === null || Array.isArray(resources)) {
    throw new Error(`deserializeGameState: resources 必須是物件，收到 ${typeof resources}`);
  }
  for (const [key, value] of Object.entries(resources as Record<string, unknown>)) {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new Error(`deserializeGameState: resources.${key} 必須是有限數值，收到 ${value}`);
    }
  }

  const buildings = raw.buildings;
  if (!Array.isArray(buildings)) {
    throw new Error(`deserializeGameState: buildings 必須是陣列，收到 ${typeof buildings}`);
  }
  for (const [index, building] of (buildings as unknown[]).entries()) {
    if (typeof building !== 'object' || building === null || Array.isArray(building)) {
      throw new Error(`deserializeGameState: buildings[${index}] 必須是物件，收到 ${JSON.stringify(building)}`);
    }
    const b = building as Record<string, unknown>;
    if (typeof b.id !== 'string' || b.id.length === 0) {
      throw new Error(`deserializeGameState: buildings[${index}].id 必須是非空字串，收到 ${JSON.stringify(b.id)}`);
    }
    if (typeof b.type !== 'string' || b.type.length === 0) {
      throw new Error(`deserializeGameState: buildings[${index}].type 必須是非空字串，收到 ${JSON.stringify(b.type)}`);
    }
    if (typeof b.x !== 'number' || !Number.isInteger(b.x) || typeof b.y !== 'number' || !Number.isInteger(b.y)) {
      throw new Error(`deserializeGameState: buildings[${index}].x/y 必須是整數，收到 (${b.x}, ${b.y})`);
    }
    // progress 選填；有值就必須是非負有限數（可為小數——一 tick 的進度增量本來就是分數）
    if (b.progress !== undefined && (typeof b.progress !== 'number' || !Number.isFinite(b.progress) || b.progress < 0)) {
      throw new Error(
        `deserializeGameState: buildings[${index}].progress 必須是非負有限數值（或省略），收到 ${JSON.stringify(b.progress)}`,
      );
    }
  }

  const citizens = raw.citizens;
  if (!Array.isArray(citizens)) {
    throw new Error(`deserializeGameState: citizens 必須是陣列，收到 ${typeof citizens}`);
  }
  if (citizens.length > MAX_CITIZENS) {
    throw new Error(`deserializeGameState: citizens 長度不可超過 ${MAX_CITIZENS}，收到 ${citizens.length}`);
  }
  for (const [index, citizen] of (citizens as unknown[]).entries()) {
    if (typeof citizen !== 'object' || citizen === null || Array.isArray(citizen)) {
      throw new Error(`deserializeGameState: citizens[${index}] 必須是物件，收到 ${JSON.stringify(citizen)}`);
    }
    const c = citizen as Record<string, unknown>;
    if (typeof c.id !== 'string' || c.id.length === 0) {
      throw new Error(`deserializeGameState: citizens[${index}].id 必須是非空字串，收到 ${JSON.stringify(c.id)}`);
    }
    if (c.id.length > MAX_CITIZEN_ID_LENGTH) {
      throw new Error(
        `deserializeGameState: citizens[${index}].id 長度不可超過 ${MAX_CITIZEN_ID_LENGTH}，收到 ${c.id.length}`,
      );
    }
    if (typeof c.home !== 'string' || c.home.length === 0) {
      throw new Error(`deserializeGameState: citizens[${index}].home 必須是非空字串，收到 ${JSON.stringify(c.home)}`);
    }
    if (c.home.length > MAX_CITIZEN_ID_LENGTH) {
      throw new Error(
        `deserializeGameState: citizens[${index}].home 長度不可超過 ${MAX_CITIZEN_ID_LENGTH}，收到 ${c.home.length}`,
      );
    }
    // job 為 null 代表失業；空字串是「有 id 卻是空的」的資料錯誤，一律拒收
    if (c.job !== null && (typeof c.job !== 'string' || c.job.length === 0)) {
      throw new Error(
        `deserializeGameState: citizens[${index}].job 必須是非空字串或 null，收到 ${JSON.stringify(c.job)}`,
      );
    }
    if (typeof c.job === 'string' && c.job.length > MAX_CITIZEN_ID_LENGTH) {
      throw new Error(
        `deserializeGameState: citizens[${index}].job 長度不可超過 ${MAX_CITIZEN_ID_LENGTH}，收到 ${c.job.length}`,
      );
    }
    // 居民座標是世界座標，容許浮點；只擋 NaN/Infinity（JSON 中會是 null）
    if (typeof c.x !== 'number' || !Number.isFinite(c.x)) {
      throw new Error(`deserializeGameState: citizens[${index}].x 必須是有限數值，收到 ${JSON.stringify(c.x)}`);
    }
    if (Math.abs(c.x) > MAX_CITIZEN_COORD_ABS) {
      throw new Error(
        `deserializeGameState: citizens[${index}].x 絕對值不可超過 ${MAX_CITIZEN_COORD_ABS}，收到 ${c.x}`,
      );
    }
    if (typeof c.y !== 'number' || !Number.isFinite(c.y)) {
      throw new Error(`deserializeGameState: citizens[${index}].y 必須是有限數值，收到 ${JSON.stringify(c.y)}`);
    }
    if (Math.abs(c.y) > MAX_CITIZEN_COORD_ABS) {
      throw new Error(
        `deserializeGameState: citizens[${index}].y 絕對值不可超過 ${MAX_CITIZEN_COORD_ABS}，收到 ${c.y}`,
      );
    }
  }

  const worldSeed = raw.worldSeed;
  if (
    typeof worldSeed !== 'number' ||
    !Number.isInteger(worldSeed) ||
    worldSeed < 0 ||
    worldSeed > MAX_WORLD_SEED
  ) {
    throw new Error(
      `deserializeGameState: worldSeed 必須是 0~${MAX_WORLD_SEED} 的整數，收到 ${JSON.stringify(worldSeed)}`,
    );
  }

  const worldSize = raw.worldSize;
  if (
    typeof worldSize !== 'number' ||
    !Number.isInteger(worldSize) ||
    worldSize < MIN_WORLD_SIZE ||
    worldSize > MAX_WORLD_SIZE
  ) {
    throw new Error(
      `deserializeGameState: worldSize 必須是 ${MIN_WORLD_SIZE}~${MAX_WORLD_SIZE} 的整數，收到 ${JSON.stringify(worldSize)}`,
    );
  }

  const terrainGeneratorVersion = raw.terrainGeneratorVersion;
  if (
    typeof terrainGeneratorVersion !== 'number' ||
    !Number.isInteger(terrainGeneratorVersion) ||
    terrainGeneratorVersion <= 0
  ) {
    throw new Error(
      `deserializeGameState: terrainGeneratorVersion 必須是正整數，收到 ${JSON.stringify(terrainGeneratorVersion)}`,
    );
  }
  if (terrainGeneratorVersion > TERRAIN_GENERATOR_VERSION) {
    throw new Error(
      `deserializeGameState: 存檔的地形演算法版本比程式新（存檔 ${terrainGeneratorVersion} > 程式支援 ${TERRAIN_GENERATOR_VERSION}），請更新遊戲版本`,
    );
  }

  const terrainOverrides = raw.terrainOverrides;
  if (typeof terrainOverrides !== 'object' || terrainOverrides === null || Array.isArray(terrainOverrides)) {
    throw new Error(`deserializeGameState: terrainOverrides 必須是物件，收到 ${typeof terrainOverrides}`);
  }
  const overrideKeys = Object.keys(terrainOverrides as Record<string, unknown>);
  if (overrideKeys.length > MAX_TERRAIN_OVERRIDES) {
    throw new Error(
      `deserializeGameState: terrainOverrides 鍵數不可超過 ${MAX_TERRAIN_OVERRIDES}，收到 ${overrideKeys.length}`,
    );
  }
  for (const key of overrideKeys) {
    const match = TILE_KEY_PATTERN.exec(key);
    if (!match) {
      throw new Error(`deserializeGameState: terrainOverrides 鍵格式不合法，收到 "${key}"`);
    }
    const keyX = Number(match[1]);
    const keyY = Number(match[2]);
    if (keyX >= worldSize || keyY >= worldSize) {
      throw new Error(
        `deserializeGameState: terrainOverrides 鍵座標超出世界範圍（worldSize=${worldSize}），收到 "${key}"`,
      );
    }
    const override = (terrainOverrides as Record<string, unknown>)[key];
    if (typeof override !== 'object' || override === null || Array.isArray(override)) {
      throw new Error(
        `deserializeGameState: terrainOverrides["${key}"] 必須是物件，收到 ${JSON.stringify(override)}`,
      );
    }
    const o = override as Record<string, unknown>;
    if (o.type !== undefined && (typeof o.type !== 'string' || !TERRAIN_TYPE_SET.has(o.type))) {
      throw new Error(
        `deserializeGameState: terrainOverrides["${key}"].type 必須是合法地形，收到 ${JSON.stringify(o.type)}`,
      );
    }
    if (o.resource !== undefined && (typeof o.resource !== 'number' || !Number.isFinite(o.resource) || o.resource < 0)) {
      throw new Error(
        `deserializeGameState: terrainOverrides["${key}"].resource 必須是有限非負數，收到 ${JSON.stringify(o.resource)}`,
      );
    }
    if (
      o.depletedDay !== undefined &&
      (typeof o.depletedDay !== 'number' || !Number.isInteger(o.depletedDay) || o.depletedDay <= 0)
    ) {
      throw new Error(
        `deserializeGameState: terrainOverrides["${key}"].depletedDay 必須是正整數，收到 ${JSON.stringify(o.depletedDay)}`,
      );
    }
  }

  // roads 自 v6 起是必填欄位——缺欄不補空物件，因為 v6 的存檔一定寫得出這個欄位，
  // 缺了就是被改壞或不是 v6，靜默補空會讓玩家的整條路網無聲消失。
  const roads = raw.roads;
  if (typeof roads !== 'object' || roads === null || Array.isArray(roads)) {
    throw new Error(`deserializeGameState: roads 必須是物件，收到 ${typeof roads}`);
  }
  const roadKeys = Object.keys(roads as Record<string, unknown>);
  if (roadKeys.length > MAX_ROADS) {
    throw new Error(`deserializeGameState: roads 鍵數不可超過 ${MAX_ROADS}，收到 ${roadKeys.length}`);
  }
  // 刻意不驗「這格地形能不能鋪路」：地形由 worldSeed 程序生成，terrainGeneratorVersion
  // 升版後同一格可能算出水——追溯拒收會讓當初存得合法的檔在改版後變成壞檔。
  for (const key of roadKeys) {
    const match = TILE_KEY_PATTERN.exec(key);
    if (!match) {
      throw new Error(`deserializeGameState: roads 鍵格式不合法，收到 "${key}"`);
    }
    if (Number(match[1]) >= worldSize || Number(match[2]) >= worldSize) {
      throw new Error(
        `deserializeGameState: roads 鍵座標超出世界範圍（worldSize=${worldSize}），收到 "${key}"`,
      );
    }
    // 值恆為 1（見 GameState.roads）：true／2／"1" 都是想繞過 schema 版本號的擴充，一律拒收
    const value = (roads as Record<string, unknown>)[key];
    if (value !== 1) {
      throw new Error(`deserializeGameState: roads["${key}"] 必須是 1，收到 ${JSON.stringify(value)}`);
    }
  }

  const pendingCommands = raw.pendingCommands;
  if (!Array.isArray(pendingCommands)) {
    throw new Error(`deserializeGameState: pendingCommands 必須是陣列，收到 ${typeof pendingCommands}`);
  }
  for (const command of pendingCommands) {
    validateCommand(command as Command);
  }

  return {
    // 遷移後即為當前版本；沿用舊值會使升版存檔標錯版本、下次載入重跑遷移（雙重遷移毀檔）。
    schemaVersion: SAVE_SCHEMA_VERSION,
    tick,
    rngState,
    resources: resources as Record<string, number>,
    buildings: buildings as Building[],
    citizens: citizens as Citizen[],
    pendingCommands: pendingCommands as Command[],
    worldSeed,
    worldSize,
    terrainOverrides: terrainOverrides as Record<string, TerrainOverride>,
    terrainGeneratorVersion,
    roads: roads as Record<string, 1>,
  };
}
