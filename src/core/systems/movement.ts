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
// （阻擋格 blockedStamp、道路查詢表 roadQueryStamp 兩張表雖跨 tick 重用，但每 tick 換 generation
//  全數作廢；桶佇列的 scratch 也只是預先配置的記憶體，每次搜尋自帶 generation 作廢舊值——
//  三者都不帶任何上一 tick 的資訊，不構成跨 tick 記憶。）
//
// 每 tick 的決策（每位居民）：
//  1. 居民座標恆滿足「至多一軸為非整數」——不是站在格中心，就是正在單一軸上跨越相鄰兩格。
//  2. 站在格中心 (x,y 皆整數)：從居民格做有界帶權搜尋，走向已展開格中 Manhattan 距離最小的中繼目標。
//  3. 跨格途中：候選為該軸的兩個相鄰格中心 floor/ceil，取「剩餘距離 ＝ 到候選格的距離
//     ＋ 候選格到目標的步數」較小者。目標翻轉或前方被蓋樓時，本規則會讓居民就地折返，
//     不需要任何歷史資訊。
//  4. 位移一律限制在單一軸、且 clamp 到剩餘距離（不過衝）；剩餘 <= SPEED 時直接貼齊該格中心。
//     其餘情況以 SPEED 前進後正規化到 0.1 網格（round(v*10)/10），避免 0.1 反覆相加的累積誤差。
//  5. 有界搜尋展開到的所有格都未比目前格更接近目標時，才原地不動。
//
// 每次搜尋的工作量受 searchBudget 約束；搜尋結果只用於當次步進，不保留任何跨 tick 狀態。
//
// === 帶權尋路（M6-W3）===
// 步進成本：道路格 1、非道路格 K（data/roads.json 的 nonRoadStepCost，經 options.roads 注入）。
// 未注入時 K=1，所有格成本相同——Dial's 的每個成本層是 FIFO，settle 順序與原本的逐格 BFS 相同，
// 因此沒有道路設定的呼叫端行為零變化。道路只改成本、不改可通行性：路不通時照樣穿越非道路格
// （連通性強制是 M6-W4 的事）。
//
// 已知限制（尚待裁決，勿當成刻意行為）：上面第 3 條的跨格快路只比 Manhattan 距離、不看成本。
// 當最省成本的路線需要「連續多步遠離目標」才接得上道路時，格中心的帶權搜尋叫居民往外走、
// 跨格快路又把他拉回來，形成 0.1 幅度的來回振盪（重現：8×5 世界、home(0,2)→job(6,2)、
// y=0 一整排道路 → 居民卡在 y=1 與 y=0.9 之間）。單步繞路（例如繞過 1×1 建築）不受影響，
// 因為那時較近端點的下降出口本來就被建築擋住、快路不會生效。

import type { Bounds, Point } from '../path/astar';
import {
  bucketSearch,
  createBucketSearchScratch,
  type BucketSearchScratch,
} from '../path/bucketSearch';
import { footprintTiles } from '../world/occupancy';
import { hasRoad } from '../world/roads';
import type { BuildingDef } from '../../data/types';
import type { Building, Citizen, GameState } from '../world/state';
import type { System, SimContext } from '../sim/system';

/** 移動速度：格/tick */
const SPEED = 0.1;
/** 上半日／下半日分界：tickOfDay < 300 為上半日（朝 job 前進），否則下半日（朝 home 前進）。
 *  外部只有量測工具需要重建同一份目標判定（見 src/tools/movebench.ts），故對外公開。 */
export const UPPER_HALF_END = 300;
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

/**
 * 尋路工作量計數器（效能基線量測用，見 src/tools/movebench.ts）。
 * 由呼叫端建立並持有，movement 只累加；不傳就完全不寫入任何物件，也不影響任何行為。
 */
export interface MovementStats {
  /** boundedBestEffortRoute 的呼叫次數 */
  searchCalls: number;
  /** 上述呼叫累計「自佇列取出並展開」的節點數 */
  settledNodes: number;
}

/** 戳記表的 generation 上限（Uint32Array 值域）；超過即整陣列歸零重新計數。 */
const MAX_STAMP_GENERATION = 0xffffffff;

