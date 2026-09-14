import { describe, expect, it } from 'vitest';
import { bucketSearch, createBucketSearchScratch } from '../../src/core/path/bucketSearch';
import { createRng } from '../../src/core/sim/rng';
import { legacyRoute, type LegacyPop } from './helpers/legacyRoute';

const MAP_COUNT = 400;
const MASTER_SEED = 0x6d330001;
const LIMITS = [16, 64, 512, Infinity];

function createMaps() {
  const seeds = createRng(MASTER_SEED);
  return Array.from({ length: MAP_COUNT }, () => {
    const seed = seeds.nextInt(0, 0xffffffff);
    const rng = createRng(seed);
    const width = rng.nextInt(8, 64);
    const height = rng.nextInt(8, 64);
    const density = rng.next() * 0.45;
    const blocked = Uint8Array.from({ length: width * height }, () => rng.next() < density ? 1 : 0);
    const startIndex = rng.nextInt(0, blocked.length - 1);
    blocked[startIndex] = 0;
    const nodeLimit = LIMITS[rng.nextInt(0, LIMITS.length - 1)];
    const targetIndex = rng.nextInt(0, blocked.length - 1);
    return { seed, width, height, density, blocked, startIndex, nodeLimit, targetIndex };
  });
}

const maps = createMaps();
type TestMap = typeof maps[number];

function context(map: TestMap): string {
  return `masterSeed=${MASTER_SEED} seed=${map.seed} size=${map.width}x${map.height} nodeLimit=${map.nodeLimit}`;
}

function search(map: TestMap, step: number, targetIndex = -1) {
  const pops: LegacyPop[] = [];
  const costs: number[] = [];
  const stats = bucketSearch({
    width: map.width,
    height: map.height,
    startIndex: map.startIndex,
    maxStepCost: step,
    nodeLimit: map.nodeLimit,
    canEnter: (index) => index === targetIndex || map.blocked[index] === 0,
    stepCost: () => step,
    onSettle(index, cost, hops, firstStepIndex) {
      pops.push({ index, hops, firstStepIndex });
      costs.push(cost);
      return index === targetIndex;
    },
  }, createBucketSearchScratch(map.width, map.height));
  return { pops, costs, stats };
}

function oracle(map: TestMap, target = { x: map.width, y: map.height }): LegacyPop[] {
  return legacyRoute(
    { x: map.startIndex % map.width, y: Math.floor(map.startIndex / map.width) },
    target,
    (x, y) => map.blocked[y * map.width + x] !== 0,
    { w: map.width, h: map.height },
    map.nodeLimit,
  );
}

describe('bucketSearch 與 51c328b BFS 等價性', () => {
  it('400 張固定 seed 隨機地圖：K=1 的每個 index/hops/firstStepIndex 逐項相同', () => {
    const started = performance.now();
    let mismatch = 0;
    let compared = 0;
    for (const map of maps) {
      const actual = search(map, 1);
      // 界外目標不可到達，完整比對預算內的所有 pop，而非只比通往某個目標的前綴。
      const expected = oracle(map);
      try {
        expect(actual.pops, context(map)).toEqual(expected);
        expect(actual.costs, context(map)).toEqual(expected.map((p) => p.hops));
        expect(actual.stats, context(map)).toEqual({ settled: expected.length, discovered: expected.length });
      } catch (error) {
        mismatch++;
        console.error(`K=1 mismatch ${context(map)}`);
        throw error;
      }
      compared += expected.length;
    }
    expect(maps).toHaveLength(400);
    expect(mismatch).toBe(0);
    console.log(`400 maps K=1 mismatch=${mismatch}, compared=${compared}, elapsed=${(performance.now() - started).toFixed(1)}ms`);
  }, 5000);

  it('同一批 400 張地圖：無道路 K=3 的 settle 集合與逐節點 hops 與 K=1 相同', () => {
    const started = performance.now();
    for (const map of maps) {
      const unit = search(map, 1);
      const triple = search(map, 3);
      const byIndex = (pops: LegacyPop[]) => pops.map(({ index, hops }) => ({ index, hops }))
        .sort((a, b) => a.index - b.index);
      expect(byIndex(triple.pops), context(map)).toEqual(byIndex(unit.pops));
      expect(triple.costs, context(map)).toEqual(triple.pops.map((p) => p.hops * 3));
      expect(triple.stats, context(map)).toEqual(unit.stats);
    }
    console.log(`400 maps K=3 set/hops mismatch=0, elapsed=${(performance.now() - started).toFixed(1)}ms`);
  }, 5000);

  it('同一批地圖的隨機目標：保留 BFS 目標格通行例外與提前停止序列', () => {
    for (const map of maps) {
      const target = { x: map.targetIndex % map.width, y: Math.floor(map.targetIndex / map.width) };
      expect(search(map, 1, map.targetIndex).pops, context(map)).toEqual(oracle(map, target));
    }
  }, 5000);
});
