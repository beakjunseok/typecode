import { chromium } from '/home/claude/.npm-global/lib/node_modules/playwright/index.mjs';
import { writeFileSync } from 'node:fs';
export async function openMode(mode, { width = 1280, height = 900, setup } = {}) {
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage({ viewport: { width, height } });
  const errors = []; page.on('pageerror', e => errors.push(e.message + ' ' + e.stack?.split('\n')[1]));
  await page.goto('http://localhost:8770/');
  if (setup) { await page.evaluate(setup); await page.reload(); }
  await page.waitForTimeout(700);
  if (mode === 'practice') await page.click('[data-section="practice"]');
  else { await page.click('[data-section="game"]'); await page.click(`[data-mode="${mode}"]`); }
  await page.waitForTimeout(400);
  // 표시 상자 도우미: 캔버스 CSS px → %
  await page.addScriptTag({ content: `globalThis.__box = (W, H, cx, cy, w, h, label) => ({ x: +(100 * (cx - w / 2) / W).toFixed(2), y: +(100 * (cy - h / 2) / H).toFixed(2), w: +(100 * w / W).toFixed(2), h: +(100 * h / H).toFixed(2), label });` });
  return { browser, page, errors };
}
export const startArcade = async page => { await page.focus('#hiddenInput'); await page.keyboard.press('x'); await page.waitForTimeout(80); await page.keyboard.press('Backspace'); await page.waitForTimeout(150); };
export const freeze = page => page.evaluate(() => { const e = globalThis.__TYPECODE__.run.engine; e.__update ??= e.update; e.update = () => {}; });
export const unfreeze = page => page.evaluate(() => { const e = globalThis.__TYPECODE__.run.engine; if (e.__update) e.update = e.__update; });
export const shots = {};
// 얼려서 찍고 표시 상자 계산(markFn은 페이지 안에서 실행)
export async function capture(page, id, markFn, { locator = '#arcadeCanvas', arg } = {}) {
  await freeze(page); await page.waitForTimeout(180);
  const marks = markFn ? await page.evaluate(markFn, arg) : [];
  await page.locator(locator).screenshot({ path: `/tmp/guide/${id}.png` });
  shots[id] = { marks };
  await unfreeze(page);
}
export const save = mode => writeFileSync(`/tmp/guide/${mode}.json`, JSON.stringify(shots, null, 1));
