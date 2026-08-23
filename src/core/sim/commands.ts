// 指令：呈現層唯一能影響模擬的管道。純資料物件，於 tick 開頭依 FIFO 套用。

import { addResource, getResource, type GameState } from '../world/state';
import { footprintTiles, isAreaFree } from '../world/occupancy';
import { canBuildAt } from '../world/buildable';
import type { BuildingDef, EconomyConfig, ResourceDef } from '../../data/types';

export interface AddResourceCommand {
  type: 'addResource';
  resource: string;
  amount: number;
}

export interface PlaceBuildingCommand {
  type: 'placeBuilding';
  buildingType: string;
  /** 格座標，footprint 左上角 */
  x: number;
  y: number;
}

export interface RemoveBuildingCommand {
  type: 'removeBuilding';
  buildingId: string;
}

export interface TradeCommand {
  type: 'trade';
  /** buy＝付金幣換資源；sell＝交資源換金幣 */
  direction: 'buy' | 'sell';
  resource: string;
  /** 交易單位數，正整數 */
  amount: number;
}

export type Command = AddResourceCommand | PlaceBuildingCommand | RemoveBuildingCommand | TradeCommand;

/** 交易所需的市場環境：定價來自資源表、加價率來自經濟表。
 *  未注入時 trade 指令一律靜默跳過（比照 placeBuilding 未注入 defs 的處理）。 */
export interface TradeContext {
  resourceDefs: ResourceDef[];
  economy: EconomyConfig;
}

/** 於 enqueue 入口與存檔還原時呼叫：輸入可能來自不受信任的 JSON，逐欄驗證、未知 type 一律拒絕 */
// 長度/數值上限：指令可能來自不受信任的 JSON（存檔還原、未來連線輸入），沒有上限會讓
// 一筆指令就餵進超長字串或誇張座標，拖垮下游（渲染、序列化、佔格計算）。
const MAX_BUILDING_TYPE_LENGTH = 64;
const MAX_BUILDING_ID_LENGTH = 128;
const MAX_RESOURCE_ID_LENGTH = 64;
const MAX_COORDINATE_ABS = 1_000_000;
const MAX_TRADE_AMOUNT = 1_000_000;

export function validateCommand(command: Command): void {
  if (typeof command !== 'object' || command === null) {
    throw new Error(`validateCommand: 指令必須是物件，收到 ${JSON.stringify(command)}`);
  }
  switch (command.type) {
    case 'addResource':
      if (typeof command.resource !== 'string' || command.resource.length === 0) {
        throw new Error(`addResource: resource 必須是非空字串，收到 ${JSON.stringify(command.resource)}`);
      }
      if (command.resource.length > MAX_RESOURCE_ID_LENGTH) {
        throw new Error(
          `addResource: resource 長度不可超過 ${MAX_RESOURCE_ID_LENGTH}，收到長度 ${command.resource.length}`,
        );
      }
      if (!Number.isFinite(command.amount)) {
        throw new Error(`addResource: amount 必須是有限數值，收到 ${command.amount}`);
      }
      break;
    case 'placeBuilding':
      if (typeof command.buildingType !== 'string' || command.buildingType.length === 0) {
        throw new Error(`placeBuilding: buildingType 必須是非空字串，收到 ${JSON.stringify(command.buildingType)}`);
      }
      if (command.buildingType.length > MAX_BUILDING_TYPE_LENGTH) {
        throw new Error(
          `placeBuilding: buildingType 長度不可超過 ${MAX_BUILDING_TYPE_LENGTH}，收到長度 ${command.buildingType.length}`,
        );
      }
      if (!Number.isInteger(command.x)) {
        throw new Error(`placeBuilding: x 必須是整數，收到 ${JSON.stringify(command.x)}`);
      }
      if (Math.abs(command.x) > MAX_COORDINATE_ABS) {
        throw new Error(`placeBuilding: x 絕對值不可超過 ${MAX_COORDINATE_ABS}，收到 ${command.x}`);
      }
      if (!Number.isInteger(command.y)) {
        throw new Error(`placeBuilding: y 必須是整數，收到 ${JSON.stringify(command.y)}`);
      }
      if (Math.abs(command.y) > MAX_COORDINATE_ABS) {
        throw new Error(`placeBuilding: y 絕對值不可超過 ${MAX_COORDINATE_ABS}，收到 ${command.y}`);
      }
      break;
    case 'trade':
      if (command.direction !== 'buy' && command.direction !== 'sell') {
        throw new Error(`trade: direction 必須是 "buy" 或 "sell"，收到 ${JSON.stringify(command.direction)}`);
      }
      if (typeof command.resource !== 'string' || command.resource.length === 0) {
        throw new Error(`trade: resource 必須是非空字串，收到 ${JSON.stringify(command.resource)}`);
      }
      if (command.resource.length > MAX_RESOURCE_ID_LENGTH) {
        throw new Error(`trade: resource 長度不可超過 ${MAX_RESOURCE_ID_LENGTH}，收到長度 ${command.resource.length}`);
      }
      // 交易量限正整數：小數會讓資源與金幣同時出現浮點殘渣，且「買 0.5 個工具」沒有語義。
      if (!Number.isInteger(command.amount) || command.amount <= 0) {
        throw new Error(`trade: amount 必須是正整數，收到 ${JSON.stringify(command.amount)}`);
      }
      if (command.amount > MAX_TRADE_AMOUNT) {
        throw new Error(`trade: amount 不可超過 ${MAX_TRADE_AMOUNT}，收到 ${command.amount}`);
      }
      break;
    case 'removeBuilding':
      if (typeof command.buildingId !== 'string' || command.buildingId.length === 0) {
        throw new Error(`removeBuilding: buildingId 必須是非空字串，收到 ${JSON.stringify(command.buildingId)}`);
      }
      if (command.buildingId.length > MAX_BUILDING_ID_LENGTH) {
        throw new Error(
          `removeBuilding: buildingId 長度不可超過 ${MAX_BUILDING_ID_LENGTH}，收到長度 ${command.buildingId.length}`,
        );
      }
      break;
    default: {
      const unknownType = (command as { type?: unknown }).type;
      throw new Error(`validateCommand: 未知指令 type，收到 ${JSON.stringify(unknownType)}`);
    }
  }
}

