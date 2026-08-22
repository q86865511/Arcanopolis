// M3.9-W3 R1：distanceField 有界搜尋（src/core/path/astar.ts）
//
// 動機：現行 distanceField 是無界反向 BFS，12×12 地圖很快，但 1000×1000 就是每次呼叫掃
// 100 萬格——地圖放大的最後關卡之一。本檔鎖定「加一個可選的搜尋預算」的行為契約。
//
// 鎖定的 API 形狀（本檔測試假設，實作必須遵守；若與此不符請先與規格撰寫者確認，不要改測試）：
//   distanceField(goal: Point, isBlocked: IsBlocked, bounds: Bounds, maxNodes?: number): DistanceField
// - maxNodes 省略 → 行為與現行無界版本完全相同（向後相容，不影響任何既有呼叫端／測試）。
// - maxNodes 提供時：BFS 只擴散到「被賦予距離值的格子累計數量」達到 maxNodes 為止即停止
//   （goal 本身即為第 1 個計數格）。budget 用盡後仍未被賦予距離值的格子，get() 回傳 null——
//   與「越界」「真正不可達」共用同一個 null 語義，呼叫端本就要處理 null。
// - budget 用盡不 throw，只是提前停止；純函數，同輸入同輸出，無跨呼叫殘留狀態，不涉及 rng
//   （函式簽章本身不接受 rng/ctx，此性質由型別保證，不另外用假 rng 驗證）。
//
// R1(d) 的「展開節點數不超過預算」用計數探針驗證（包一層計次的 isBlocked），
// 不直接列舉 1000×1000 全圖（那樣本身就會拖慢測試套件，違反「單一測試 < 3 秒」的要求）。
import { describe, expect, it } from 'vitest';
import { distanceField } from '../../src/core/path/astar';
import type { Bounds, IsBlocked, Point } from '../../src/core/path/astar';

