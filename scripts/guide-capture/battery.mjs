import { openMode, startArcade, capture, save } from './common.mjs';
const { browser, page, errors } = await openMode('battery', { setup: () => { localStorage.clear(); } });
await page.addScriptTag({ content: `globalThis.__ctx = () => { const R = globalThis.__TYPECODE__.renderers.battery; return [globalThis.__TYPECODE__.run.engine, R, R.surface.width, R.surface.height]; };
globalThis.__dom = (root, el, label, pad = 4) => { const a = root.getBoundingClientRect(), b = el.getBoundingClientRect(); return __box(a.width, a.height, b.left - a.left + b.width / 2, b.top - a.top + b.height / 2, b.width + pad * 2, b.height + pad * 2, label); };` });
// 준비 패널
await capture(page, 'battery-prep', () => { const root = document.getElementById('batteryPrep'); return [
  __dom(root, document.getElementById('prepRival'), '이번 상대 — 6명을 차례로 이기면 끝'),
  __dom(root, document.getElementById('prepWeather'), '이번 판 바다 날씨'),
  __dom(root, document.getElementById('prepDeck'), '아이템 덱 — 눌러서 4개 고르기(다시 누르면 빼기)')]; }, { locator: '#batteryPrep' });
await startArcade(page);
await page.evaluate(() => { const e = globalThis.__TYPECODE__.run.engine; e.ai.pausedUntil = Infinity; e.nextItemAt = Infinity; e.items = [];
  e.me.cells = 5; e.rival.cells = 4.5; e.weather = 'calm';
  globalThis.__it = e.spawnItem('powerbank', 0.35, 1); if (globalThis.__it) globalThis.__it.x = 0.42; });
await page.waitForTimeout(900);
await capture(page, 'battery-overview', () => { const [e, R, W, H] = __ctx(); const me = R.characterPosition('me'), rv = R.characterPosition('rival'); const ip = R.itemPosition(globalThis.__it);
  const tw = R.towerWidth();
  return [
  __box(W, H, 50, 17, 96, 26, '내 배터리 %'),
  __box(W, H, W - 72, 17, 138, 26, '방전봇 이름 · %'),
  __box(W, H, W / 2, 17, 96, 26, '바다 날씨'),
  __box(W, H, W / 2, R.goalY, W - 10, 18, '100% 구조선 — 여기 닿으면 승리'),
  (() => { const r = __rect(e.myWord.id); const top = r ? r.top - 4 : me.y - 80; return __box(W, H, me.x, (top + R.waterY) / 2, Math.max(tw + 40, (r ? r.width : 0) + 12), R.waterY - top, '내 탑(셀 1칸 = 12.5%)'); })(),
  __rbox(W, H, e.rivalWord.id, '방전봇 탑 낱말 — 치면 공격'),
  __rbox(W, H, globalThis.__it.id, '지나가는 아이템', { up: 34, minWidth: 60 }),
  __box(W, H, W / 2, R.waterY + 20, W - 10, 40, '바다 — 탑이 계속 가라앉아요(0%면 패배)')]; });
const word = await page.evaluate(() => globalThis.__TYPECODE__.run.engine.rivalWord.token.text);
await page.keyboard.type(word.slice(0, 2)); await page.waitForTimeout(200);
await capture(page, 'battery-attack', () => { const [e, R, W, H] = __ctx(); const rv = R.characterPosition('rival'), me = R.characterPosition('me'); return [
  __rbox(W, H, e.rivalWord.id, '방전봇 탑 낱말 — 끝까지 치면 0.5칸 뺏기'),
  __rbox(W, H, e.myWord.id, '내 탑 낱말 — 방전봇이 이걸 쳐서 뺏어 가요')]; });
await page.keyboard.type(word.slice(2)); await page.waitForTimeout(160);
await capture(page, 'battery-steal', () => { const [e, R, W, H] = __ctx(); const rv = R.characterPosition('rival'), me = R.characterPosition('me'); return [
  __box(W, H, (rv.x + me.x) / 2, (rv.y + me.y) / 2 - 10, rv.x - me.x + 80, Math.abs(rv.y - me.y) + 110, '번개가 셀 0.5칸을 내 탑으로 옮겨요')]; });
await page.waitForTimeout(500);
await page.evaluate(() => { const e = globalThis.__TYPECODE__.run.engine; e.items = []; e.itemPool = ['cell', 'reflect', 'magnet', 'trap', 'obfuscate'];
  const list = [['cell', 0.15, 0.3], ['reflect', 0.3, 0.55], ['magnet', 0.12, 0.7], ['obfuscate', 0.62, 0.4]];
  globalThis.__items = list.map(([t, y, x]) => { const it = e.spawnItem(t, y, 1); if (it) it.x = x; return it; }).filter(Boolean); });
await page.waitForTimeout(250);
await capture(page, 'battery-items', () => { const [e, R, W, H] = __ctx(); const names = { cell: '셀 +0.5칸', reflect: '🪞 반사 방패', magnet: '🧲 셀 자석', obfuscate: '🌀 난독화' };
  return globalThis.__items.map(it => __rbox(W, H, it.id, names[it.item], { up: 34, minWidth: 60 })); });
await page.evaluate(() => { const e = globalThis.__TYPECODE__.run.engine; e.items = []; e.me.reflect = 1; e.me.magnetUntil = e.gameTime + 99; e.persona = 'rusher'; e.taunt('attack'); });
await page.waitForTimeout(250);
await capture(page, 'battery-persona', () => { const [e, R, W, H] = __ctx(); const rv = R.characterPosition('rival'), me = R.characterPosition('me'); return [
  __rbox(W, H, 'taunt', '방전봇 도발 — 성격마다 대사·전략이 달라요'),
  __box(W, H, rv.x, rv.y - 10, 70, 60, '상대 성격(색·얼굴)'),
  __box(W, H, me.x - 36, me.y - 44, 28, 48, '내게 걸린 효과(🪞·🧲 등)')]; });
await page.evaluate(() => { const e = globalThis.__TYPECODE__.run.engine; e.weather = 'storm'; });
await page.waitForTimeout(300);
await capture(page, 'battery-weather', () => { const [e, R, W, H] = __ctx(); return [
  __box(W, H, W / 2, 17, 96, 26, '날씨 표시'),
  __box(W, H, W / 2, R.goalY + (R.waterY - R.goalY) / 2, W * 0.5, (R.waterY - R.goalY) * 0.6, '폭풍 — 비·번개, 아이템 2배·빠르게')]; });
save('battery'); console.log(word, errors); await browser.close();