/** defs 缺省為空陣列：呼叫端未注入建築定義時，placeBuilding 一律因查無 def 靜默跳過（見 Simulation 兩參數呼叫）*/
export function applyCommand(
  state: GameState,
  command: Command,
  defs: BuildingDef[] = [],
  trade?: TradeContext,
): void {
  switch (command.type) {
    case 'addResource':
      addResource(state, command.resource, command.amount);
      break;
    case 'placeBuilding': {
      const def = defs.find((d) => d.id === command.buildingType);
      if (!def) break; // 型別不存在於 defs → 靜默跳過

      const tiles = footprintTiles(command.x, command.y, def.size.w, def.size.h);
      if (!isAreaFree(state, tiles, defs)) break; // 與既有建築重疊 → 靜默跳過

      const costEntries = Object.entries(def.cost);
      const canAfford = costEntries.every(([resource, amount]) => getResource(state, resource) >= amount);
      if (!canAfford) break; // 資源不足（任一項）→ 整筆跳過，不部分扣款

      if (!canBuildAt(state, def, command.x, command.y, defs)) break; // 地形/邊界不符 → 靜默跳過

      for (const [resource, amount] of costEntries) {
        addResource(state, resource, -amount);
      }
      // id 帶入套用當下的 state.tick：套用發生在 state.tick += 1 之前（見 Simulation.tick），
      // 故仍是決定論的。同格重蓋（先前那棟已被拆除）會落在不同 tick，id 不同，避免 ABA——
      // 若沿用舊 id 對已被覆蓋的格重放 removeBuilding，不會誤刪重蓋後的新棟。
      state.buildings.push({
        id: `${def.id}@${command.x},${command.y}#${state.tick}`,
        type: def.id,
        x: command.x,
        y: command.y,
      });
      break;
    }
    case 'trade': {
      if (trade === undefined) break; // 未注入市場環境 → 靜默跳過

      // 必須先有一棟已完工、宣告 enablesTrade 的建築，交易能力才解鎖。
      const hasMarket = state.buildings.some(
        (b) => defs.find((d) => d.id === b.type)?.enablesTrade === true,
      );
      if (!hasMarket) break;

      const def = trade.resourceDefs.find((d) => d.id === command.resource);
      // basePrice 省略＝該資源不可交易（gold 自身即是）→ 靜默跳過，避免用金幣買金幣
      if (def?.basePrice === undefined) break;

      if (command.direction === 'sell') {
        // 庫存不足不做部分成交：與 placeBuilding 的「整筆跳過、不部分扣款」一致。
        if (getResource(state, command.resource) < command.amount) break;
        addResource(state, command.resource, -command.amount);
        addResource(state, 'gold', def.basePrice * command.amount);
        break;
      }

      const unitPrice = def.basePrice * (1 + trade.economy.marketBuyMarkup);
      const totalPrice = unitPrice * command.amount;
      if (getResource(state, 'gold') < totalPrice) break;
      addResource(state, 'gold', -totalPrice);
      addResource(state, command.resource, command.amount);
      break;
    }
    case 'removeBuilding': {
      const index = state.buildings.findIndex((b) => b.id === command.buildingId);
      if (index === -1) break; // 找不到 id → 靜默跳過，不退款
      state.buildings.splice(index, 1);
      break;
    }
    default: {
      // 窮盡守衛：validateCommand 已在 enqueue/tick/存檔還原時擋下未知 type，
      // 但 applyCommand 可能被直接呼叫繞過驗證（見 R8），此處不可靜默放行。
      const exhaustiveCheck: never = command;
      throw new Error(
        `applyCommand: 未知指令 type，收到 ${JSON.stringify((exhaustiveCheck as { type?: unknown })?.type)}`,
      );
    }
  }
}
