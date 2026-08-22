// 存檔序列化與遷移。GameState 為純資料，序列化即 JSON；還原時逐欄驗證，
// 版本不符時先跑 migrations 補到 SAVE_SCHEMA_VERSION 再驗證欄位內容。

import { validateCommand, type Command } from '../sim/commands';
import {
  DEFAULT_WORLD_SIZE,
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

/** terrainOverrides 鍵格式：`x,y`，非負整數、無前導零（"01,0" 不合法） */
const TERRAIN_OVERRIDE_KEY_PATTERN = /^(0|[1-9]\d*),(0|[1-9]\d*)$/;

const TERRAIN_TYPE_SET: ReadonlySet<string> = new Set<string>(TERRAIN_TYPES);

export interface Migration {
  /** 此遷移把存檔從版本 from 升到 from+1 */
  from: number;
  migrate: (raw: unknown) => unknown;
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
  return JSON.stringify(state);
}

/** 已知遷移的 registry：v1→v2 僅是 Command 聯集擴充（新增 placeBuilding/removeBuilding），
 *  v1 形狀本身即合法 v2，遷移函式原樣放行即可；v2→v3 新增 citizens 欄位——缺欄才補空陣列
 *  （v2 以前沒有居民系統，空城即正確語義）；raw 已有 citizens 鍵（無論值是否合法）一律保留原值，
 *  交由後續 deserializeGameState 的欄位驗證逐一把關（避免遷移悄悄清空本該視為資料損毀的內容）。
 *  v3→v4 新增地形欄位 worldSeed/worldSize/terrainOverrides，同樣是「缺欄才補」——
 *  worldSeed 沿用舊檔的 rngState（v3 以前開局時 rngState 即 seed，補這個值最接近原局面），
 *  rngState 也不可用時退回固定值 1（不可用 Date.now/Math.random，決定論要求同一舊檔每次遷移結果相同）。
 *  deserializeGameState 預設吃這份清單。 */
export const SAVE_MIGRATIONS: Migration[] = [
  { from: 1, migrate: (raw) => raw },
  {
    from: 2,
    migrate: (raw) => {
      if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
        throw new Error(`SAVE_MIGRATIONS(v2→v3): 存檔必須是物件，收到 ${JSON.stringify(raw)}`);
      }
      const record = raw as Record<string, unknown>;
      if ('citizens' in record) {
        return record;
      }
      return { ...record, citizens: [] };
    },
  },
  {
    from: 3,
    migrate: (raw) => {
      if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
        throw new Error(`SAVE_MIGRATIONS(v3→v4): 存檔必須是物件，收到 ${JSON.stringify(raw)}`);
      }
      const record = raw as Record<string, unknown>;
      const migrated: Record<string, unknown> = { ...record };
      if (!('worldSeed' in record)) {
        const rngState = record.rngState;
        migrated.worldSeed =
          typeof rngState === 'number' && Number.isInteger(rngState) && rngState >= 0 ? rngState : 1;
      }
      if (!('worldSize' in record)) {
        migrated.worldSize = DEFAULT_WORLD_SIZE;
      }
      if (!('terrainOverrides' in record)) {
        migrated.terrainOverrides = {};
      }
      if (!('terrainGeneratorVersion' in record)) {
        migrated.terrainGeneratorVersion = TERRAIN_GENERATOR_VERSION;
      }

      // C2：v3 以前的存檔沒有地形資訊，玩家既有建築/居民的座標可能落在升版後才算出的
      // 不可通行地形上（典型情境：舊檔建築恰好蓋在世界邊緣，升版後那格算出是海）。
      // 用 grass override 保底，讓舊檔升版後腳下至少是平地——僅在該座標尚無 override 時才補，
      // 不覆蓋玩家原本就有的改動。座標非法（非整數座標、越界）的項目略過不建 override、
      // 也不 throw：欄位驗證是 deserializeGameState 的事，遷移層只管「盡量補救」。
      // 目前建築全 1×1，故僅用單一格座標；多格建築的完整 footprint 需要 defs 的尺寸資訊，
      // 遷移層拿不到，真的出現多格建築時需另外處理。
      const worldSizeForBounds =
        typeof migrated.worldSize === 'number' ? migrated.worldSize : DEFAULT_WORLD_SIZE;
      const overrides = {
        ...(migrated.terrainOverrides as Record<string, unknown>),
      } as Record<string, TerrainOverride>;
      const ensureGrass = (x: unknown, y: unknown): void => {
        if (typeof x !== 'number' || !Number.isInteger(x) || typeof y !== 'number' || !Number.isInteger(y)) {
          return;
        }
        if (x < 0 || y < 0 || x >= worldSizeForBounds || y >= worldSizeForBounds) {
          return;
        }
        const key = `${x},${y}`;
        if (!Object.prototype.hasOwnProperty.call(overrides, key)) {
          overrides[key] = { type: 'grass' };
        }
      };
      if (Array.isArray(record.buildings)) {
        for (const item of record.buildings as unknown[]) {
          if (typeof item === 'object' && item !== null) {
            const b = item as Record<string, unknown>;
            ensureGrass(b.x, b.y);
          }
        }
      }
      if (Array.isArray(record.citizens)) {
        for (const item of record.citizens as unknown[]) {
          if (typeof item === 'object' && item !== null) {
            const c = item as Record<string, unknown>;
            const cx = typeof c.x === 'number' && Number.isFinite(c.x) ? Math.round(c.x) : c.x;
            const cy = typeof c.y === 'number' && Number.isFinite(c.y) ? Math.round(c.y) : c.y;
            ensureGrass(cx, cy);
          }
        }
      }
      migrated.terrainOverrides = overrides;

      return migrated;
    },
  },
];

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
    const match = TERRAIN_OVERRIDE_KEY_PATTERN.exec(key);
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
  };
}
