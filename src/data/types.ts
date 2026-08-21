// 資料表型別：建築/資源數值定義，對應 data\resources.json、data\buildings.json。
// 這些型別描述「合法資料的形狀」，實際載入驗證見 loader.ts 的 parseResourceDefs/parseBuildingDefs。

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
}
