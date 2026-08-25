// 建築 sprite 的後處理：assets\raw 的原圖 → assets\game 的建築素材。
//
// 管線＝白底 floodfill 去背 → trim → Lanczos 按寬度縮 → pngquant 32
// （2026-08-23 M4-W3 定案，取代更早的 rembg 路徑：rembg 對這類圖會留白光暈）。
// **降採樣一律 Lanczos 不用 -filter point**：12 倍以上降採樣時 point 會把風車葉片、
// 梯子、旗桿這類 1px 細長結構整條打散（目視比對確認）。
//
// 與 process-decor-sprites.mjs 的唯一差別是按寬度縮而非高度：
// 建築的寬度由佔格數決定（N 格 → N×64 像素），高度隨體量自由。
//
// 用法：node scripts/process-building-sprites.mjs

import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(scriptDir, '..')

/**
 * 建築清單：`raw` 是 assets\raw 的原圖，`out` 是 assets\game 的成品，
 * `tiles` 是佔格數（成品寬度 = tiles × 64）。
 *
 * `{raw, out}` 拆開的理由同 process-terrain-tiles.mjs：assets\raw 永不覆蓋，
 * 但重生的素材要落到渲染層已在用的 texture key 上。
 */
const buildingSprites = [
  // 2026-08-24 素材債清理：舊 house-01 自帶一整圈草地方形基座，違反現行的無底座規則
  // （地面一律由地形 tile 提供）；舊 farm-01 沿菱形外緣描了黑邊，縮到 64×32 後斷成
  // 一圈散落的黑點（實測 34 個極深像素），在遊戲裡看起來像髒污。
  // 2026-08-25 W4 AoE2 濃度重生：十張主要建築依 art-bible 暗色調前綴＋高細節密度重畫
  // （參考各自舊 raw 保形）。生成順序與清單順序不符是已知坑——搬運後逐張目視對名再落檔。
  { raw: 'house-01-v3.png', out: 'house-01.png', tiles: 1 },
  { raw: 'farm-01-v3.png', out: 'farm-01.png', tiles: 1 },
  { raw: 'mill-01-v2.png', out: 'mill-01.png', tiles: 1 },
  { raw: 'bakery-01-v2.png', out: 'bakery-01.png', tiles: 1 },
  { raw: 'lumber-camp-01-v2.png', out: 'lumber-camp-01.png', tiles: 1 },
  { raw: 'sawmill-01-v2.png', out: 'sawmill-01.png', tiles: 1 },
  { raw: 'quarry-01-v2.png', out: 'quarry-01.png', tiles: 1 },
  { raw: 'smelter-01-v2.png', out: 'smelter-01.png', tiles: 1 },
  { raw: 'blacksmith-01-v2.png', out: 'blacksmith-01.png', tiles: 1 },
  { raw: 'market-01-v2.png', out: 'market-01.png', tiles: 1 },
  { raw: 'mine-01-v2.png', out: 'mine-01.png', tiles: 1 },
  // 首個 2×2 建築:成品寬 128。
  { raw: 'tavern-01-v2.png', out: 'tavern-01.png', tiles: 2 },
  // 外觀變體：避免整排建築長得一模一樣，由渲染層決定論挑選。
  { raw: 'house-02.png', out: 'house-02.png', tiles: 1 },
  { raw: 'house-03.png', out: 'house-03.png', tiles: 1 },
  { raw: 'farm-02.png', out: 'farm-02.png', tiles: 1 },
  // 建造中狀態的疊加素材：外框式鷹架，中間可看穿。
  { raw: 'scaffold-01.png', out: 'scaffold-01.png', tiles: 1 },
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
// 與其他管線腳本同樣的 fallback：worktree 下寫死的相對路徑會落空。
const pngquantLocal = path.resolve(projectRoot, '..', 'tools', 'pngquant', 'pngquant.exe')
const pngquant = existsSync(pngquantLocal) ? pngquantLocal : 'pngquant'
const workDir = mkdtempSync(path.join(tmpdir(), 'arcanopolis-building-'))

try {
  for (const { raw, out, tiles } of buildingSprites) {
    const rawPath = path.join(projectRoot, 'assets', 'raw', raw)
    if (!existsSync(rawPath)) {
      console.log(`${raw}: 原圖不存在，略過`)
      continue
    }
    const outputPath = path.join(projectRoot, 'assets', 'game', out)
    const trimmedPath = path.join(workDir, `${raw}.trimmed.png`)
    const resizedPath = path.join(workDir, `${raw}.resized.png`)

    // 只 floodfill 外圍連通的白背景，建築內部的白牆不會被挖掉。
    run(magick, [
      rawPath,
      '-bordercolor', 'white', '-border', '1',
      '-alpha', 'set', '-channel', 'RGBA', '-fuzz', '12%',
      '-fill', 'none', '-draw', 'alpha 0,0 floodfill',
      '-shave', '1x1', '-trim', '+repage',
      trimmedPath,
    ])

    run(magick, [trimmedPath, '-filter', 'Lanczos', '-resize', `${tiles * 64}x`, resizedPath])
    run(pngquant, ['--force', '--output', outputPath, '--quality', '0-100', '--speed', '1', '--nofs', '32', resizedPath])

    const geometry = run(magick, [outputPath, '-format', '%wx%h', 'info:'])
    const colors = run(magick, [outputPath, '-format', '%k', 'info:'])
    // art-bible：高度上限＝寬×1.5（塔類放寬到 ×1.75）
    const [w, h] = geometry.split('x').map(Number)
    const overHeight = h > w * 1.5 ? `  ⚠ 高度超過寬×1.5（art-bible 上限）` : ''
    console.log(`${out}: ${geometry}, 色數=${colors}${overHeight}`)
  }
} finally {
  rmSync(workDir, { recursive: true, force: true })
}
