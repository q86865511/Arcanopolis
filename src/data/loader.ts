// 資料表載入驗證：JSON 讀入後型別是 unknown，一律經此處嚴格檢查才能當 ResourceDef/BuildingDef 使用。
// 失敗一律 throw（不回傳 null/預設值），讓資料表錯誤在載入當下就曝光，而不是流竄到模擬邏輯裡。

import type { BuildingDef, ResourceDef } from './types';

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
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
    const { id, name, size, cost, production } = item;

    if (!isNonEmptyString(id)) {
      throw new Error(`parseBuildingDefs: 第 ${index} 個元素的 id 必須是非空字串，收到 ${JSON.stringify(id)}`);
    }
    if (!isNonEmptyString(name)) {
      throw new Error(`parseBuildingDefs: 建築 "${id}" 的 name 必須是非空字串，收到 ${JSON.stringify(name)}`);
    }
    if (!isPlainObject(size) || !isPositiveInteger(size.w) || !isPositiveInteger(size.h)) {
      throw new Error(`parseBuildingDefs: 建築 "${id}" 的 size.w/size.h 必須是正整數，收到 ${JSON.stringify(size)}`);
    }
    const validCost = validateAmounts(cost, 'cost', id, resourceIds);
    const validProduction = validateAmounts(production, 'production', id, resourceIds);

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
    });
  }

  return defs;
}
