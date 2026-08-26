import type Phaser from 'phaser';

/** 世界相機的統一色調參數；日後日夜濾鏡也從這個接入點延伸。 */
export const COLOR_GRADE = Object.freeze({
  saturationDelta: -0.15,
  vignetteStrength: 0.35,
  vignetteRadius: 0.9,
});

/**
 * 套用只屬於世界相機的 WebGL 後製。Canvas renderer 沒有 FX pipelines，安全略過。
 */
export function applyColorGrade(camera: Phaser.Cameras.Scene2D.Camera): void {
  const postFX = camera.postFX;
  const renderer = camera.scene?.sys?.renderer as { pipelines?: unknown } | undefined;

  if (
    (renderer !== undefined && renderer.pipelines === undefined) ||
    !postFX ||
    typeof postFX.addColorMatrix !== 'function' ||
    typeof postFX.addVignette !== 'function'
  ) {
    return;
  }

  const colorMatrix = postFX.addColorMatrix();
  if (!colorMatrix || typeof colorMatrix.saturate !== 'function') {
    return;
  }

  colorMatrix.saturate(COLOR_GRADE.saturationDelta);
  postFX.addVignette(0.5, 0.5, COLOR_GRADE.vignetteRadius, COLOR_GRADE.vignetteStrength);
}
