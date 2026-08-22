// 資料表型別：建築/資源數值定義，對應 data\resources.json、data\buildings.json。
// 這些型別描述「合法資料的形狀」，實際載入驗證見 loader.ts 的 parseResourceDefs/parseBuildingDefs。

import type { TerrainType } from '../core/world/terrain';

export interface ResourceDef {
  id: string;
  name: string;
}

export interface BuildingDef {
  id: string;
  name: string;
  size: { w: number; h: number };
  /** 建造成本：資源 id → 數量 */
  cost: Record<string, number>;
  /** 每 tick 產量：資源 id → 數量；無生產則為空物件 */
  production: Record<string, number>;
  /** 每 tick 滿載生產所需原料：資源 id → 正數數量；省略代表不需原料 */
  inputs?: Record<string, number>;
  /** 可容納居民數；資料表省略時由 loader 正規化為 0 */
  housing: number;
  /** 可提供工作數；資料表省略時由 loader 正規化為 0 */
  jobs: number;
  /** 地形規則：on/near 僅限制擺放；consumes 宣告生產時可消耗的地形資源。 */
  terrain?: {
    on?: TerrainType[];
    near?: TerrainType[];
    consumes?: TerrainType[];
  };
}

/** 地形定義，對應 data\terrain.json。id 必須是 core\world\terrain.ts 的 TerrainType；
 *  walkable/buildable 是給 UI 與工具查表用的資料鏡像，行為判斷仍以 isWalkable/isBuildable 為準
 *  （tests\data\terrain-defs.test.ts 鎖定兩者必須一致，資料表改壞會當場紅）。 */
export interface TerrainDef {
  id: string;
  name: string;
  walkable: boolean;
  buildable: boolean;
}

/** 人口數值常數表，對應 data\population.json。「Day」＝一個遊戲日（見 core\sim\time.ts）。 */
export interface PopulationConfig {
  /** 每位居民每日消耗糧食（可為浮點） */
  foodPerCitizenPerDay: number;
  /** 糧食充足時每日新增居民數 */
  growthPerDay: number;
  /** 觸發成長所需的糧食存量（以「可供全城吃幾日」計） */
  growthFoodReserveDays: number;
  /** 糧食耗盡時每日餓死居民數 */
  starvationDeathsPerDay: number;
}

/** 地形資源與森林再生常數，對應 data\terrain-economy.json。 */
export interface TerrainEconomy {
  forestWoodCapacity: number;
  rockStoneCapacity: number;
  forestRegrowDays: number;
}
