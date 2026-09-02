// 資料表載入驗證：JSON 讀入後型別是 unknown，一律經此處嚴格檢查才能當 ResourceDef/BuildingDef 使用。
// 失敗一律 throw（不回傳 null/預設值），讓資料表錯誤在載入當下就曝光，而不是流竄到模擬邏輯裡。

import { TERRAIN_TYPES, type TerrainType } from '../core/world/terrain';
import type { BuildingDef, EconomyConfig, EraDef, PopulationConfig, ResourceDef, TerrainDef, TerrainEconomy } from './types';

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

const RESOURCE_DEF_KEYS = ['id', 'name', 'basePrice'] as const;
const TERRAIN_DEF_KEYS = ['id', 'name', 'walkable', 'buildable'] as const;
const BUILDING_DEF_KEYS = [
  'id',
  'name',
  'size',
  'cost',
  'production',
  'inputs',
  'housing',
  'jobs',
  'terrain',
  'enablesTrade',
  'workTicks',
  'unlockAtPopulation',
] as const;
const ERA_DEF_KEYS = ['id', 'name', 'minPopulation'] as const;
const BUILDING_SIZE_KEYS = ['w', 'h'] as const;
const BUILDING_TERRAIN_KEYS = ['on', 'near', 'consumes'] as const;
const TERRAIN_ECONOMY_KEYS = ['forestWoodCapacity', 'rockStoneCapacity', 'forestRegrowDays'] as const;
const ECONOMY_CONFIG_KEYS = ['taxPerEmployedCitizenPerDay', 'marketBuyMarkup'] as const;
const POPULATION_CONFIG_KEYS = [
  'foodPerCitizenPerDay',
  'growthPerDay',
  'growthFoodReserveDays',
  'starvationDeathsPerDay',
  'maxCommuteDistance',
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

/** 驗證 inputs：省略代表無原料需求；有值時 key 須合法、value 須為有限正數。 */
function validateInputs(
  inputs: unknown,
  buildingId: string,
  resourceIds: Set<string>,
): Record<string, number> | undefined {
  if (inputs === undefined) {
    return undefined;
  }
  if (!isPlainObject(inputs)) {
    throw new Error(
      `parseBuildingDefs: 建築 "${buildingId}" 的 inputs 必須是物件，收到 ${JSON.stringify(inputs)}`,
    );
  }
  for (const [resourceId, amount] of Object.entries(inputs)) {
    if (!resourceIds.has(resourceId)) {
      throw new Error(
        `parseBuildingDefs: 建築 "${buildingId}" 的 inputs 引用未知資源 id，收到 "${resourceId}"`,
      );
    }
    if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) {
      throw new Error(
        `parseBuildingDefs: 建築 "${buildingId}" 的 inputs.${resourceId} 必須是有限正數，收到 ${amount}`,
      );
    }
  }
  if (Object.keys(inputs).length === 0) {
    return undefined;
  }
  return { ...(inputs as Record<string, number>) };
}

function validateBuildingTerrain(value: unknown, buildingId: string): BuildingDef['terrain'] {
  if (value === undefined) {
    return undefined;
  }
  if (!isPlainObject(value)) {
    throw new Error(
      `parseBuildingDefs: 建築 "${buildingId}" 的 terrain 必須是物件，收到 ${JSON.stringify(value)}`,
    );
  }
  rejectUnknownKeys(value, BUILDING_TERRAIN_KEYS, `parseBuildingDefs: 建築 "${buildingId}" 的 terrain`);

  const validTypes = new Set<string>(TERRAIN_TYPES);
  const validateList = (list: unknown, field: 'on' | 'near' | 'consumes'): TerrainType[] | undefined => {
    if (list === undefined) return undefined;
    if (!Array.isArray(list) || list.length === 0) {
      throw new Error(
        `parseBuildingDefs: 建築 "${buildingId}" 的 terrain.${field} 必須是非空地形陣列，收到 ${JSON.stringify(list)}`,
      );
    }
    for (const type of list) {
      if (typeof type !== 'string' || !validTypes.has(type)) {
        throw new Error(
          `parseBuildingDefs: 建築 "${buildingId}" 的 terrain.${field} 必須只含合法地形，收到 ${JSON.stringify(type)}`,
        );
      }
    }
    return [...list] as TerrainType[];
  };

  const on = validateList(value.on, 'on');
  const near = validateList(value.near, 'near');
  const consumes = validateList(value.consumes, 'consumes');
  return {
    ...(on === undefined ? {} : { on }),
    ...(near === undefined ? {} : { near }),
    ...(consumes === undefined ? {} : { consumes }),
  };
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

    // basePrice 省略＝不可交易（gold 即是），與「價格為 0」語義不同：後者會讓賣出恆得 0 金幣
    // 卻仍扣光資源，因此 0 與負值一律視為資料錯誤。
    const { basePrice } = item;
    if (basePrice === undefined) {
      defs.push({ id, name });
      continue;
    }
    if (typeof basePrice !== 'number' || !Number.isFinite(basePrice) || basePrice <= 0) {
      throw new Error(
        `parseResourceDefs: 資源 "${id}" 的 basePrice 必須是正有限數值（或省略），收到 ${JSON.stringify(basePrice)}`,
      );
    }
    defs.push({ id, name, basePrice });
  }

  return defs;
}

