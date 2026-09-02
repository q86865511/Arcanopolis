// HUD 版面純算式：依視窗尺寸算出上/下資訊列的位置，以及文字要不要縮字級才不溢出。
// 抽離自 hud.ts 是為了能在不碰 Phaser 的情況下做單元測試（見 M3.5 審查 S4；F3 的縮字級邏輯即在此驗）。

export interface BarLayout {
  y: number;
  height: number;
}

export interface HudBarsLayout {
  topBar: BarLayout;
  bottomBar: BarLayout;
  /** 下列文字的 y 座標（下列頂端再加內距）。 */
  bottomTextY: number;
}

/** 上列固定貼頂（y=0），下列貼底（y = height - bottomBarHeight），兩列寬度由呼叫端另外套用（恆為 width）。 */
export function computeBarsLayout(
  height: number,
  topBarHeight: number,
  bottomBarHeight: number,
  bottomTextPadY: number,
): HudBarsLayout {
  return {
    topBar: { y: 0, height: topBarHeight },
    bottomBar: { y: height - bottomBarHeight, height: bottomBarHeight },
    bottomTextY: height - bottomBarHeight + bottomTextPadY,
  };
}

/** monospace 字元寬約為字級的這個比例（實測 Courier 系字型近似值）。
 *  匯出給 resourceRowLayout.ts 共用同一個估寬模型，避免兩處各自校一次而漂移。 */
export const CHAR_WIDTH_RATIO = 0.62;

/**
 * 依文字長度與可用寬度算出字級：先用 baseFontSize 估算實際寬度，
 * 塞不下就依比例縮小，下限為 minFontSize（畫面過窄時仍可能溢出，但不會小到不可讀）。
 */
export function fitFontSize(
  textLength: number,
  availableWidth: number,
  baseFontSize: number,
  minFontSize: number,
): number {
  if (textLength <= 0 || availableWidth <= 0) {
    return minFontSize;
  }
  const baseWidth = textLength * baseFontSize * CHAR_WIDTH_RATIO;
  if (baseWidth <= availableWidth) {
    return baseFontSize;
  }
  const fitted = Math.floor(availableWidth / (textLength * CHAR_WIDTH_RATIO));
  return Math.max(minFontSize, fitted);
}
