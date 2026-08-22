// S4：hudLayout.ts 純算式測試（M3.5 審查建議——F3 的縮字級裁切邏輯即在此驗）
import { describe, expect, it } from 'vitest';
import { computeBarsLayout, fitFontSize } from '../../src/render/hudLayout';

describe('computeBarsLayout（S4）', () => {
  it('上列貼頂（y=0），下列貼底（y = height - bottomHeight）', () => {
    const result = computeBarsLayout(240, 28, 26, 5);
    expect(result.topBar).toEqual({ y: 0, height: 28 });
    expect(result.bottomBar).toEqual({ y: 240 - 26, height: 26 });
    expect(result.bottomTextY).toBe(240 - 26 + 5);
  });

  it('高度變動時下列位置跟著移動（720 高視窗）', () => {
    const result = computeBarsLayout(720, 28, 26, 5);
    expect(result.bottomBar.y).toBe(720 - 26);
    expect(result.bottomTextY).toBe(720 - 26 + 5);
  });

  it('極端輸入：高度小於下列高度時仍算得出（不 throw），下列 y 為負', () => {
    const result = computeBarsLayout(10, 28, 26, 5);
    expect(result.bottomBar.y).toBe(10 - 26);
    expect(() => computeBarsLayout(0, 28, 26, 5)).not.toThrow();
  });
});

describe('fitFontSize（S4，F3）', () => {
  it('文字塞得下可用寬度時維持基準字級', () => {
    expect(fitFontSize(10, 1000, 15, 8)).toBe(15);
  });

  it('文字寬度剛好等於可用寬度時維持基準字級（邊界不縮）', () => {
    const textLength = 10;
    const baseFontSize = 15;
    const exactWidth = textLength * baseFontSize * 0.62;
    expect(fitFontSize(textLength, exactWidth, baseFontSize, 8)).toBe(baseFontSize);
  });

  it('320 寬視窗、長資源字串會溢出時縮小字級（回歸審查實測：320 寬時 15px 實寬 467px 溢出）', () => {
    // 467px 約當 15px 字級、長度約 50 字元（467 / (15*0.62) ≈ 50.2）
    const textLength = 50;
    const availableWidth = 320 - 10 * 2; // TEXT_PAD_X*2
    const fitted = fitFontSize(textLength, availableWidth, 15, 8);
    expect(fitted).toBeLessThan(15);
    // 縮小後的字級要真的塞得下（或已縮到下限）
    const fittedWidth = textLength * fitted * 0.62;
    expect(fittedWidth <= availableWidth || fitted === 8).toBe(true);
  });

  it('縮小到下限仍塞不下時停在下限，不會再縮更小（極端窄視窗）', () => {
    const fitted = fitFontSize(200, 50, 15, 8);
    expect(fitted).toBe(8);
  });

  it('極端輸入：文字長度為 0 時回傳下限字級（無內容可縮，避免除以 0）', () => {
    expect(fitFontSize(0, 300, 15, 8)).toBe(8);
  });

  it('極端輸入：可用寬度為 0 或負值時回傳下限字級', () => {
    expect(fitFontSize(20, 0, 15, 8)).toBe(8);
    expect(fitFontSize(20, -10, 15, 8)).toBe(8);
  });

  it('字級隨可用寬度單調：寬度越窄，算出的字級不會變大', () => {
    const widths = [500, 300, 200, 100, 50];
    let prev = Infinity;
    for (const w of widths) {
      const fitted = fitFontSize(40, w, 15, 6);
      expect(fitted).toBeLessThanOrEqual(prev);
      prev = fitted;
    }
  });
});
