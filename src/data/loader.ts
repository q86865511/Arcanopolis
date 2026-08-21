// 資料表載入驗證：JSON 讀入後型別是 unknown，一律經此處嚴格檢查才能當 ResourceDef/BuildingDef 使用。
// 失敗一律 throw（不回傳 null/預設值），讓資料表錯誤在載入當下就曝光，而不是流竄到模擬邏輯裡。

import type { BuildingDef, PopulationConfig, ResourceDef } from './types';

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

/** 建築 footprint 邊長上限：擋住資料表打錯（如多打一個 0）撐爆佔格計算 */
const MAX_BUILDING_SIZE = 16;

/** 拒絕物件上出現允許清單以外的鍵：擋資料表打錯字（如 housing 誤打成 housings）
 *  悄悄被忽略、直到執行期才發現欄位沒生效。 */
function rejectUnknownKeys(item: Record<string, unknown>, allowedKeys: readonly string[], errorPrefix: string): void {
  for (const key of Object.keys(item)) {
    if (!allowedKeys.includes(key)) {
      throw new Error(`${errorPrefix}: 含未知欄位 "${key}"`);
    }
  }
}

const RESOURCE_DEF_KEYS = ['id', 'name'] as const;
const BUILDING_DEF_KEYS = ['id', 'name', 'size', 'cost', 'production', 'housing', 'jobs'] as const;
const BUILDING_SIZE_KEYS = ['w', 'h'] as const;
const POPULATION_CONFIG_KEYS = [
  'foodPerCitizenPerDay',
  'growthPerDay',
  'growthFoodReserveDays',
  'starvationDeathsPerDay',
] as const;

/** 單棟建築的 housing/jobs 上限：同理擋資料表打錯撐爆人口計算 */
const MAX_POPULATION_CAPACITY = 1000;

/** 驗證 housing/jobs：省略視為 0（多數建築兩者皆無），有值則須為 0~1000 整數 */
function validateCapacity(value: unknown, field: string, buildingId: string): number {
  if (value === undefined) {
    return 0;
  }
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < 0 ||
    value > MAX_POPULATION_CAPACITY
  ) {
    throw new Error(
      `parseBuildingDefs: 建築 "${buildingId}" 的 ${field} 必須是 0~${MAX_POPULATION_CAPACITY} 的整數，收到 ${JSON.stringify(value)}`,
    );
  }
  return value;
}

/** 驗證 amounts 物件（cost/production）：key 須在 resourceIds 內、value 須為有限非負數 */
function validateAmounts(
  amounts: unknown,
  field: string,
  buildingId: string,
  resourceIds: Set<string>,
): Record<string, number> {
  if (!isPlainObject(amounts)) {
    throw new Error(`parseBuildingDefs: 建築 "${buildingId}" 的 ${field} 必須是物件，收到 ${JSON.stringify(amounts)}`);
  }
  for (const [resourceId, amount] of Object.entries(amounts)) {
    if (!resourceIds.has(resourceId)) {
      throw new Error(
        `parseBuildingDefs: 建築 "${buildingId}" 的 ${field} 引用未知資源 id "${resourceId}"`,
      );
    }
    if (typeof amount !== 'number' || !Number.isFinite(amount) || amount < 0) {
      throw new Error(
        `parseBuildingDefs: 建築 "${buildingId}" 的 ${field}.${resourceId} 必須是有限非負數，收到 ${amount}`,
      );
    }
  }
  // 回傳複本：與輸入 JSON 斷開參照，呼叫端改動 def 不會污染原始資料表物件
  return { ...(amounts as Record<string, number>) };
}

export function parseResourceDefs(input: unknown): ResourceDef[] {
  if (!Array.isArray(input)) {
    throw new Error(`parseResourceDefs: 輸入必須是陣列，收到 ${JSON.stringify(input)}`);
  }

  const seenIds = new Set<string>();
  const defs: ResourceDef[] = [];

  for (const [index, item] of input.entries()) {
    if (!isPlainObject(item)) {
      throw new Error(`parseResourceDefs: 第 ${index} 個元素必須是物件，收到 ${JSON.stringify(item)}`);
    }
    rejectUnknownKeys(item, RESOURCE_DEF_KEYS, `parseResourceDefs: 第 ${index} 個元素`);
    const { id, name } = item;
    if (!isNonEmptyString(id)) {
      throw new Error(`parseResourceDefs: 第 ${index} 個元素的 id 必須是非空字串，收到 ${JSON.stringify(id)}`);
    }
    if (!isNonEmptyString(name)) {
      throw new Error(`parseResourceDefs: 資源 "${id}" 的 name 必須是非空字串，收到 ${JSON.stringify(name)}`);
    }
    if (seenIds.has(id)) {
      throw new Error(`parseResourceDefs: id 重複 "${id}"`);
    }
    seenIds.add(id);
    defs.push({ id, name });
  }

  return defs;
}

