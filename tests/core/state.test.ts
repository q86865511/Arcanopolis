// R3：GameState（src/core/world/state.ts）
import { describe, expect, it } from 'vitest';
import { addResource, createInitialState, getResource } from '../../src/core/world/state';

describe('createInitialState：初始 GameState', () => {
  it('包含 tick、rngState、resources、buildings 欄位，型別符合契約', () => {
    const state = createInitialState(1);
    expect(typeof state.tick).toBe('number');
    expect(state.tick).toBe(0);
    expect(typeof state.rngState).toBe('number');
    expect(Number.isInteger(state.rngState)).toBe(true);
    expect(typeof state.resources).toBe('object');
    expect(Array.isArray(state.resources)).toBe(false);
    expect(Array.isArray(state.buildings)).toBe(true);
  });

  it('buildings 陣列元素（若存在）至少含 id、type、x、y', () => {
    const state = createInitialState(1);
    for (const b of state.buildings) {
      expect(b).toHaveProperty('id');
      expect(b).toHaveProperty('type');
      expect(b).toHaveProperty('x');
      expect(b).toHaveProperty('y');
    }
  });

  it('為純資料：JSON 序列化再反序列化後與原 state 深相等', () => {
    const state = createInitialState(1);
    const roundTripped = JSON.parse(JSON.stringify(state));
    expect(roundTripped).toEqual(state);
  });

  it('同 seed 兩次 createInitialState 深相等', () => {
    const a = createInitialState(42);
    const b = createInitialState(42);
    expect(a).toEqual(b);
  });
});

describe('getResource / addResource：own-property 語義的資源讀寫 helper', () => {
  it('未初始化的資源讀為 0，即使與 Object.prototype 成員同名', () => {
    const state = createInitialState(1);
    expect(getResource(state, 'wood')).toBe(0);
    expect(getResource(state, 'constructor')).toBe(0);
    expect(getResource(state, 'toString')).toBe(0);
    expect(getResource(state, '__proto__')).toBe(0);
  });

  it('addResource 對危險鍵名寫入 own property，讀回為數字且可 JSON round-trip', () => {
    const state = createInitialState(1);
    addResource(state, '__proto__', 3);
    addResource(state, 'constructor', 5);
    addResource(state, 'constructor', 1);

    expect(getResource(state, '__proto__')).toBe(3);
    expect(getResource(state, 'constructor')).toBe(6);

    const roundTripped = JSON.parse(JSON.stringify(state));
    expect(Object.getOwnPropertyDescriptor(roundTripped.resources, '__proto__')?.value).toBe(3);
    expect(Object.getOwnPropertyDescriptor(roundTripped.resources, 'constructor')?.value).toBe(6);
  });

  it('addResource 拒絕非有限 amount', () => {
    const state = createInitialState(1);
    expect(() => addResource(state, 'wood', Number.NaN)).toThrow();
    expect(() => addResource(state, 'wood', -Infinity)).toThrow();
  });
});