describe('distanceField 有界搜尋（R1）', () => {
  describe('(a) 預算充足時與無界版本逐格相同', () => {
    it('10×10 地圖、含障礙物：maxNodes 足夠涵蓋全部可達格 → 每一格結果與無界版本相同', () => {
      const bounds: Bounds = { w: 10, h: 10 };
      const goal: Point = { x: 5, y: 5 };
      // 障礙物：一道帶缺口的牆，製造繞路，確保 BFS 順序與形狀不平凡
      const isBlocked: IsBlocked = (x, y) => x === 5 && y >= 2 && y <= 8 && y !== 5;

      const unbounded = distanceField(goal, isBlocked, bounds);
      const bounded = distanceField(goal, isBlocked, bounds, 200); // 200 > 100 格，預算絕對足夠

      for (let y = 0; y < bounds.h; y++) {
        for (let x = 0; x < bounds.w; x++) {
          expect(bounded.get(x, y)).toBe(unbounded.get(x, y));
        }
      }
    });

    it('開闊地圖：maxNodes 剛好等於可達格數 → 仍與無界版本逐格相同（邊界值）', () => {
      const bounds: Bounds = { w: 4, h: 4 };
      const goal: Point = { x: 0, y: 0 };
      const isBlocked: IsBlocked = () => false;

      const unbounded = distanceField(goal, isBlocked, bounds);
      const bounded = distanceField(goal, isBlocked, bounds, 16); // 4*4 = 16 格全部可達

      for (let y = 0; y < bounds.h; y++) {
        for (let x = 0; x < bounds.w; x++) {
          expect(bounded.get(x, y)).toBe(unbounded.get(x, y));
        }
      }
    });
  });

  describe('(b) 預算耗盡：不 throw，未涵蓋的格子回傳 null', () => {
    it('1×10 直線走廊，maxNodes=3 → 僅前 3 格（距離 0,1,2）有值，第 4 格起為 null', () => {
      const bounds: Bounds = { w: 10, h: 1 };
      const goal: Point = { x: 0, y: 0 };
      const isBlocked: IsBlocked = () => false;

      const field = distanceField(goal, isBlocked, bounds, 3);

      expect(field.get(0, 0)).toBe(0);
      expect(field.get(1, 0)).toBe(1);
      expect(field.get(2, 0)).toBe(2);
      expect(field.get(3, 0)).toBeNull();
      expect(field.get(9, 0)).toBeNull();
    });

    it('maxNodes=1 → 只有 goal 自己有值（距離 0），其餘皆 null', () => {
      const bounds: Bounds = { w: 5, h: 5 };
      const goal: Point = { x: 2, y: 2 };
      const isBlocked: IsBlocked = () => false;

      const field = distanceField(goal, isBlocked, bounds, 1);

      expect(field.get(2, 2)).toBe(0);
      expect(field.get(1, 2)).toBeNull();
      expect(field.get(3, 2)).toBeNull();
      expect(field.get(2, 1)).toBeNull();
    });

    it('budget 用盡不 throw（不論地圖多大）', () => {
      const bounds: Bounds = { w: 1000, h: 1000 };
      const goal: Point = { x: 500, y: 500 };
      const isBlocked: IsBlocked = () => false;

      expect(() => distanceField(goal, isBlocked, bounds, 10)).not.toThrow();
    });
  });

  describe('(c) 純函數：同輸入同輸出，無跨呼叫狀態', () => {
    it('同一組輸入呼叫兩次（各自獨立的 isBlocked closure）→ 結果逐格相同', () => {
      const bounds: Bounds = { w: 8, h: 8 };
      const goal: Point = { x: 3, y: 4 };
      const isBlockedA: IsBlocked = (x, y) => x === 2 && y === 4;
      const isBlockedB: IsBlocked = (x, y) => x === 2 && y === 4;

      const fieldA = distanceField(goal, isBlockedA, bounds, 30);
      const fieldB = distanceField(goal, isBlockedB, bounds, 30);

      for (let y = 0; y < bounds.h; y++) {
        for (let x = 0; x < bounds.w; x++) {
          expect(fieldA.get(x, y)).toBe(fieldB.get(x, y));
        }
      }
    });

    it('連續對不同 goal 呼叫（A→B→A）不互相污染，第一次與第三次結果相同', () => {
      const bounds: Bounds = { w: 6, h: 6 };
      const isBlocked: IsBlocked = () => false;

      const first = distanceField({ x: 0, y: 0 }, isBlocked, bounds, 20);
      distanceField({ x: 5, y: 5 }, isBlocked, bounds, 20); // 中間插一次不同 goal 的呼叫
      const third = distanceField({ x: 0, y: 0 }, isBlocked, bounds, 20);

      for (let y = 0; y < bounds.h; y++) {
        for (let x = 0; x < bounds.w; x++) {
          expect(third.get(x, y)).toBe(first.get(x, y));
        }
      }
    });
  });

  describe('(d) 效能性質：預算內展開節點數有界，不隨地圖面積成長', () => {
    it('1000×1000 開闊地圖，maxNodes=2000 → isBlocked 呼叫次數遠低於全圖格數，且遠處格未涵蓋', () => {
      const bounds: Bounds = { w: 1000, h: 1000 };
      const goal: Point = { x: 500, y: 500 };
      const maxNodes = 2000;
      let callCount = 0;
      const isBlocked: IsBlocked = () => {
        callCount++;
        return false;
      };

      const field = distanceField(goal, isBlocked, bounds, maxNodes);

      // 每個「被展開」的節點至多觸發 4 次鄰居查詢（4 向移動）；+10 容許實作在邊界條件上的些微誤差。
      expect(callCount).toBeLessThanOrEqual(maxNodes * 4 + 10);
      // 遠低於全圖規模（1,000,000 格）：證明不是 O(w*h) 全圖掃描。
      expect(callCount).toBeLessThan((bounds.w * bounds.h) / 100);
      // 遠超預算半徑的格子必須未被涵蓋。
      expect(field.get(999, 999)).toBeNull();
      expect(field.get(0, 0)).toBeNull();
    });
  });
});
