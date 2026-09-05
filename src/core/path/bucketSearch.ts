// Dial's 適合小整數正權重：pop 成本 d 後，佇列鍵落在 [d, d+K]，故 K+1 個循環桶足夠。
// 每桶 FIFO、上右下左展開、發現時計入預算，使 K=1 的 settle 順序與 BFS 逐格相同。
// 僅嚴格降成本才重入桶；舊項成本不再等於 dist 時略過。正權重保證有效 pop 已是最終成本，
// 因此 lazy deletion 不會漏掉最短路徑，也不會把過期項重複算成 settle。

export interface BucketSearchInput {
  width: number;
  height: number;
  startIndex: number;
  maxStepCost: number;
  /** 已發現節點預算，含起點；Infinity 表示不限。 */
  nodeLimit: number;
  canEnter(index: number): boolean;
  stepCost(index: number): number;
  /** 每個有效 pop 呼叫一次；回 true 時不再展開該節點。 */
  onSettle(index: number, cost: number, hops: number, firstStepIndex: number): boolean;
}

/** 同一 scratch 不可供巢狀搜尋同時使用；桶保留歷次容量，只有 head/tail 歸零。 */
export interface BucketSearchScratch {
  readonly width: number;
  readonly height: number;
  readonly dist: Int32Array;
  readonly hops: Int32Array;
  readonly firstSteps: Int32Array;
  readonly stamps: Uint32Array;
  generation: number;
  readonly buckets: number[][];
  readonly heads: number[];
  readonly tails: number[];
}

const MAX_INT32 = 0x7fffffff;
const STEP_OFFSETS: ReadonlyArray<readonly [number, number]> = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
];

function gridSize(width: number, height: number): number {
  if (!Number.isInteger(width) || !Number.isInteger(height) ||
      width < 1 || height < 1 || width * height > MAX_INT32) {
    throw new Error('bucketSearch: width/height 必須為正整數且格數不可超過 Int32 範圍');
  }
  return width * height;
}

export function createBucketSearchScratch(width: number, height: number): BucketSearchScratch {
  const size = gridSize(width, height);
  return {
    width,
    height,
    dist: new Int32Array(size),
    hops: new Int32Array(size),
    firstSteps: new Int32Array(size),
    stamps: new Uint32Array(size),
    generation: 0,
    buckets: [],
    heads: [],
    tails: [],
  };
}

export function bucketSearch(
  input: BucketSearchInput,
  scratch?: BucketSearchScratch,
): { settled: number; discovered: number } {
  const { width, height, startIndex, maxStepCost, canEnter, stepCost, onSettle } = input;
  const size = gridSize(width, height);
  if (scratch && (scratch.width !== width || scratch.height !== height)) {
    throw new Error('bucketSearch: scratch 尺寸與 width/height 不符');
  }
  if (!Number.isInteger(startIndex) || startIndex < 0 || startIndex >= size) {
    throw new Error('bucketSearch: startIndex 必須為界內整數索引');
  }
  if (!Number.isInteger(maxStepCost) || maxStepCost < 1 || maxStepCost >= MAX_INT32) {
    throw new Error('bucketSearch: maxStepCost 必須為正整數且 K+1 不可超過 Int32 範圍');
  }
  if (!(input.nodeLimit >= 1)) {
    throw new Error('bucketSearch: nodeLimit 必須大於等於 1');
  }
  const nodeLimit = Math.floor(input.nodeLimit);
  const work = scratch ?? createBucketSearchScratch(width, height);
  const { dist, hops, firstSteps, stamps, buckets, heads, tails } = work;
  work.generation = (work.generation + 1) >>> 0;
  // Uint32 戳記繞回時才清一次，避免舊世代被誤認為本次發現。
  if (work.generation === 0) {
    stamps.fill(0);
    work.generation = 1;
  }
  const generation = work.generation;
  const bucketCount = maxStepCost + 1;
  for (let i = 0; i < bucketCount; i++) {
    buckets[i] ??= [];
    heads[i] = 0;
    tails[i] = 0;
  }
  stamps[startIndex] = generation;
  dist[startIndex] = 0;
  hops[startIndex] = 0;
  firstSteps[startIndex] = -1;
  // 相鄰兩個數存 index/cost，避免每次入桶配置物件。
  buckets[0][0] = startIndex;
  buckets[0][1] = 0;
  tails[0] = 2;
  let pending = 1;
  let cost = 0;
  let settled = 0;
  let discovered = 1;

  while (pending > 0) {
    const slot = cost % bucketCount;
    if (heads[slot] === tails[slot]) {
      cost++;
      continue;
    }
    const bucket = buckets[slot];
    const index = bucket[heads[slot]++];
    const queuedCost = bucket[heads[slot]++];
    pending--;
    if (queuedCost !== dist[index]) continue;
    settled++;
    if (onSettle(index, queuedCost, hops[index], firstSteps[index])) break;
    const x = index % width;
    const y = (index - x) / width;
    for (const [dx, dy] of STEP_OFFSETS) {
      // 與舊 BFS 同位置：耗盡發現預算後仍 pop 已排入的節點，但不再展開鄰格。
      if (discovered >= nodeLimit) break;
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const neighborIndex = ny * width + nx;
      if (!canEnter(neighborIndex)) continue;
      const step = stepCost(neighborIndex);
      if (!Number.isInteger(step) || step < 1 || step > maxStepCost) {
        throw new Error(`bucketSearch: stepCost(${neighborIndex}) 必須為 [1, K] 內整數，收到 ${step}`);
      }
      const nextCost = queuedCost + step;
      const known = stamps[neighborIndex] === generation;
      if (known && nextCost >= dist[neighborIndex]) continue;
      if (nextCost > MAX_INT32) {
        throw new Error('bucketSearch: 路徑成本超過 Int32 範圍');
      }
      if (!known) {
        stamps[neighborIndex] = generation;
        discovered++;
      }
      dist[neighborIndex] = nextCost;
      hops[neighborIndex] = hops[index] + 1;
      firstSteps[neighborIndex] = index === startIndex ? neighborIndex : firstSteps[index];
      const nextSlot = nextCost % bucketCount;
      buckets[nextSlot][tails[nextSlot]++] = neighborIndex;
      buckets[nextSlot][tails[nextSlot]++] = nextCost;
      pending++;
    }
  }
  return { settled, discovered };
}