export function parseBuildingDefs(input: unknown, resourceIds: Set<string>): BuildingDef[] {
  if (!Array.isArray(input)) {
    throw new Error(`parseBuildingDefs: 輸入必須是陣列，收到 ${JSON.stringify(input)}`);
  }

  const seenIds = new Set<string>();
  const defs: BuildingDef[] = [];

  for (const [index, item] of input.entries()) {
    if (!isPlainObject(item)) {
      throw new Error(`parseBuildingDefs: 第 ${index} 個元素必須是物件，收到 ${JSON.stringify(item)}`);
    }
    rejectUnknownKeys(item, BUILDING_DEF_KEYS, `parseBuildingDefs: 第 ${index} 個元素`);
    const { id, name, size, cost, production, housing, jobs } = item;

    if (!isNonEmptyString(id)) {
      throw new Error(`parseBuildingDefs: 第 ${index} 個元素的 id 必須是非空字串，收到 ${JSON.stringify(id)}`);
    }
    if (!isNonEmptyString(name)) {
      throw new Error(`parseBuildingDefs: 建築 "${id}" 的 name 必須是非空字串，收到 ${JSON.stringify(name)}`);
    }
    if (!isPlainObject(size) || !isPositiveInteger(size.w) || !isPositiveInteger(size.h)) {
      throw new Error(`parseBuildingDefs: 建築 "${id}" 的 size.w/size.h 必須是正整數，收到 ${JSON.stringify(size)}`);
    }
    rejectUnknownKeys(size, BUILDING_SIZE_KEYS, `parseBuildingDefs: 建築 "${id}" 的 size`);
    if (size.w > MAX_BUILDING_SIZE || size.h > MAX_BUILDING_SIZE) {
      throw new Error(
        `parseBuildingDefs: 建築 "${id}" 的 size.w/size.h 不可超過 ${MAX_BUILDING_SIZE}，收到 ${JSON.stringify(size)}`,
      );
    }
    const validCost = validateAmounts(cost, 'cost', id, resourceIds);
    const validProduction = validateAmounts(production, 'production', id, resourceIds);
    const validHousing = validateCapacity(housing, 'housing', id);
    const validJobs = validateCapacity(jobs, 'jobs', id);

    if (seenIds.has(id)) {
      throw new Error(`parseBuildingDefs: id 重複 "${id}"`);
    }
    seenIds.add(id);

    defs.push({
      id,
      name,
      size: { w: size.w, h: size.h },
      cost: validCost,
      production: validProduction,
      housing: validHousing,
      jobs: validJobs,
    });
  }

  return defs;
}

/** 驗證人口常數表欄位：type 為 'positiveInteger' 時額外要求整數（每日人數不可有小數） */
function validatePopulationField(
  value: unknown,
  field: string,
  kind: 'positiveNumber' | 'positiveInteger',
): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new Error(
      `parsePopulationConfig: ${field} 必須是正有限數值，收到 ${JSON.stringify(value)}`,
    );
  }
  if (kind === 'positiveInteger' && !Number.isInteger(value)) {
    throw new Error(`parsePopulationConfig: ${field} 必須是正整數，收到 ${JSON.stringify(value)}`);
  }
  return value;
}

export function parsePopulationConfig(input: unknown): PopulationConfig {
  if (!isPlainObject(input)) {
    throw new Error(`parsePopulationConfig: 輸入必須是物件，收到 ${JSON.stringify(input)}`);
  }
  rejectUnknownKeys(input, POPULATION_CONFIG_KEYS, 'parsePopulationConfig');

  return {
    foodPerCitizenPerDay: validatePopulationField(
      input.foodPerCitizenPerDay,
      'foodPerCitizenPerDay',
      'positiveNumber',
    ),
    growthPerDay: validatePopulationField(input.growthPerDay, 'growthPerDay', 'positiveInteger'),
    growthFoodReserveDays: validatePopulationField(
      input.growthFoodReserveDays,
      'growthFoodReserveDays',
      'positiveInteger',
    ),
    starvationDeathsPerDay: validatePopulationField(
      input.starvationDeathsPerDay,
      'starvationDeathsPerDay',
      'positiveInteger',
    ),
  };
}
