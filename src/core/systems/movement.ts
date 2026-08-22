// 居民移動 system：依日夜週期在 home/job 間往返，沿最短路徑逐格移動。
//
// 目標選擇（M3-T3 契約）：上半日（tickOfDay < UPPER_HALF_END）且有工作 → 目標為 job 建築格；
// 上半日但無工作、或下半日 → 目標為 home 建築格。home/job 指向的建築找不到時，本 tick 不動。
//
// 阻擋：所有建築 footprint 格皆視為阻擋，但 distanceField 內建「goal 格永遠可走」語義，
// 使居民自己的目標格不因是建築而擋住終點——不需在此另外排除目標建築。
//
// === 步進模型（M3-W2 重工；F1/F2/F3/F7 裁決）===
// 本 system **無任何跨 tick 記憶**：update 的結果是 (state, ctx.time) 的純函數，
// 所有推進資訊都能從 citizen.x/y 完全重建。因此
//   - 建築佈局變動（蓋樓/拆樓）下一 tick 即生效，不可能沿著失效路徑穿牆；
//   - serialize → deserialize → 續跑，與連續跑產出完全相同的 state；
//   - 沒有任何以 citizen.id 為鍵的快取，居民死亡也不會殘留記憶體。
//
// 每 tick 的決策（每位居民）：
//  1. 居民座標恆滿足「至多一軸為非整數」——不是站在格中心，就是正在單一軸上跨越相鄰兩格。
//  2. 站在格中心 (x,y 皆整數)：從居民格做有界 BFS，走向已展開格中 Manhattan 距離最小的中繼目標。
//  3. 跨格途中：候選為該軸的兩個相鄰格中心 floor/ceil，取「剩餘距離 ＝ 到候選格的距離
//     ＋ 候選格到目標的步數」較小者。目標翻轉或前方被蓋樓時，本規則會讓居民就地折返，
//     不需要任何歷史資訊。
//  4. 位移一律限制在單一軸、且 clamp 到剩餘距離（不過衝）；剩餘 <= SPEED 時直接貼齊該格中心。
//     其餘情況以 SPEED 前進後正規化到 0.1 網格（round(v*10)/10），避免 0.1 反覆相加的累積誤差。
//  5. 有界 BFS 展開到的所有格都未比目前格更接近目標時，才原地不動。
//
// 每次 BFS 的工作量受 searchBudget 約束；搜尋結果只用於當次步進，不保留任何跨 tick 狀態。

import type { Bounds, Point } from '../path/astar';
import { footprintTiles } from '../world/occupancy';
import type { BuildingDef } from '../../data/types';
import type { Building, Citizen, GameState } from '../world/state';
import type { System, SimContext } from '../sim/system';

/** 移動速度：格/tick */
const SPEED = 0.1;
/** 上半日／下半日分界：tickOfDay < 300 為上半日（朝 job 前進），否則下半日（朝 home 前進）。 */
const UPPER_HALF_END = 300;
/** 座標正規化網格：所有座標皆為 0.1 的整數倍 */
const COORD_SCALE = 10;
/** 浮點比較容差：座標已正規化到 0.1 網格，1e-9 足以吸收殘留誤差且遠小於半步 */
const EPSILON = 1e-9;
/** 每個不同目標、每 tick 的距離場最多涵蓋格數。 */
const DEFAULT_SEARCH_BUDGET = 512;

/** 4 鄰格掃描順序（與 astar 的 NEIGHBOR_OFFSETS 一致）：上、右、下、左；距離平手時取先掃到者。 */
const STEP_OFFSETS: ReadonlyArray<readonly [number, number]> = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
];

/** 本 tick 的單軸位移：沿 axis 走到座標 to（to 恆為整數格中心座標） */
interface Step {
  axis: 'x' | 'y';
  to: number;
}

