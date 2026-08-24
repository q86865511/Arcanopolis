// 資料表型別：建築/資源數值定義，對應 data\resources.json、data\buildings.json。
// 這些型別描述「合法資料的形狀」，實際載入驗證見 loader.ts 的 parseResourceDefs/parseBuildingDefs。

import type { TerrainType } from '../core/world/terrain';

export interface ResourceDef {
  id: string;
  name: string;
  /** 市場基準單價（金幣/單位）。省略代表不可交易——gold 自身即為此類。 */
  basePrice?: number;
}

export interface BuildingDef {
  id: string;
  name: string;
  size: { w: number; h: number };
  /** 建造成本：資源 id → 數量 */
  cost: Record<string, number>;
  /** 每 tick 產量：資源 id → 數量；無生產則為空物件 */
  production: Record<string, number>;
  /**
   * 完成一批生產所需的工時（tick）。省略時用 DEFAULT_WORK_TICKS。
   * 產出改為整批入帳後，`production` 仍是「滿載時每 tick 的產率」——
   * 一批的實際產量＝production × workTicks，所以調整 workTicks 只改變產出的顆粒度
   * 與進度條長度，不改變平均產率。
   */
  workTicks?: number;
  /** 每 tick 滿載生產所需原料：資源 id → 正數數量；省略代表不需原料 */
  inputs?: Record<string, number>;
  /** 可容納居民數；資料表省略時由 loader 正規化為 0 */
  housing: number;
  /** 可提供工作數；資料表省略時由 loader 正規化為 0 */
  jobs: number;
  /** 為真代表該建築完工後解鎖市場交易（trade 指令）；省略等同 false */
  enablesTrade?: boolean;
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
  /** 居民 home 到工作地的最大曼哈頓距離，避免指派半日移動預算內無法抵達的職缺。 */
  maxCommuteDistance: number;
}

/** 經濟常數表，對應 data\economy.json。「Day」＝一個遊戲日（見 core\sim\time.ts）。 */
export interface EconomyConfig {
  /** 每位「有工作」的居民每日繳納的金幣；無業居民不繳稅 */
  taxPerEmployedCitizenPerDay: number;
  /** 市場買入加價率：買價 = basePrice × (1 + marketBuyMarkup)，賣價 = basePrice。
   *  這段價差就是市場的手續費，讓「賣掉再買回」必定虧損，杜絕零成本套利。 */
  marketBuyMarkup: number;
}

/** 地形資源與森林再生常數，對應 data\terrain-economy.json。 */
export interface TerrainEconomy {
  forestWoodCapacity: number;
  rockStoneCapacity: number;
  forestRegrowDays: number;
}
