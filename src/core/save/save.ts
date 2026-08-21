// 存檔序列化與遷移。GameState 為純資料，序列化即 JSON；還原時逐欄驗證，
// 版本不符時先跑 migrations 補到 SAVE_SCHEMA_VERSION 再驗證欄位內容。

import { validateCommand, type Command } from '../sim/commands';
import { SAVE_SCHEMA_VERSION, type Building, type Citizen, type GameState } from '../world/state';

/** citizens 的 id/home/job 字串長度上限：擋存檔異常巨大字串撐爆記憶體/顯示 */
const MAX_CITIZEN_ID_LENGTH = 128;

/** citizens 座標絕對值上限：世界座標不應離譜到這個量級，擋資料損壞的離譜座標 */
const MAX_CITIZEN_COORD_ABS = 1e6;

/** citizens 陣列長度上限：擋存檔異常巨大陣列撐爆記憶體 */
const MAX_CITIZENS = 100000;

export interface Migration {
  /** 此遷移把存檔從版本 from 升到 from+1 */
  from: number;
  migrate: (raw: unknown) => unknown;
}

export function serializeGameState(state: GameState): string {
  return JSON.stringify(state);
}

/** 已知遷移的 registry：v1→v2 僅是 Command 聯集擴充（新增 placeBuilding/removeBuilding），
 *  v1 形狀本身即合法 v2，遷移函式原樣放行即可；v2→v3 新增 citizens 欄位——缺欄才補空陣列
 *  （v2 以前沒有居民系統，空城即正確語義）；raw 已有 citizens 鍵（無論值是否合法）一律保留原值，
 *  交由後續 deserializeGameState 的欄位驗證逐一把關（避免遷移悄悄清空本該視為資料損毀的內容）。
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
  };
}
