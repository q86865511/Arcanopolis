import { describe, expect, it } from 'vitest';
import { APP_NAME } from '../src/main';

describe('scaffold smoke test', () => {
  it('永真斷言：測試框架本身可跑', () => {
    expect(true).toBe(true);
  });

  it('可從 tests 匯入 src 下模組（驗證 TS 模組解析）', () => {
    expect(APP_NAME).toBe('Arcanopolis');
  });
});
