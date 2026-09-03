// 存檔持久化（src/render/persistence.ts）
import { describe, expect, it } from 'vitest';
import { SAVE_KEY, clearSave, loadGame, saveGame, type SaveStorage } from '../../src/render/persistence';
import { createDemoWorld, createSimulationFor } from '../../src/render/demoWorld';
import { getResource, SAVE_SCHEMA_VERSION } from '../../src/core/world/state';
import { serializeGameState } from '../../src/core/save/save';

function memoryStorage(initial: Record<string, string> = {}): SaveStorage & { data: Record<string, string> } {
  const data = { ...initial };
  return {
    data,
    getItem: (key) => data[key] ?? null,
    setItem: (key, value) => {
      data[key] = value;
    },
    removeItem: (key) => {
      delete data[key];
    },
  };
}

function throwingStorage(message: string): SaveStorage {
  return {
    getItem: () => {
      throw new Error(message);
    },
    setItem: () => {
      throw new Error(message);
    },
    removeItem: () => {
      throw new Error(message);
    },
  };
}

describe('存檔往返', () => {
  it('存了之後讀得回來，資源與人口一致', () => {
    const storage = memoryStorage();
    const { state, sim } = createDemoWorld(200);
    for (let tick = 0; tick < 700; tick++) sim.tick();

    expect(saveGame(storage, state)).toEqual({ ok: true });
    const outcome = loadGame(storage);
    expect(outcome.status).toBe('loaded');
    if (outcome.status !== 'loaded') return;

    expect(outcome.state.tick).toBe(state.tick);
    expect(outcome.state.citizens.length).toBe(state.citizens.length);
    expect(getResource(outcome.state, 'food')).toBe(getResource(state, 'food'));
    expect(outcome.state.buildings.length).toBe(state.buildings.length);
  });

  it('載入後續跑與不存檔直接續跑結果相同——存檔不得改變模擬軌跡', () => {
    const storage = memoryStorage();
    const a = createDemoWorld(200);
    for (let tick = 0; tick < 600; tick++) a.sim.tick();
    saveGame(storage, a.state);

    // 一邊直接續跑
    for (let tick = 0; tick < 600; tick++) a.sim.tick();

    // 另一邊從存檔載入後續跑
    const outcome = loadGame(storage);
    expect(outcome.status).toBe('loaded');
    if (outcome.status !== 'loaded') return;
    const restoredSim = createSimulationFor(outcome.state);
    for (let tick = 0; tick < 600; tick++) restoredSim.tick();

    expect(outcome.state.tick).toBe(a.state.tick);
    expect(getResource(outcome.state, 'food')).toBe(getResource(a.state, 'food'));
    expect(outcome.state.citizens.length).toBe(a.state.citizens.length);
  });
});

describe('沒有存檔 / 存檔壞掉', () => {
  it('空的儲存區回 empty，不 throw', () => {
    expect(loadGame(memoryStorage()).status).toBe('empty');
  });

  it('空字串也當作沒有存檔', () => {
    expect(loadGame(memoryStorage({ [SAVE_KEY]: '' })).status).toBe('empty');
  });

  it('壞掉的 JSON 回 corrupt 並帶原因，而不是 throw 或悄悄開新局', () => {
    const outcome = loadGame(memoryStorage({ [SAVE_KEY]: '{壞掉的' }));
    expect(outcome.status).toBe('corrupt');
    if (outcome.status === 'corrupt') expect(outcome.reason.length).toBeGreaterThan(0);
  });

  it('欄位不合法的存檔回 corrupt', () => {
    const bad = JSON.stringify({ schemaVersion: SAVE_SCHEMA_VERSION, tick: -1 });
    expect(loadGame(memoryStorage({ [SAVE_KEY]: bad })).status).toBe('corrupt');
  });

  it('v5 舊檔回 outdated（帶版本號）而不是 corrupt——UI 要說「不相容」不是「讀不回來」', () => {
    const { state } = createDemoWorld(200);
    const raw = JSON.parse(serializeGameState(state)) as Record<string, unknown>;
    raw.schemaVersion = 5;
    delete raw.roads;

    const outcome = loadGame(memoryStorage({ [SAVE_KEY]: JSON.stringify(raw) }));

    expect(outcome.status).toBe('outdated');
    if (outcome.status === 'outdated') expect(outcome.savedVersion).toBe(5);
  });

  it('作廢的舊檔同樣不自動刪除', () => {
    const { state } = createDemoWorld(200);
    const raw = JSON.parse(serializeGameState(state)) as Record<string, unknown>;
    raw.schemaVersion = 5;
    delete raw.roads;
    const json = JSON.stringify(raw);
    const storage = memoryStorage({ [SAVE_KEY]: json });

    loadGame(storage);

    expect(storage.data[SAVE_KEY]).toBe(json);
  });

  it('壞掉的存檔不會被自動刪除——玩家可能想手動搶救', () => {
    const storage = memoryStorage({ [SAVE_KEY]: '{壞掉的' });
    loadGame(storage);
    expect(storage.data[SAVE_KEY]).toBe('{壞掉的');
  });
});

describe('儲存區本身失效', () => {
  it('寫入丟例外時回 ok:false 並帶原因，不讓遊戲中斷', () => {
    const { state } = createDemoWorld(200);
    const outcome = saveGame(throwingStorage('QuotaExceededError'), state);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toContain('Quota');
  });

  it('讀取丟例外時回 corrupt 而不是 throw', () => {
    expect(loadGame(throwingStorage('SecurityError')).status).toBe('corrupt');
  });

  it('清除丟例外不會炸出去', () => {
    expect(() => clearSave(throwingStorage('SecurityError'))).not.toThrow();
  });
});

describe('clearSave', () => {
  it('清掉之後再讀是 empty', () => {
    const storage = memoryStorage();
    const { state } = createDemoWorld(200);
    saveGame(storage, state);
    clearSave(storage);
    expect(loadGame(storage).status).toBe('empty');
  });
});
