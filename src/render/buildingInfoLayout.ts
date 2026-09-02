export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const PANEL_W = 220;
export const PAD = 10;
export const LINE_H = 18;
export const TITLE_H = 24;

const VIEWPORT_MARGIN = 4;
const ANCHOR_GAP = 6;

export function computeInfoPanelRect(
  anchorX: number,
  anchorY: number,
  lineCount: number,
  viewportWidth: number,
): Rect {
  const contentHeight = lineCount === 0
    ? 0
    : TITLE_H + Math.max(0, lineCount - 1) * LINE_H;
  const h = PAD * 2 + contentHeight;
  const maxX = Math.max(VIEWPORT_MARGIN, viewportWidth - PANEL_W - VIEWPORT_MARGIN);
  const x = Math.min(Math.max(anchorX - PANEL_W / 2, VIEWPORT_MARGIN), maxX);
  return { x, y: anchorY - ANCHOR_GAP - h, w: PANEL_W, h };
}

export function lineY(rect: Rect, index: number): number {
  if (index === 0) return rect.y + PAD;
  return rect.y + PAD + TITLE_H + (index - 1) * LINE_H;
}