/** 地形資料表驗證。id 必須是 core 的 TerrainType——資料表不得自創地形，
 *  否則 render/UI 查得到而 core 的 isWalkable 判斷不到，兩邊悄悄不一致。 */
export function parseTerrainDefs(input: unknown): TerrainDef[] {
  if (!Array.isArray(input)) {
    throw new Error(`parseTerrainDefs: 輸入必須是陣列，收到 ${JSON.stringify(input)}`);
  }

  const validIds = new Set<string>(TERRAIN_TYPES);
  const seenIds = new Set<string>();
  const defs: TerrainDef[] = [];

  for (const [index, item] of input.entries()) {
    if (!isPlainObject(item)) {
      throw new Error(`parseTerrainDefs: 第 ${index} 個元素必須是物件，收到 ${JSON.stringify(item)}`);
    }
    rejectUnknownKeys(item, TERRAIN_DEF_KEYS, `parseTerrainDefs: 第 ${index} 個元素`);
    const { id, name, walkable, buildable } = item;

    if (!isNonEmptyString(id) || !validIds.has(id)) {
      throw new Error(
        `parseTerrainDefs: 第 ${index} 個元素的 id 必須是合法地形（${[...TERRAIN_TYPES].join('/')}），收到 ${JSON.stringify(id)}`,
      );
    }
    if (!isNonEmptyString(name)) {
      throw new Error(`parseTerrainDefs: 地形 "${id}" 的 name 必須是非空字串，收到 ${JSON.stringify(name)}`);
    }
    if (typeof walkable !== 'boolean') {
      throw new Error(`parseTerrainDefs: 地形 "${id}" 的 walkable 必須是布林值，收到 ${JSON.stringify(walkable)}`);
    }
    if (typeof buildable !== 'boolean') {
      throw new Error(`parseTerrainDefs: 地形 "${id}" 的 buildable 必須是布林值，收到 ${JSON.stringify(buildable)}`);
    }
    if (seenIds.has(id)) {
      throw new Error(`parseTerrainDefs: id 重複 "${id}"`);
    }
    seenIds.add(id);

    defs.push({ id, name, walkable, buildable });
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
    const { id, name, size, cost, production, inputs, housing, jobs, terrain, enablesTrade, workTicks, unlockAtPopulation } = item;

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
    const validInputs = validateInputs(inputs, id, resourceIds);
    const validHousing = validateCapacity(housing, 'housing', id);
    const validJobs = validateCapacity(jobs, 'jobs', id);
    const validTerrain = validateBuildingTerrain(terrain, id);
    // workTicks 必須是正整數：進度以整數 tick 累加，小數或 0 會讓「滿一批」的判定
    // 要嘛永遠不成立、要嘛一個 tick 連出好幾批。
    if (workTicks !== undefined && !isPositiveInteger(workTicks)) {
      throw new Error(
        `parseBuildingDefs: 建築 "${id}" 的 workTicks 必須是正整數（或省略），收到 ${JSON.stringify(workTicks)}`,
      );
    }
    if (enablesTrade !== undefined && typeof enablesTrade !== 'boolean') {
      throw new Error(
        `parseBuildingDefs: 建築 "${id}" 的 enablesTrade 必須是布林值（或省略），收到 ${JSON.stringify(enablesTrade)}`,
      );
    }

    if (
      unlockAtPopulation !== undefined &&
      (typeof unlockAtPopulation !== 'number' || !Number.isInteger(unlockAtPopulation) || unlockAtPopulation < 0)
    ) {
      throw new Error(
        `parseBuildingDefs: 建築 "${id}" 的 unlockAtPopulation 必須是非負整數（或省略），收到 ${JSON.stringify(unlockAtPopulation)}`,
      );
    }

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
      ...(validInputs === undefined ? {} : { inputs: validInputs }),
      housing: validHousing,
      jobs: validJobs,
      ...(validTerrain === undefined ? {} : { terrain: validTerrain }),
      ...(enablesTrade === true ? { enablesTrade: true } : {}),
      ...(workTicks === undefined ? {} : { workTicks }),
      ...(unlockAtPopulation === undefined ? {} : { unlockAtPopulation }),
    });
  }

  return defs;
}

