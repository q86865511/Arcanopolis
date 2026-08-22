// scripts/spike-terrain-render/harness.mjs
// M3.9-T2 spike 驅動腳本：自起獨立 vite dev server（port 5219，不動使用者的 5173／--strictPort）
// → chromium headless 依序跑「分塊 RenderTexture」（chunkSize 32/64）與「Phaser isometric
// Tilemap」兩方案 × 200×200／1000×1000 兩種世界尺寸 → 收集初始化耗時／物件數／平移 FPS／
// 單區塊重烘成本 → 存原始數據 JSON 供人工寫報告用。
// 用法：node scripts/spike-terrain-render/harness.mjs
// 啟動/關閉子程序模式抄自 scripts/screenshot.mjs（同一份 Windows npx.cmd + taskkill 慣例）。

import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const PORT = 5219;
const VIEWPORT = { width: 2560, height: 1440 };
const ZOOM = 2;
const PAN_MS = 5000;
const PAN_SPEED = 900; // 世界座標 px/sec（zoom 前），5 秒約掃過 4500px

const RUNS = [
  { mode: 'rendertexture', worldSize: 200, chunkSize: 32 },
  { mode: 'rendertexture', worldSize: 200, chunkSize: 64 },
  { mode: 'rendertexture', worldSize: 1000, chunkSize: 32 },
  { mode: 'rendertexture', worldSize: 1000, chunkSize: 64 },
  { mode: 'tilemap', worldSize: 200, chunkSize: 32 },
  { mode: 'tilemap', worldSize: 1000, chunkSize: 32 },
];

function startViteServer(port) {
  return new Promise((resolvePromise, reject) => {
    const child =
      process.platform === 'win32'
        ? spawn(`npx.cmd vite --port ${port} --strictPort`, {
            cwd: projectRoot,
            stdio: ['ignore', 'pipe', 'pipe'],
            shell: true,
          })
        : spawn('npx', ['vite', '--port', String(port), '--strictPort'], {
            cwd: projectRoot,
            stdio: ['ignore', 'pipe', 'pipe'],
          });

    let settled = false;
    let output = '';
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      killProcessTree(child).finally(() => {
        reject(new Error(`harness: vite dev server 在逾時內未就緒，輸出：\n${output}`));
      });
    }, 30_000);

    const onData = (chunk) => {
      output += chunk.toString();
      if (!settled && /https?:\/\/localhost:/.test(output)) {
        settled = true;
        clearTimeout(timeout);
        resolvePromise(child);
      }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);

    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(err);
    });
    child.on('exit', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(new Error(`harness: vite dev server 提早結束（exit ${code}），輸出：\n${output}`));
    });
  });
}

function killProcessTree(child) {
  return new Promise((resolvePromise) => {
    if (child.pid === undefined || child.exitCode !== null) {
      resolvePromise();
      return;
    }
    if (process.platform === 'win32') {
      const killer = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
      killer.on('exit', () => resolvePromise());
      killer.on('error', () => resolvePromise());
    } else {
      child.kill('SIGKILL');
      resolvePromise();
    }
  });
}

async function runOne(config) {
  // 每個情境各開一顆全新的 chromium 行程（不是共用 browser 只開新 context）：
  // 實測 chunkSize=64/200×200 那組單跑就吃了 130 秒的 WebGL RenderTexture 配置，
  // 緊接著的下一組（哪怕只是換 worldSize）連 page.goto 的 30 秒都掛掉——headless
  // Chromium 在本機是軟體算繪（SwiftShader），重度 GPU 記憶體配置會讓同一顆瀏覽器行程
  // 的後續分頁跟著不穩。每組獨立行程，用完即關，才能讓每組的數字互不汙染。
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: VIEWPORT });
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', (err) => pageErrors.push(err instanceof Error ? err.message : String(err)));
  page.on('console', (msg) => {
    if (msg.type() === 'error') pageErrors.push(msg.text());
  });

  const qs = new URLSearchParams({
    mode: config.mode,
    worldSize: String(config.worldSize),
    chunkSize: String(config.chunkSize),
    zoom: String(ZOOM),
  });
  const url = `http://localhost:${PORT}/scripts/spike-terrain-render/index.html?${qs.toString()}`;

  try {
    const navT0 = Date.now();
    await page.goto(url, { waitUntil: 'load', timeout: 60_000 });
    // 1000×1000 tilemap 建圖是同步 O(N) 迴圈，會整段阻塞主執行緒；逾時放寬到 3 分鐘
    // 注意：waitForFunction(pageFunction, arg, options) 字串形式的第二參數是 arg 不是 options，
    // 漏傳 null 會讓 options 落回預設值（30s），逾時設定就白設了——這裡踩過一次坑。
    await page.waitForFunction('window.__spike && window.__spike.ready === true', null, { timeout: 180_000 });
    return await measureAfterReady(page, config, pageErrors, Date.now() - navT0);
  } finally {
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}