export function createMovementSystem(
  defs: BuildingDef[],
  bounds: Bounds,
  options?: { searchBudget?: number },
): System {
  const defsByType = new Map<string, BuildingDef>(defs.map((d) => [d.id, d]));
  const searchBudget = options?.searchBudget ?? DEFAULT_SEARCH_BUDGET;
  if (!Number.isFinite(searchBudget) || searchBudget < 1) {
    throw new Error(
      `createMovementSystem: searchBudget 必須是大於等於 1 的有限數，收到 ${String(searchBudget)}`,
    );
  }

  return {
    id: 'movement',
    update(state: GameState, ctx: SimContext): void {
      const blocked = new Set<string>();
      // id → building 先建表，避免每位居民每 tick 對 buildings 線性搜尋；重複 id 保留先出現者
      // （與原本 state.buildings.find 的語義一致）。
      const buildingsById = new Map<string, Building>();
      for (const b of state.buildings) {
        if (!buildingsById.has(b.id)) buildingsById.set(b.id, b);
        const def = defsByType.get(b.type);
        const size = def ? def.size : { w: 1, h: 1 };
        for (const t of footprintTiles(b.x, b.y, size.w, size.h)) {
          blocked.add(`${t.x},${t.y}`);
        }
      }
      const isBlocked = (x: number, y: number): boolean => blocked.has(`${x},${y}`);

      const upperHalf = ctx.time.tickOfDay < UPPER_HALF_END;

      for (const citizen of state.citizens) {
        const targetId = upperHalf && citizen.job !== null ? citizen.job : citizen.home;
        const targetBuilding = buildingsById.get(targetId);
        if (!targetBuilding) continue; // home/job 懸空：本 tick 不動

        const target: Point = { x: targetBuilding.x, y: targetBuilding.y };
        if (citizen.x === target.x && citizen.y === target.y) continue; // 已在目標格：靜止

        const step = chooseStep(citizen, target, isBlocked, bounds, searchBudget);
        if (step === null) continue; // 無路可走：原地不動
        advance(citizen, step);
      }
    },
  };
}

/** 決定本 tick 的單軸位移目標格；無可行方向時回傳 null。純函數（只看座標、佈局、目標）。 */
function chooseStep(
  citizen: Citizen,
  target: Point,
  isBlocked: (x: number, y: number) => boolean,
  bounds: Bounds,
  searchBudget: number,
): Step | null {
  const canEnter = (x: number, y: number): boolean => {
    if (x < 0 || y < 0 || x >= bounds.w || y >= bounds.h) return false;
    // 目標格即使是建築也可走進去（與 distanceField 的 goal 語義一致）。
    return !isBlocked(x, y) || (x === target.x && y === target.y);
  };

  const onGridX = Number.isInteger(citizen.x);
  const onGridY = Number.isInteger(citizen.y);

  if (onGridX && onGridY) {
    // 從居民格做一次有界最佳努力搜尋，並直接重用搜尋時記下的第一步。
    const route = boundedBestEffortRoute(
      { x: citizen.x, y: citizen.y },
      target,
      isBlocked,
      bounds,
      searchBudget,
    );
    if (route.next === null) return null;
    return route.next.x !== citizen.x
      ? { axis: 'x', to: route.next.x }
      : { axis: 'y', to: route.next.y };
  }

  // 跨格途中：先解掉非整數的那一軸（兩軸皆非整數只會來自損毀存檔，另一軸暫以四捨五入格參與
  // 距離查詢，待本軸對齊後下一 tick 自然會再解另一軸）。
  const axis: 'x' | 'y' = onGridX ? 'y' : 'x';
  const moving = axis === 'x' ? citizen.x : citizen.y;
  const fixed = axis === 'x' ? Math.round(citizen.y) : Math.round(citizen.x);
  const lo = Math.floor(moving);
  const hi = Math.ceil(moving);

  const pointAt = (cell: number): Point => ({
    x: axis === 'x' ? cell : fixed,
    y: axis === 'x' ? fixed : cell,
  });
  const canEnterPoint = (point: Point): boolean => canEnter(point.x, point.y);
  const distanceToTarget = (point: Point): number =>
    Math.abs(point.x - target.x) + Math.abs(point.y - target.y);
  const hasCloserExit = (point: Point): boolean => {
    const currentDistance = distanceToTarget(point);
    for (const [dx, dy] of STEP_OFFSETS) {
      const next = { x: point.x + dx, y: point.y + dy };
      if (canEnterPoint(next) && distanceToTarget(next) < currentDistance) return true;
    }
    return false;
  };

  const loPoint = pointAt(lo);
  const hiPoint = pointAt(hi);
  const loDistance = distanceToTarget(loPoint);
  const hiDistance = distanceToTarget(hiPoint);
  const preferred = loDistance <= hiDistance ? lo : hi;
  const preferredPoint = preferred === lo ? loPoint : hiPoint;
  // 開闊路段直接走完已開始的跨格；若較近端沒有繼續下降的出口，才用有界搜尋判斷繞路／折返。
  if (canEnterPoint(preferredPoint) && hasCloserExit(preferredPoint)) return { axis, to: preferred };

  const costOf = (cell: number): number => {
    const x = axis === 'x' ? cell : fixed;
    const y = axis === 'x' ? fixed : cell;
    if (!canEnter(x, y)) return Infinity;
    const route = boundedBestEffortRoute({ x, y }, target, isBlocked, bounds, searchBudget);
    return Math.abs(moving - cell) + route.pathLength + route.remainingDistance;
  };

  const costLo = costOf(lo);
  const costHi = costOf(hi);
  if (costLo === Infinity && costHi === Infinity) return null;
  // 平手取座標較小的端點，維持決定論。
  return { axis, to: costLo <= costHi ? lo : hi };
}