export function createMovementSystem(
  defs: BuildingDef[],
  bounds: Bounds,
  options?: { searchBudget?: number; stats?: MovementStats; roads?: { nonRoadStepCost: number } },
): System {
  const defsByType = new Map<string, BuildingDef>(defs.map((d) => [d.id, d]));
  const searchBudget = options?.searchBudget ?? DEFAULT_SEARCH_BUDGET;
  if (!Number.isFinite(searchBudget) || searchBudget < 1) {
    throw new Error(
      `createMovementSystem: searchBudget 必須是大於等於 1 的有限數，收到 ${String(searchBudget)}`,
    );
  }
  const stats = options?.stats;
  // 省略 roads 即 K=1：所有格同成本，等價於原本的無權重 BFS。
  const nonRoadStepCost = options?.roads?.nonRoadStepCost ?? 1;
  if (!Number.isInteger(nonRoadStepCost) || nonRoadStepCost < 1) {
    throw new Error(
      `createMovementSystem: roads.nonRoadStepCost 必須是大於等於 1 的整數，收到 ${String(nonRoadStepCost)}`,
    );
  }

  // 阻擋格以整數索引（index = y*w+x）記錄。陣列本身跨 tick 重用，但每 tick 換一個
  // generation 戳記，語義等同原本每 tick 重建的字串鍵 Set——不構成跨 tick 記憶。
  const tileCount =
    Number.isInteger(bounds.w) && Number.isInteger(bounds.h) && bounds.w > 0 && bounds.h > 0
      ? bounds.w * bounds.h
      : 0;
  const blockedStamp = new Uint32Array(tileCount);
  // 道路成本用「每 tick 查一次就記住」而不是每 tick 全表重建：roadQueryStamp 標本 tick 查過、
  // roadFlag 存結果。成本是 O(搜尋實際碰到的格) 而非 O(道路數)——200×200 全鋪路的世界有四萬把
  // 道路鍵，整表重建每 tick 要 6.7ms，比整個 movement 還貴；查表版只要 0.14ms。
  const roadQueryStamp = new Uint32Array(tileCount);
  const roadFlag = new Uint8Array(tileCount);
  let stampGeneration = 0;
  // 桶佇列的工作記憶體只配置一次；它每次搜尋都以自己的 generation 作廢舊值，
  // 跨 tick 重用的是記憶體而非資訊（與檔頭「無跨 tick 記憶」契約相容）。
  const scratch = tileCount > 0 ? createBucketSearchScratch(bounds.w, bounds.h) : undefined;

  return {
    id: 'movement',
    update(state: GameState, ctx: SimContext): void {
      stampGeneration += 1;
      if (stampGeneration > MAX_STAMP_GENERATION) {
        blockedStamp.fill(0);
        roadQueryStamp.fill(0);
        stampGeneration = 1;
      }
      // id → building 先建表，避免每位居民每 tick 對 buildings 線性搜尋；重複 id 保留先出現者
      // （與原本 state.buildings.find 的語義一致）。
      const buildingsById = new Map<string, Building>();
      for (const b of state.buildings) {
        if (!buildingsById.has(b.id)) buildingsById.set(b.id, b);
        const def = defsByType.get(b.type);
        const size = def ? def.size : { w: 1, h: 1 };
        for (const t of footprintTiles(b.x, b.y, size.w, size.h)) {
          // 界外 footprint 格直接丟棄：isBlocked 只會被已做界檢查的呼叫端查詢，
          // 而界外座標寫進線性索引會環繞誤標到別格。
          if (t.x < 0 || t.y < 0 || t.x >= bounds.w || t.y >= bounds.h) continue;
          blockedStamp[t.y * bounds.w + t.x] = stampGeneration;
        }
      }
      // 道路查詢只在本 tick 內記憶：戳記一換，鋪路／拆路下一 tick 即影響路徑。
      const roadStepCostAt = (index: number): number => {
        if (roadQueryStamp[index] !== stampGeneration) {
          roadQueryStamp[index] = stampGeneration;
          const x = index % bounds.w;
          roadFlag[index] = hasRoad(state, x, (index - x) / bounds.w) ? 1 : 0;
        }
        return roadFlag[index] === 1 ? 1 : nonRoadStepCost;
      };

      const search: SearchEnv = {
        bounds,
        isBlocked: (x, y) => blockedStamp[y * bounds.w + x] === stampGeneration,
        isBlockedIndex: (index) => blockedStamp[index] === stampGeneration,
        // K=1 時成本與道路無關，連查都不必查（未注入 roads 的呼叫端零額外開銷）。
        stepCostAt: nonRoadStepCost === 1 ? () => 1 : roadStepCostAt,
        maxStepCost: nonRoadStepCost,
        nodeLimit: searchBudget,
        scratch,
        stats,
      };

      const upperHalf = ctx.time.tickOfDay < UPPER_HALF_END;

      for (const citizen of state.citizens) {
        const targetId = upperHalf && citizen.job !== null ? citizen.job : citizen.home;
        const targetBuilding = buildingsById.get(targetId);
        if (!targetBuilding) continue; // home/job 懸空：本 tick 不動

        const target: Point = { x: targetBuilding.x, y: targetBuilding.y };
        if (citizen.x === target.x && citizen.y === target.y) continue; // 已在目標格：靜止

        const step = chooseStep(citizen, target, search);
        if (step === null) continue; // 無路可走：原地不動
        advance(citizen, step);
      }
    },
  };
}

