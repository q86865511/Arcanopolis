import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn, spawnSync } from 'node:child_process'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(scriptDir, '..')

function argumentValue(name, fallback) {
  const index = process.argv.indexOf(name)
  return index === -1 ? fallback : process.argv[index + 1]
}

function killProcessTree(child) {
  return new Promise((resolve) => {
    if (child.pid === undefined || child.exitCode !== null) {
      resolve()
      return
    }
    const killer = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
    killer.unref()
    let settled = false
    const finish = () => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      resolve()
    }
    const timeout = setTimeout(() => {
      killer.kill()
      finish()
    }, 5_000)
    killer.on('exit', finish)
    killer.on('error', finish)
  })
}

async function waitForServer(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url)
      if (response.ok) return
    } catch {
      // Vite may still be starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error(`Vite 未在 ${timeoutMs}ms 內就緒：${url}`)
}

const output = path.resolve(argumentValue('--out', 'screenshots/tile-seamless.png'))
const viewport = argumentValue('--viewport', '2560x1440')
const wait = Number(argumentValue('--wait', '8000'))
const match = /^(\d+)[xX](\d+)$/.exec(viewport)
if (!match || !Number.isInteger(wait) || wait < 0) {
  throw new Error('用法：node scripts/screenshot-edge.mjs --viewport 2560x1440 --wait 8000 --out <path>')
}

const edge = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const url = 'http://localhost:5199/'
const vite = process.platform === 'win32'
  ? spawn('npx.cmd vite --port 5199 --strictPort', {
      cwd: projectRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: true,
    })
  : spawn('npx', ['vite', '--port', '5199', '--strictPort'], {
      cwd: projectRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
    })

let viteOutput = ''
vite.stdout.on('data', (chunk) => { viteOutput += chunk.toString() })
vite.stderr.on('data', (chunk) => { viteOutput += chunk.toString() })

try {
  await waitForServer(url, 30_000)
  mkdirSync(path.dirname(output), { recursive: true })

  const result = spawnSync(edge, [
    '--headless=new',
    '--no-sandbox',
    '--disable-gpu',
    '--hide-scrollbars',
    `--window-size=${match[1]},${match[2]}`,
    `--virtual-time-budget=${wait}`,
    '--run-all-compositor-stages-before-draw',
    `--user-data-dir=${path.join(path.dirname(output), 'edge-profile')}`,
    `--screenshot=${output}`,
    url,
  ], {
    cwd: projectRoot,
    encoding: 'utf8',
    timeout: 60_000,
  })

  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(`Edge 截圖失敗 (${result.status})：${result.stderr.trim()}`)
  }
  console.log(`screenshot-edge: 已截圖至 ${output}（視窗 ${viewport}，等待 ${wait}ms）`)
} catch (error) {
  if (viteOutput) console.error(viteOutput.trim())
  throw error
} finally {
  await killProcessTree(vite)
  vite.stdout.destroy()
  vite.stderr.destroy()
  vite.unref()
}