/** 時代階段表：至少一階、第一階 minPopulation 必為 0（否則開局無任何頁籤）、門檻嚴格遞增、id 不重複。 */
export function parseEraDefs(input: unknown): EraDef[] {
  if (!Array.isArray(input) || input.length === 0) {
    throw new Error(`parseEraDefs: 輸入必須是非空陣列，收到 ${JSON.stringify(input)}`);
  }
  const seenIds = new Set<string>();
  const eras: EraDef[] = [];
  for (const [index, item] of input.entries()) {
    if (!isPlainObject(item)) {
      throw new Error(`parseEraDefs: 第 ${index} 個元素必須是物件，收到 ${JSON.stringify(item)}`);
    }
    rejectUnknownKeys(item, ERA_DEF_KEYS, `parseEraDefs: 第 ${index} 個元素`);
    const { id, name, minPopulation } = item;
    if (!isNonEmptyString(id)) {
      throw new Error(`parseEraDefs: 第 ${index} 個元素的 id 必須是非空字串，收到 ${JSON.stringify(id)}`);
    }
    if (!isNonEmptyString(name)) {
      throw new Error(`parseEraDefs: 階段 "${id}" 的 name 必須是非空字串，收到 ${JSON.stringify(name)}`);
    }
    if (typeof minPopulation !== 'number' || !Number.isInteger(minPopulation) || minPopulation < 0) {
      throw new Error(
        `parseEraDefs: 階段 "${id}" 的 minPopulation 必須是非負整數，收到 ${JSON.stringify(minPopulation)}`,
      );
    }
    if (index === 0 && minPopulation !== 0) {
      throw new Error(`parseEraDefs: 第一階段 "${id}" 的 minPopulation 必須是 0，收到 ${minPopulation}`);
    }
    if (index > 0 && minPopulation <= eras[index - 1].minPopulation) {
      throw new Error(
        `parseEraDefs: 階段 "${id}" 的 minPopulation（${minPopulation}）必須大於前一階段（${eras[index - 1].minPopulation}）`,
      );
    }
    if (seenIds.has(id)) {
      throw new Error(`parseEraDefs: id 重複 "${id}"`);
    }
    seenIds.add(id);
    eras.push({ id, name, minPopulation });
  }
  return eras;
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
    maxCommuteDistance: validatePopulationField(
      input.maxCommuteDistance,
      'maxCommuteDistance',
      'positiveInteger',
    ),
  };
}

export function parseEconomyConfig(input: unknown): EconomyConfig {
  if (!isPlainObject(input)) {
    throw new Error(`parseEconomyConfig: 輸入必須是物件，收到 ${JSON.stringify(input)}`);
  }
  rejectUnknownKeys(input, ECONOMY_CONFIG_KEYS, 'parseEconomyConfig');

  const { taxPerEmployedCitizenPerDay, marketBuyMarkup } = input;
  if (typeof taxPerEmployedCitizenPerDay !== 'number' || !Number.isFinite(taxPerEmployedCitizenPerDay) || taxPerEmployedCitizenPerDay < 0) {
    throw new Error(
      `parseEconomyConfig: taxPerEmployedCitizenPerDay 必須是非負有限數值，收到 ${JSON.stringify(taxPerEmployedCitizenPerDay)}`,
    );
  }
  // 加價率允許 0（無手續費市場），但不得為負——負加價代表買價低於賣價，
  // 玩家可以反覆買進再賣出無中生有造金幣。
  if (typeof marketBuyMarkup !== 'number' || !Number.isFinite(marketBuyMarkup) || marketBuyMarkup < 0) {
    throw new Error(
      `parseEconomyConfig: marketBuyMarkup 必須是非負有限數值，收到 ${JSON.stringify(marketBuyMarkup)}`,
    );
  }

  return { taxPerEmployedCitizenPerDay, marketBuyMarkup };
}

export function parseTerrainEconomy(input: unknown): TerrainEconomy {
  if (!isPlainObject(input)) {
    throw new Error(`parseTerrainEconomy: 輸入必須是物件，收到 ${JSON.stringify(input)}`);
  }
  rejectUnknownKeys(input, TERRAIN_ECONOMY_KEYS, 'parseTerrainEconomy');

  const readPositiveInteger = (field: keyof TerrainEconomy): number => {
    const value = input[field];
    if (!isPositiveInteger(value)) {
      throw new Error(`parseTerrainEconomy: ${field} 必須是正整數，收到 ${JSON.stringify(value)}`);
    }
    return value;
  };

  return {
    forestWoodCapacity: readPositiveInteger('forestWoodCapacity'),
    rockStoneCapacity: readPositiveInteger('rockStoneCapacity'),
    forestRegrowDays: readPositiveInteger('forestRegrowDays'),
  };
}
