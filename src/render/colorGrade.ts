import type Phaser from 'phaser';
import { nightTint, quantizeStrength } from './dayNight';

/** 世界相機的統一色調參數。 */
export const COLOR_GRADE = Object.freeze({
  saturationDelta: -0.15,
  vignetteStrength: 0.35,
  vignetteRadius: 0.9,
});

/**
 * 套用只屬於世界相機的 WebGL 後製。Canvas renderer 沒有 FX pipelines，安全略過。
 */
export interface ColorGradeHandle {
  setNight(strength: number): void;
}

export function applyColorGrade(camera: Phaser.Cameras.Scene2D.Camera): ColorGradeHandle | null {
  const postFX = camera.postFX;
  const renderer = camera.scene?.sys?.renderer as { pipelines?: unknown } | undefined;

  if (
    (renderer !== undefined && renderer.pipelines === undefined) ||
    !postFX ||
    typeof postFX.addColorMatrix !== 'function' ||
    typeof postFX.addVignette !== 'function'
  ) {
    return null;
  }

  const colorMatrix = postFX.addColorMatrix();
  if (
    !colorMatrix ||
    typeof colorMatrix.reset !== 'function' ||
    typeof colorMatrix.saturate !== 'function' ||
    typeof colorMatrix.multiply !== 'function'
  ) {
    return null;
  }

  let lastStrength: number | null = null;
  const handle: ColorGradeHandle = {
    setNight(strength: number): void {
      const quantized = quantizeStrength(strength);
      if (quantized === lastStrength) return;
      lastStrength = quantized;

      const tint = nightTint(quantized);
      colorMatrix.reset();
      colorMatrix.saturate(COLOR_GRADE.saturationDelta + tint.saturationDelta, true);
      colorMatrix.multiply(
        [
          tint.r, 0, 0, 0, 0,
          0, tint.g, 0, 0, 0,
          0, 0, tint.b, 0, 0,
          0, 0, 0, 1, 0,
        ],
        true,
      );
    },
  };

  handle.setNight(0);
  postFX.addVignette(0.5, 0.5, COLOR_GRADE.vignetteRadius, COLOR_GRADE.vignetteStrength);
  return handle;
}
