import type Phaser from 'phaser';
import { describe, expect, it, vi } from 'vitest';
import { applyColorGrade, COLOR_GRADE } from '../../src/render/colorGrade';

describe('COLOR_GRADE', () => {
  it('使用輕度降飽和與有效的暗角參數', () => {
    expect(COLOR_GRADE.saturationDelta).toBeGreaterThanOrEqual(-0.5);
    expect(COLOR_GRADE.saturationDelta).toBeLessThanOrEqual(0);
    expect(COLOR_GRADE.vignetteStrength).toBeGreaterThan(0);
    expect(COLOR_GRADE.vignetteStrength).toBeLessThan(1);
    expect(COLOR_GRADE.vignetteRadius).toBeGreaterThan(0.5);
    expect(COLOR_GRADE.vignetteRadius).toBeLessThanOrEqual(1);
  });
});

describe('applyColorGrade', () => {
  it('對可用的 postFX 依序加入降飽和與置中暗角', () => {
    const saturate = vi.fn();
    const addColorMatrix = vi.fn(() => ({ saturate }));
    const addVignette = vi.fn();
    const camera = {
      postFX: { addColorMatrix, addVignette },
    } as unknown as Phaser.Cameras.Scene2D.Camera;

    applyColorGrade(camera);

    expect(addColorMatrix).toHaveBeenCalledOnce();
    expect(saturate).toHaveBeenCalledWith(COLOR_GRADE.saturationDelta);
    expect(addVignette).toHaveBeenCalledWith(
      0.5,
      0.5,
      COLOR_GRADE.vignetteRadius,
      COLOR_GRADE.vignetteStrength,
    );
  });

  it('postFX 不存在時安全 no-op', () => {
    const camera = {} as Phaser.Cameras.Scene2D.Camera;

    expect(() => applyColorGrade(camera)).not.toThrow();
  });

  it('renderer 沒有 WebGL pipelines 時安全 no-op', () => {
    const addColorMatrix = vi.fn();
    const addVignette = vi.fn();
    const camera = {
      scene: { sys: { renderer: {} } },
      postFX: { addColorMatrix, addVignette },
    } as unknown as Phaser.Cameras.Scene2D.Camera;

    expect(() => applyColorGrade(camera)).not.toThrow();
    expect(addColorMatrix).not.toHaveBeenCalled();
    expect(addVignette).not.toHaveBeenCalled();
  });
});
