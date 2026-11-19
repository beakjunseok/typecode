import { openMode, startArcade, capture, save } from './common.mjs';
const { browser, page, errors } = await openMode('defense', { setup: () => { localStorage.clear(); } });
await page.addScriptTag({ content: `globalThis.__ctx = () => { const R = globalThis.__TYPECODE__.renderers.defense; return [globalThis.__TYPECODE__.run.engine, R, R.surface.width, R.surface.height]; };` });
await startArcade(page);
await page.waitForTimeout(2800);
await page.evaluate(() => { const e = globalThis.__TYPECODE__.run.engine; e.coins = 2000; e.nextSpawnAt = Infinity;
  e.buy('firewall', 0); e.buy('antivirus', 2); e.coins = 640;
  e.bugs = []; globalThis.__bug = e.spawnBug('packet', { progress: 0.35 }); e.spawnBug('spam', { progress: 0.22 }); e.spawnBug('malware', { progress: 0.55 });
  globalThis.__tower = e.towers[0]; });
await page.waitForTimeout(400);
const word = await page.evaluate(() => globalThis.__TYPECODE__.run.engine.stream[0].token.text);
await page.keyboard.type(word.slice(0, 2)); await page.waitForTimeout(150);
await capture(page, 'defense-overview', () => { const [e, R, W, H] = __ctx(); const P = R.panel(), c = R.computerPosition(), b = R.bugPosition(globalThis.__bug), t = R.towerPosition(globalThis.__tower); return [
  __box(W, H, W / 2, 17, W - 6, 30, '웨이브 · 코인 · 컴퓨터 체력'),
  __box(W, H, P.left + P.width / 2, P.top + P.height / 2, P.width - 4, P.height - 4, '쳐서 코인 벌기 — 맨 위 낱말부터'),
  __box(W, H, b.x, b.y, 56, 56, '해킹 공격 — 길을 따라 와요'),
  __box(W, H, t.x, t.y, 64, 64, '타워 — 자동으로 쏴요(누르면 강화)'),
  __box(W, H, c.x, c.y - 4, 176, 132, '지켜야 할 컴퓨터'),
  __box(W, H, W / 2, H - 23, W - 6, 44, '상점 — 숫자 1~6')]; });
await page.keyboard.press('Backspace'); await page.keyboard.press('Backspace');
await page.evaluate(() => { const e = globalThis.__TYPECODE__.run.engine; e.coins = 900; e.selectShopItem('emp'); });
await page.waitForTimeout(250);
await capture(page, 'defense-build', () => { const [e, R, W, H] = __ctx(); const cells = R.shopCells(e); const cell = cells.find(c => c.entry.item === 'emp');
  return [
  __box(W, H, cell.left + cell.width / 2, H - 23, cell.width - 4, 42, '고른 타워(숫자 키 또는 클릭)'),
  ...e.spots.slice(0, 3).map((s, i) => { const p = R.toScreen(s); return __box(W, H, p.x, p.y, 48, 48, i === 0 ? '추천 자리 — 번호 키나 빈 곳 클릭으로 설치' : ''); })]; });
await page.keyboard.press('Escape');
await page.evaluate(() => { const e = globalThis.__TYPECODE__.run.engine; e.coins = 2000; e.buy('interceptor', 1); e.bugs = [];
  globalThis.__drone = e.spawnBug('drone', { x: 0.8, y: 0.1 }); globalThis.__ic = e.towers.find(t => t.type === 'interceptor' || t.tower === 'interceptor') ?? e.towers.at(-1); });
await page.waitForTimeout(300);
await capture(page, 'defense-air', () => { const [e, R, W, H] = __ctx(); const d = R.bugPosition(globalThis.__drone), t = R.towerPosition(globalThis.__ic); return [
  __box(W, H, d.x, d.y, 60, 60, '드론 — 길을 무시하고 날아와요'),
  __box(W, H, t.x, t.y, 64, 64, '요격포 — 드론을 맞히는 타워(EMP포도 가능)')]; });
await page.evaluate(() => { const e = globalThis.__TYPECODE__.run.engine; e.bugs = []; e.wave = 3; e.phase = 'spawning'; e.waveTotal = 1; e.waveSpawned = 1; e.checkWaveClear(); });
await page.waitForTimeout(1700);
await capture(page, 'defense-draft', () => { const [e, R, W, H] = __ctx(); const rects = R.draftLayout(W, H, e.draft.hand.length).rects; const xs = rects.map(r => r.x ?? r.left), ys = rects.map(r => r.y ?? r.top);
  const r0 = rects[0]; const rw = r0.width ?? r0.w, rh = r0.height ?? r0.h;
  const left = Math.min(...xs), right = Math.max(...xs) + rw, top = Math.min(...ys);
  return [__box(W, H, (left + right) / 2, top + rh / 2, right - left + 16, rh + 16, '3웨이브마다 카드 1장 — 클릭 또는 숫자 키')]; });
save('defense'); console.log(word, errors); await browser.close();
