// M3-T3 R1：網格尋路 A*（src/core/path/astar.ts）
//
// 規格缺口說明（本檔撰寫時的假設，未於簡報明文規定，若實作採不同假設會導致本檔測試失敗，
// 請先與簡報撰寫者確認，不要私自改測試斷言）：
// - 啟發函式假設為曼哈頓距離 |dx|+|dy|——4 向移動網格的標準/唯一合理選擇。
// - 「f 相同時先比 y 再比 x（小者優先）」為 open list 的排序鍵；因 (y,x) 唯一對應到一個格子，
//   此排序鍵在 f 相同時已是全序（不會再平手），故整個搜索過程（pop 順序、每格首次到達即定 parent、
//   同 g 不覆寫既有 parent）是決定論的——已用此假設手工推導出下列兩個 known-answer 路徑。
import { describe, expect, it } from 'vitest';
import { findPath } from '../../src/core/path/astar';

describe('findPath（R1）', () => {
  it('start === goal → 回傳只含該點的路徑 [start]', () => {
    const path = findPath({ x: 1, y: 1 }, { x: 1, y: 1 }, () => false, { w: 5, h: 5 });
    expect(path).toEqual([{ x: 1, y: 1 }]);
  });

  it('start === goal → 即使該格 isBlocked 仍回傳 [start]（規則不因 blocked 而例外）', () => {
    const path = findPath({ x: 1, y: 1 }, { x: 1, y: 1 }, () => true, { w: 5, h: 5 });
    expect(path).toEqual([{ x: 1, y: 1 }]);
  });

  it('start 越界（x=-1）→ null', () => {
    const path = findPath({ x: -1, y: 0 }, { x: 2, y: 2 }, () => false, { w: 3, h: 3 });
    expect(path).toBeNull();
  });

  it('goal 越界（x=w）→ null', () => {
    const path = findPath({ x: 0, y: 0 }, { x: 3, y: 0 }, () => false, { w: 3, h: 3 });
    expect(path).toBeNull();
  });

  it('goal 格即使 isBlocked 仍可作為終點（走進建築格）：直線可達時回傳直達路徑', () => {
    const isBlocked = (x: number, y: number) => x === 1 && y === 0;
    const path = findPath({ x: 0, y: 0 }, { x: 1, y: 0 }, isBlocked, { w: 2, h: 1 });
    expect(path).toEqual([
      { x: 0, y: 0 },
      { x: 1, y: 0 },
    ]);
  });

  it('中途格 blocked 且無法繞路（走廊 h=1）→ null', () => {
    const isBlocked = (x: number, y: number) => x === 1 && y === 0;
    const path = findPath({ x: 0, y: 0 }, { x: 2, y: 0 }, isBlocked, { w: 3, h: 1 });
    expect(path).toBeNull();
  });

  it('5×5 空地 (0,0)→(2,2)：known-answer 路徑鎖定 tie-break（f 相同先比 y 再比 x，小者優先）', () => {
    const path = findPath({ x: 0, y: 0 }, { x: 2, y: 2 }, () => false, { w: 5, h: 5 });
    expect(path).toEqual([
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 2, y: 0 },
      { x: 2, y: 1 },
      { x: 2, y: 2 },
    ]);
  });

  it('5×5，(2,0) blocked，(0,0)→(4,0)：known-answer 繞路路徑鎖定 tie-break', () => {
    const isBlocked = (x: number, y: number) => x === 2 && y === 0;
    const path = findPath({ x: 0, y: 0 }, { x: 4, y: 0 }, isBlocked, { w: 5, h: 5 });
    expect(path).toEqual([
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 2, y: 1 },
      { x: 3, y: 1 },
      { x: 3, y: 0 },
      { x: 4, y: 0 },
    ]);
  });
});