/**
 * 一個 tick 內的搜尋環境：阻擋表、步進成本表、桶佇列 scratch 與預算。
 * 每 tick 重建（閉包綁在當期 generation 上），搜尋函式只借用不持有。
 */
interface SearchEnv {
  bounds: Bounds;
  isBlocked(x: number, y: number): boolean;
  isBlockedIndex(index: number): boolean;
  stepCostAt(index: number): number;
  /** 非道路格的步進成本 K；亦即 Dial's 的最大單步成本。 */
  maxStepCost: number;
  nodeLimit: number;
  scratch: BucketSearchScratch | undefined;
  stats: MovementStats | undefined;
}

/** 決定本 tick 的單軸位移目標格；無可行方向時回傳 null。純函數（只看座標、佈局、道路、目標）。 */
function chooseStep(citizen: Citizen, target: Point, search: SearchEnv): Step | null {
  const bounds = search.bounds;
  const canEnter = (x: number, y: number): boolean => {
    if (x < 0 || y < 0 || x >= bounds.w || y >= bounds.h) return false;
    // 目標格即使是建築也可走進去（與 distanceField 的 goal 語義一致）。
    return !search.isBlocked(x, y) || (x === target.x && y === target.y);
  };

  const onGridX = Number.isInteger(citizen.x);
  const onGridY = Number.isInteger(citizen.y);

  if (onGridX && onGridY) {
    // 從居民格做一次有界最佳努力搜尋，並直接重用搜尋時記下的第一步。
    const route = boundedBestEffortRoute({ x: citizen.x, y: citizen.y }, target, search);
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
    const route = boundedBestEffortRoute({ x, y }, target, search);
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
 * 從 start 做有界帶權搜尋（Dial's 桶佇列，見 core/path/bucketSearch.ts）。每個節點在鬆弛時就帶著
 * 最佳路徑的第一步與步數，選定中繼目標後不需回溯或重搜。
 * 中繼目標先比 Manhattan 距離，再依 astar.ts 的慣例以 (y, x) 字典序決勝——擂台只看距離不看成本，
 * 成本只決定「用哪條路走到它」。K=1 時 settle 順序與原本的逐格 BFS 完全相同。
 */
function boundedBestEffortRoute(start: Point, target: Point, search: SearchEnv): BestEffortRoute {
  const bounds = search.bounds;
  const startDistance = Math.abs(start.x - target.x) + Math.abs(start.y - target.y);
  // 界外（或非整數）目標不可能與任何界內索引相等，比照原本的 nx/ny 逐軸比對。
  const targetIndex =
    target.x >= 0 && target.y >= 0 && target.x < bounds.w && target.y < bounds.h
      ? target.y * bounds.w + target.x
      : -1;
  // 界外起點（只可能來自手改存檔：save 只驗座標絕對值上限，不驗 worldSize）：bucketSearch 對界外索引會 throw，
  // 一個壞居民不該讓整個 movement 中斷，改為原地不動。舊 BFS 在此情境會讓他走回界內，屬有意放棄的相容（Codex 第二審 M6-W3）。
  if (start.x < 0 || start.y < 0 || start.x >= bounds.w || start.y >= bounds.h) {
    return { next: null, pathLength: 0, remainingDistance: startDistance };
  }
  let bestFirstStep = -1;
  let bestHops = 0;
  let bestX = start.x;
  let bestY = start.y;
  let bestDistance = startDistance;

  const { settled } = bucketSearch(
    {
      width: bounds.w,
      height: bounds.h,
      startIndex: start.y * bounds.w + start.x,
      maxStepCost: search.maxStepCost,
      nodeLimit: search.nodeLimit,
      // 目標格即使是建築也可走進去（與 distanceField 的 goal 語義一致）。
      canEnter: (index) => index === targetIndex || !search.isBlockedIndex(index),
      stepCost: search.stepCostAt,
      onSettle: (index, _cost, hops, firstStepIndex) => {
        const x = index % bounds.w;
        const y = (index - x) / bounds.w;
        const distance = Math.abs(x - target.x) + Math.abs(y - target.y);
        const better =
          distance < bestDistance ||
          (distance === bestDistance && (y < bestY || (y === bestY && x < bestX)));
        if (better) {
          bestFirstStep = firstStepIndex;
          bestHops = hops;
          bestX = x;
          bestY = y;
          bestDistance = distance;
        }
        return bestDistance === 0;
      },
    },
    search.scratch,
  );

  if (search.stats !== undefined) {
    search.stats.searchCalls += 1;
    search.stats.settledNodes += settled;
  }

  if (bestDistance >= startDistance) {
    return { next: null, pathLength: 0, remainingDistance: startDistance };
  }
  const nextX = bestFirstStep % bounds.w;
  return {
    next: { x: nextX, y: (bestFirstStep - nextX) / bounds.w },
    pathLength: bestHops,
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
