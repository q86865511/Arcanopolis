import { describe, expect, it } from 'vitest';
import {
  LINE_H,
  PAD,
  PANEL_W,
  TITLE_H,
  computeInfoPanelRect,
  lineY,
} from '../../src/render/buildingInfoLayout';

describe('建築資訊面板版面', () => {
  it('以 anchorX 水平置中，底邊貼在 anchorY 上方 6px', () => {
    const rect = computeInfoPanelRect(400, 300, 4, 800);
    expect(rect.x).toBe(400 - PANEL_W / 2);
    expect(rect.y + rect.h).toBe(294);
    expect(rect.h).toBe(PAD * 2 + TITLE_H + LINE_H * 3);
  });

  it('靠左時夾在 4px 邊界', () => {
    expect(computeInfoPanelRect(20, 300, 2, 800).x).toBe(4);
  });

  it('靠右時夾在 viewportWidth - PANEL_W - 4', () => {
    expect(computeInfoPanelRect(790, 300, 2, 800).x).toBe(800 - PANEL_W - 4);
  });

  it('標題與內容列採各自的行高', () => {
    const rect = computeInfoPanelRect(400, 300, 3, 800);
    expect(lineY(rect, 0)).toBe(rect.y + PAD);
    expect(lineY(rect, 1)).toBe(rect.y + PAD + TITLE_H);
    expect(lineY(rect, 2)).toBe(rect.y + PAD + TITLE_H + LINE_H);
  });
});