interface BestEffortRoute {
  /** 從 start 沿最佳路徑前進的第一格；沒有任何更接近目標的已展開格時為 null。 */
  next: Point | null;
  /** start 到本次選定中繼目標的最佳路徑長度。 */
  pathLength: number;
  /** 本次選定中繼目標到最終 target 的 Manhattan 距離。 */
  remainingDistance: number;
}

/**
 * 從 start 做有界 BFS。每個節點在首次發現時就帶著最佳路徑的第一步，選定中繼目標後不需回溯或重搜。
 * 中繼目標先比 Manhattan 距離，再依 astar.ts 的慣例以 (y, x) 字典序決勝。
 */
function boundedBestEffortRoute(
  start: Point,
  target: Point,
  isBlocked: (x: number, y: number) => boolean,
  bounds: Bounds,
  maxNodes: number,
): BestEffortRoute {
  const startDistance = Math.abs(start.x - target.x) + Math.abs(start.y - target.y);
  const nodeLimit = Math.floor(maxNodes);
  const startIndex = start.y * bounds.w + start.x;
  const queue: number[] = [startIndex];
  const firstSteps: number[] = [startIndex];
  const pathLengths: number[] = [0];
  const visited = new Set<number>([startIndex]);
  let bestQueueIndex = 0;
  let bestX = start.x;
  let bestY = start.y;
  let bestDistance = startDistance;

  for (let head = 0; head < queue.length; head++) {
    const index = queue[head];
    const x = index % bounds.w;
    const y = (index - x) / bounds.w;
    const distance = Math.abs(x - target.x) + Math.abs(y - target.y);
    const better =
      distance < bestDistance ||
      (distance === bestDistance && (y < bestY || (y === bestY && x < bestX)));
    if (better) {
      bestQueueIndex = head;
      bestX = x;
      bestY = y;
      bestDistance = distance;
    }
    if (bestDistance === 0) break;

    for (const [dx, dy] of STEP_OFFSETS) {
      if (visited.size >= nodeLimit) break;
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= bounds.w || ny >= bounds.h) continue;
      const neighborIndex = ny * bounds.w + nx;
      if (visited.has(neighborIndex)) continue;
      const isTarget = nx === target.x && ny === target.y;
      if (!isTarget && isBlocked(nx, ny)) continue;
      visited.add(neighborIndex);
      queue.push(neighborIndex);
      firstSteps.push(head === 0 ? neighborIndex : firstSteps[head]);
      pathLengths.push(pathLengths[head] + 1);
    }
  }

  if (bestDistance >= startDistance) {
    return { next: null, pathLength: 0, remainingDistance: startDistance };
  }
  const firstIndex = firstSteps[bestQueueIndex];
  const nextX = firstIndex % bounds.w;
  return {
    next: { x: nextX, y: (firstIndex - nextX) / bounds.w },
    pathLength: pathLengths[bestQueueIndex],
    remainingDistance: bestDistance,
  };
}

/** 沿單一軸前進：剩餘距離 <= SPEED 時直接貼齊目標格中心，否則前進 SPEED 後正規化到 0.1 網格。 */
function advance(citizen: Citizen, step: Step): void {
  const from = step.axis === 'x' ? citizen.x : citizen.y;
  const remaining = step.to - from;
  const next =
    Math.abs(remaining) <= SPEED + EPSILON
      ? step.to
      : Math.round((from + Math.sign(remaining) * SPEED) * COORD_SCALE) / COORD_SCALE;
  if (step.axis === 'x') {
    citizen.x = next;
  } else {
    citizen.y = next;
  }
}