async function measureAfterReady(page, config, pageErrors, initToReadyMs) {

  const metrics = await page.evaluate(() => window.__spike.metrics);
  const objectCountInit = await page.evaluate(() => window.__spike.objectCount());
  const heapAfterInit = await page.evaluate(() => window.__spike.heapBytes());

  await page.evaluate((speed) => window.__spike.startPan(speed, speed * 0.5), PAN_SPEED);
  await page.waitForTimeout(PAN_MS);
  const panStats = await page.evaluate(() => window.__spike.stopPan());
  const heapAfterPan = await page.evaluate(() => window.__spike.heapBytes());
  const objectCountAfterPan = await page.evaluate(() => window.__spike.objectCount());

  let rebakeMs = null;
  if (config.mode === 'rendertexture') {
    rebakeMs = await page.evaluate(() => window.__spike.rebakeCenter());
  }

  let screenshotPath = null;
  if (config.mode === 'rendertexture' && config.worldSize === 1000 && config.chunkSize === 64) {
    screenshotPath = resolve(projectRoot, '.pipeline/reviews/2026-08-22-spike-terrain-1000-screenshot.png');
    mkdirSync(dirname(screenshotPath), { recursive: true });
    await page.screenshot({ path: screenshotPath });
  }

  const toMB = (bytes) => (typeof bytes === 'number' ? +(bytes / 1_048_576).toFixed(1) : null);

  const result = {
    mode: config.mode,
    worldSize: config.worldSize,
    chunkSize: config.mode === 'rendertexture' ? config.chunkSize : null,
    initToReadyMs,
    buildMs: typeof metrics?.buildMs === 'number' ? +metrics.buildMs.toFixed(1) : null,
    tileObjectCount: metrics?.tileObjectCount ?? null,
    initialBakedChunks: metrics?.initialBakedChunks ?? null,
    objectCountInit,
    objectCountAfterPan,
    heapAfterInitMB: toMB(heapAfterInit),
    heapAfterPanMB: toMB(heapAfterPan),
    avgFps: +panStats.avgFps.toFixed(1),
    minFps: +panStats.minFps.toFixed(1),
    panSampleCount: panStats.sampleCount,
    rebakeMs: typeof rebakeMs === 'number' && rebakeMs >= 0 ? +rebakeMs.toFixed(2) : null,
    pageErrorCount: pageErrors.length,
    pageErrors: pageErrors.slice(0, 5),
    screenshotPath,
  };

  return result;
}

async function main() {
  let viteProcess;
  const results = [];
  try {
    viteProcess = await startViteServer(PORT);
    for (const config of RUNS) {
      console.log(`harness: 開始 ${JSON.stringify(config)}`);
      try {
        // eslint-disable-next-line no-await-in-loop
        const result = await runOne(config);
        console.log(`harness: 完成 ${JSON.stringify(result)}`);
        results.push(result);
      } catch (err) {
        // 單一情境失敗（例如逾時）不能拖垮整個矩陣——記錄失敗原因，繼續跑下一個情境
        const message = err instanceof Error ? err.message : String(err);
        console.error(`harness: ${JSON.stringify(config)} 失敗：${message}`);
        results.push({ ...config, failed: true, error: message });
      }
    }
  } finally {
    if (viteProcess !== undefined) {
      try {
        await killProcessTree(viteProcess);
      } catch (err) {
        console.error(`harness: 關閉 vite dev server 失敗：${err instanceof Error ? err.message : err}`);
      }
    }
  }

  const outPath = resolve(projectRoot, '.pipeline/reviews/spike-terrain-raw-results.json');
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(results, null, 2), 'utf8');
  console.log(`harness: 原始數據已存 ${outPath}`);
  return results;
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack : err);
  process.exitCode = 1;
});
