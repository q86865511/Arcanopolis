// 資源趨勢與人口診斷：純函數、零 Phaser 依賴（比照 hudLayout.ts 的作法，可在不起 Phaser 場景下單元測試）。
//
// 「每日增減」需要一段歷史才算得出——core 的 GameState 本身不記錄歷史（存檔不該為了顯示需求
// 而膨脹），故歷史由 render 端自己維護，只讀 core state 的即時快照，不寫回 GameState、不進存檔
// （見專案 CLAUDE.md 的「render 只讀 core 狀態」）。
//
// 人口診斷同理：population.ts 只在日界 tick 執行一次決策，HUD 卻要「隨時」告訴玩家卡在哪一條。
// diagnosePopulation 用當下 state 重新跑一次同樣的門檻判斷（見 src/core/systems/population.ts），
// 得到「如果現在就是日界，會落在哪個分支」的即時診斷——這是預測性讀數，不是「昨天實際發生了什麼」
// 的紀錄；判斷順序與門檻逐條照抄 population.ts，population.ts 本身不受影響（只讀不改）。

import { getResource, type GameState } from '../core/world/state';
import type { BuildingDef, PopulationConfig } from '../data/types';

// ---------------------------------------------------------------------------
// 資源歷史／每日增減
// ---------------------------------------------------------------------------

/** 單一遊戲日界的資源存量快照。 */
export interface DailySnapshot {
  /** core\sim\time.ts 的 GameTime.totalDay（全域日序，從 1 起算）。 */
  day: number;
  /** 資源 id → 存量，於記錄當下複製一份（避免與 state.resources 共用參考被後續 tick 改動）。 */
  resources: Record<string, number>;
}

/** 資源歷史：只保留最近 HISTORY_MAX_DAYS 天，避免無限增長（存活很久的城市不該讓陣列一直變長）。 */
export interface ResourceHistory {
  /** 由舊到新排序。 */
  snapshots: DailySnapshot[];
}

/** 保留天數上限：夠算出「最近一日增減」即可，不需要更長的歷史（目前也沒有走勢圖等 UI 需要它）。 */
export const HISTORY_MAX_DAYS = 8;

export function createResourceHistory(): ResourceHistory {
  return { snapshots: [] };
}

/**
 * 記錄一次日界快照。同一個 day 重複呼叫（同日內誤觸發）會覆蓋既有快照而非新增一筆
 * ——呼叫端（Hud）本就只在偵測到「目前日序變動」時才呼叫，這裡的覆蓋是防禦性的，
 * 避免萬一呼叫端邏輯有誤時歷史被同一天灌爆好幾筆而讓「最近兩筆」失真。
 */
export function recordDay(
  history: ResourceHistory,
  day: number,
  resources: Record<string, number>,
): ResourceHistory {
  const snapshot: DailySnapshot = { day, resources: { ...resources } };
  const { snapshots } = history;
  const last = snapshots[snapshots.length - 1];
  if (last !== undefined && last.day === day) {
    return { snapshots: [...snapshots.slice(0, -1), snapshot] };
  }
  return { snapshots: [...snapshots, snapshot].slice(-HISTORY_MAX_DAYS) };
}

/** 資源快照是 render 端自建的 plain object（見 recordDay），鍵永遠是 RESOURCE_DEFS 的 id，
 *  但仍照 core/world/state.ts 的 own-property 慣例讀取，避免資源 id 與 Object.prototype
 *  成員同名時讀到繼承值。 */
function snapshotValue(resources: Record<string, number>, id: string): number {
  return Object.prototype.hasOwnProperty.call(resources, id) ? resources[id] : 0;
}

/**
 * 最近一日的增減量＝最新快照 − 前一快照。歷史不足兩筆（尚未跨過一次日界）回傳 null，
 * 呼叫端應顯示為「無趨勢」而不是把 null 當 0 顯示（0 代表「有資料且沒變化」，語意不同）。
 */
export function dailyDelta(history: ResourceHistory, resourceId: string): number | null {
  const { snapshots } = history;
  if (snapshots.length < 2) return null;
  const latest = snapshots[snapshots.length - 1];
  const previous = snapshots[snapshots.length - 2];
  return snapshotValue(latest.resources, resourceId) - snapshotValue(previous.resources, resourceId);
}

// ---------------------------------------------------------------------------
// 人口診斷
// ---------------------------------------------------------------------------

export type PopulationDiagnosis =
  | { status: 'starving'; deficit: number }
  | { status: 'food-short'; shortfall: number }
  | { status: 'housing-full' }
  | { status: 'growing'; vacancies: number };

/**
 * 依 population.ts 的判斷順序與門檻（只讀當下 state，不修改任何東西）：
 * 1. needed > available → starving（今日界會餓死人）。
 * 2. remaining < reserveRequirement → food-short（撐得過今天，但存糧不足以觸發成長）。
 * 3. 所有住房皆無空位 → housing-full。
 * 4. 否則 → growing（下一次日界會新增居民，實際新增數仍受 growthPerDay 與空位數雙重上限，
 *    這裡的 vacancies 只回報「還有多少空位」，不是「下次會生幾個」）。
 */
export function diagnosePopulation(
  state: GameState,
  defs: BuildingDef[],
  config: PopulationConfig,
): PopulationDiagnosis {
  const available = getResource(state, 'food');
  const needed = state.citizens.length * config.foodPerCitizenPerDay;
  if (needed > available) {
    return { status: 'starving', deficit: needed - available };
  }

  const consumed = Math.min(needed, available);
  const remaining = available - consumed;
  const reserveRequirement =
    Math.max(1, state.citizens.length) * config.foodPerCitizenPerDay * config.growthFoodReserveDays;
  if (remaining < reserveRequirement) {
    return { status: 'food-short', shortfall: reserveRequirement - remaining };
  }

  const defsByType = new Map(defs.map((def) => [def.id, def]));
  let vacancies = 0;
  for (const b of state.buildings) {
    const housing = defsByType.get(b.type)?.housing ?? 0;
    if (housing <= 0) continue;
    const occupied = state.citizens.filter((c) => c.home === b.id).length;
    vacancies += Math.max(0, housing - occupied);
  }
  if (vacancies <= 0) {
    return { status: 'housing-full' };
  }
  return { status: 'growing', vacancies };
}
