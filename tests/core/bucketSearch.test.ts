import { describe, expect, it } from 'vitest';
import {
  bucketSearch,
  createBucketSearchScratch,
  type BucketSearchInput,
  type BucketSearchScratch,
} from '../../src/core/path/bucketSearch';

interface Pop {
  index: number;
  cost: number;
  hops: number;
  firstStepIndex: number;
}

function run(overrides: Partial<BucketSearchInput> = {}, scratch?: BucketSearchScratch) {
  const pops: Pop[] = [];
  const result = bucketSearch({
    width: 3,
    height: 3,
    startIndex: 4,
    maxStepCost: 1,
    nodeLimit: Infinity,
    canEnter: () => true,
    stepCost: () => 1,
    ...overrides,
    onSettle(index, cost, hops, firstStepIndex) {
      pops.push({ index, cost, hops, firstStepIndex });
      return overrides.onSettle?.(index, cost, hops, firstStepIndex) ?? false;
    },
  }, scratch);
  return { pops, ...result };
}

describe('bucketSearch', () => {
  it('起點與上右下左 FIFO；等成本保留首次發現的第一步', () => {
    const { pops, settled, discovered } = run();
    expect(pops).toEqual([
      { index: 4, cost: 0, hops: 0, firstStepIndex: -1 },
      { index: 1, cost: 1, hops: 1, firstStepIndex: 1 },
      { index: 5, cost: 1, hops: 1, firstStepIndex: 5 },
      { index: 7, cost: 1, hops: 1, firstStepIndex: 7 },
      { index: 3, cost: 1, hops: 1, firstStepIndex: 3 },
      { index: 2, cost: 2, hops: 2, firstStepIndex: 1 },
      { index: 0, cost: 2, hops: 2, firstStepIndex: 1 },
      { index: 8, cost: 2, hops: 2, firstStepIndex: 5 },
      { index: 6, cost: 2, hops: 2, firstStepIndex: 7 },
    ]);
    expect({ settled, discovered }).toEqual({ settled: 9, discovered: 9 });
  });

  it('障礙繞行且不把左右邊界接起來', () => {
    const { pops } = run({ startIndex: 7, canEnter: (index) => index !== 4 });
    expect(pops.map((p) => p.index)).toEqual([7, 8, 6, 5, 3, 2, 0, 1]);
    expect(pops.at(-1)).toEqual({ index: 1, cost: 4, hops: 4, firstStepIndex: 8 });
  });

  it('K=3 繞道路六步成本 8，比直走四步成本 12 便宜', () => {
    const { pops } = run({
      width: 5, height: 2, startIndex: 5, maxStepCost: 3,
      stepCost: (index) => index < 5 ? 1 : 3,
    });
    expect(pops.find((p) => p.index === 9)).toEqual({
      index: 9, cost: 8, hops: 6, firstStepIndex: 0,
    });
    expect(pops.map((p) => p.cost)).toEqual([...pops.map((p) => p.cost)].sort((a, b) => a - b));
  });

  it('嚴格降成本更新第一步，過期桶項不重複 settle 或計入 discovered', () => {
    // 固定目的格成本不會產生降成本鬆弛；此合成 callback 模擬不同入邊成本以覆蓋防禦分支。
    let targetEntries = 0;
    const { pops, settled, discovered } = run({
      startIndex: 0, maxStepCost: 9,
      canEnter: (index) => index !== 4,
      stepCost: (index) => index === 1 && ++targetEntries === 1 ? 9 : 1,
    });
    expect(pops.map((p) => p.index)).toEqual([0, 3, 6, 7, 8, 5, 2, 1]);
    expect(pops.at(-1)).toEqual({ index: 1, cost: 7, hops: 7, firstStepIndex: 3 });
    expect({ settled, discovered }).toEqual({ settled: 8, discovered: 8 });
  });

  it.each([1, 2, 3, 4, 5, 6])('nodeLimit=%i 計算發現數且排入者仍全部 settle', (nodeLimit) => {
    const { pops, settled, discovered } = run({ nodeLimit });
    expect(pops).toEqual(run().pops.slice(0, nodeLimit));
    expect({ settled, discovered }).toEqual({ settled: nodeLimit, discovered: nodeLimit });
  });

  it('預算在障礙與越界檢查之前截斷，並沿用 BFS 的向下取整', () => {
    let entries = 0;
    const result = run({ nodeLimit: 2.9, canEnter: () => { entries++; return true; } });
    expect(entries).toBe(1);
    expect(result.discovered).toBe(2);
    expect(result.settled).toBe(2);
  });

  it('onSettle 回 true 立即停止，回報已發現數可大於 settle 數', () => {
    const result = run({ onSettle: (index) => index === 1 });
    expect(result.pops).toEqual(run().pops.slice(0, 2));
    expect(result.settled).toBe(2);
    expect(result.discovered).toBe(5);
    expect(run({ onSettle: () => true }).discovered).toBe(1);
  });

  it('單格或完全被包圍時只 settle 起點，不查起點通行或成本', () => {
    const fail = () => { throw new Error('不應查詢'); };
    expect(run({ width: 1, height: 1, startIndex: 0, canEnter: fail, stepCost: fail }).settled).toBe(1);
    expect(run({ canEnter: () => false, stepCost: fail }).settled).toBe(1);
  });

  it.each([0, -1, 4, 1.5, NaN, Infinity])('stepCost=%s 不在整數 [1,K] 時 throw', (cost) => {
    expect(() => run({ maxStepCost: 3, stepCost: () => cost })).toThrow(/stepCost/);
  });

  it('scratch 尺寸不同時 throw，即使總格數相同', () => {
    expect(() => run({}, createBucketSearchScratch(1, 9))).toThrow(/scratch/);
  });

  it('重用 scratch 結果相同，提前停止與切換 K 不殘留佇列或標籤', () => {
    const scratch = createBucketSearchScratch(3, 3);
    const first = run({}, scratch);
    const arrays = [scratch.dist, scratch.hops, scratch.firstSteps, scratch.stamps, scratch.buckets[0]];
    run({ onSettle: (index) => index === 1 }, scratch);
    run({ maxStepCost: 3, stepCost: () => 3 }, scratch);
    expect(run({}, scratch)).toEqual(first);
    expect(scratch.generation).toBe(4);
    [scratch.dist, scratch.hops, scratch.firstSteps, scratch.stamps, scratch.buckets[0]]
      .forEach((array, i) => expect(array).toBe(arrays[i]));
  });

  it('callback 丟錯後 scratch 仍可重用', () => {
    const scratch = createBucketSearchScratch(3, 3);
    expect(() => run({ canEnter: () => { throw new Error('中止'); } }, scratch)).toThrow('中止');
    expect(run({}, scratch)).toEqual(run());
  });

  it('generation 溢位後清戳記，不誤認舊世代', () => {
    const scratch = createBucketSearchScratch(3, 3);
    const first = run({}, scratch);
    scratch.generation = 0xffffffff;
    expect(run({}, scratch)).toEqual(first);
    expect(scratch.generation).toBe(1);
  });
});
