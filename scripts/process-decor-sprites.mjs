// 地面裝飾散佈物的後處理：assets\raw 的原圖 → assets\game 的小 sprite。
//
// 走的是建築類管線（白底 floodfill 去背 → trim → Lanczos → pngquant 32），不是地形類——
// 裝飾物要透明背景與 1px 描邊，不套菱形遮罩。與建築的差別只在目標尺寸：
// 建築按寬度縮（N×64），裝飾物按高度縮（8-20px），因為它們的辨識度取決於高度剪影。
//
// 用法：node scripts/process-decor-sprites.mjs

import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(scriptDir, '..')

/**
 * 裝飾物清單：`raw` 是 assets\raw 的原圖，`out` 是 assets\game 的成品，
 * `height` 是成品高度（像素）。
 *
 * 高度是這批唯一的設計參數：這些東西會散佈在 64×32 的地格上，
 * 太高會蓋住建築、太矮會消失。石頭與車轍貼地所以最矮，灌木與樹樁站立所以較高。
 */
const decorSprites = [
  { raw: 'decor-rock-01.png', out: 'decor-rock-01.png', height: 10 },
  { raw: 'decor-rock-02.png', out: 'decor-rock-02.png', height: 9 },
  { raw: 'decor-rock-03.png', out: 'decor-rock-03.png', height: 7 },
  { raw: 'decor-bush-01.png', out: 'decor-bush-01.png', height: 16 },
  { raw: 'decor-bush-02.png', out: 'decor-bush-02.png', height: 18 },
  { raw: 'decor-bush-03.png', out: 'decor-bush-03.png', height: 13 },
  { raw: 'decor-flower-01.png', out: 'decor-flower-01.png', height: 12 },
  { raw: 'decor-flower-02.png', out: 'decor-flower-02.png', height: 12 },
  { raw: 'decor-stump-01.png', out: 'decor-stump-01.png', height: 11 },
  { raw: 'decor-log-01.png', out: 'decor-log-01.png', height: 9 },
  { raw: 'decor-puddle-01.png', out: 'decor-puddle-01.png', height: 8 },
  { raw: 'decor-rut-01.png', out: 'decor-rut-01.png', height: 7 },
]

function findMagick() {
  const programFiles = process.env.ProgramFiles ?? 'C:\\Program Files'
  const install = readdirSync(programFiles, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith('ImageMagick-'))
    .map((entry) => entry.name)
    .sort()
    .at(-1)
  if (!install) throw new Error('找不到 ImageMagick 安裝目錄')
  return path.join(programFiles, install, 'magick.exe')
}

function run(executable, args) {
  const result = spawnSync(executable, args, { cwd: projectRoot, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(`${path.basename(executable)} 執行失敗 (${result.status}): ${result.stderr?.trim()}`)
  }
  return result.stdout?.toString().trim() ?? ''
}

const magick = findMagick()
// 與 process-terrain-tiles.mjs 同樣的 fallback：worktree 下寫死的相對路徑會落空。
const pngquantLocal = path.resolve(projectRoot, '..', 'tools', 'pngquant', 'pngquant.exe')
const pngquant = existsSync(pngquantLocal) ? pngquantLocal : 'pngquant'
const workDir = mkdtempSync(path.join(tmpdir(), 'arcanopolis-decor-'))

try {
  for (const { raw, out, height } of decorSprites) {
    const rawPath = path.join(projectRoot, 'assets', 'raw', raw)
    if (!existsSync(rawPath)) {
      console.log(`${raw}: 原圖不存在，略過`)
      continue
    }
    const outputPath = path.join(projectRoot, 'assets', 'game', out)
    const trimmedPath = path.join(workDir, `${raw}.trimmed.png`)
    const resizedPath = path.join(workDir, `${raw}.resized.png`)

    // 只 floodfill 外圍連通的白背景，物件內部的白色高光（野花花瓣）不會被挖掉。
    run(magick, [
      rawPath,
      '-bordercolor', 'white', '-border', '1',
      '-alpha', 'set', '-channel', 'RGBA', '-fuzz', '12%',
      '-fill', 'none', '-draw', 'alpha 0,0 floodfill',
      '-shave', '1x1', '-trim', '+repage',
      trimmedPath,
    ])

    // 按高度縮。Lanczos 不用 point：這些圖降採樣 50-100 倍，
    // point 會把描邊與細長結構整條打散（M4-W3 目視比對的結論）。
    run(magick, [trimmedPath, '-filter', 'Lanczos', '-resize', `x${height}`, resizedPath])

    run(pngquant, ['--force', '--output', outputPath, '--quality', '0-100', '--speed', '1', '--nofs', '32', resizedPath])

    const geometry = run(magick, [outputPath, '-format', '%wx%h', 'info:'])
    const colors = run(magick, [outputPath, '-format', '%k', 'info:'])
    console.log(`${out}: ${geometry}, 色數=${colors}`)
  }
} finally {
  rmSync(workDir, { recursive: true, force: true })
}
