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
  function makeCamera() {
    const order: string[] = [];
    const reset = vi.fn(() => order.push('reset'));
    const saturate = vi.fn(() => order.push('saturate'));
    const multiply = vi.fn(() => order.push('multiply'));
    const addColorMatrix = vi.fn(() => {
      order.push('addColorMatrix');
      return { reset, saturate, multiply };
    });
    const addVignette = vi.fn(() => order.push('addVignette'));
    const camera = {
      postFX: { addColorMatrix, addVignette },
    } as unknown as Phaser.Cameras.Scene2D.Camera;
    return { camera, order, reset, saturate, multiply, addColorMatrix, addVignette };
  }

  it('對可用的 postFX 依序加入降飽和、通道倍率與置中暗角', () => {
    const { camera, order, saturate, multiply, addColorMatrix, addVignette } = makeCamera();

    const handle = applyColorGrade(camera);

    expect(handle).not.toBeNull();
    expect(order).toEqual(['addColorMatrix', 'reset', 'saturate', 'multiply', 'addVignette']);
    expect(addColorMatrix).toHaveBeenCalledOnce();
    expect(saturate).toHaveBeenCalledWith(COLOR_GRADE.saturationDelta, true);
    expect(multiply).toHaveBeenCalledWith(
      [
        1, 0, 0, 0, 0,
        0, 1, 0, 0, 0,
        0, 0, 1, 0, 0,
        0, 0, 0, 1, 0,
      ],
      true,
    );
    expect(addVignette).toHaveBeenCalledWith(
      0.5,
      0.5,
      COLOR_GRADE.vignetteRadius,
      COLOR_GRADE.vignetteStrength,
    );
  });

  it('setNight 重設矩陣後依序套用額外降飽和與偏藍通道倍率', () => {
    const { camera, order, reset, saturate, multiply } = makeCamera();
    const handle = applyColorGrade(camera);
    order.length = 0;
    reset.mockClear();
    saturate.mockClear();
    multiply.mockClear();

    handle?.setNight(0.5);

    expect(order).toEqual(['reset', 'saturate', 'multiply']);
    expect(saturate).toHaveBeenCalledWith(-0.25, true);
    expect(multiply).toHaveBeenCalledWith(
      [
        0.725, 0, 0, 0, 0,
        0, 0.775, 0, 0, 0,
        0, 0, 0.875, 0, 0,
        0, 0, 0, 1, 0,
      ],
      true,
    );
  });

  it('量化後 strength 相同時不重建矩陣', () => {
    const { camera, reset, saturate, multiply } = makeCamera();
    const handle = applyColorGrade(camera);
    reset.mockClear();
    saturate.mockClear();
    multiply.mockClear();

    handle?.setNight(0.5);
    handle?.setNight(0.501);

    expect(reset).toHaveBeenCalledOnce();
    expect(saturate).toHaveBeenCalledOnce();
    expect(multiply).toHaveBeenCalledOnce();
  });

  it('postFX 不存在時安全 no-op', () => {
    const camera = {} as Phaser.Cameras.Scene2D.Camera;

    expect(() => applyColorGrade(camera)).not.toThrow();
    expect(applyColorGrade(camera)).toBeNull();
  });

  it('renderer 沒有 WebGL pipelines 時安全 no-op', () => {
    const addColorMatrix = vi.fn();
    const addVignette = vi.fn();
    const camera = {
      scene: { sys: { renderer: {} } },
      postFX: { addColorMatrix, addVignette },
    } as unknown as Phaser.Cameras.Scene2D.Camera;

    expect(applyColorGrade(camera)).toBeNull();
    expect(addColorMatrix).not.toHaveBeenCalled();
    expect(addVignette).not.toHaveBeenCalled();
  });
});
