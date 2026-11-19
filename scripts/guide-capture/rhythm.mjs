import { openMode, capture, save } from './common.mjs';
const { browser, page, errors } = await openMode('rhythm', { setup: () => { localStorage.clear(); localStorage.setItem('typecode:rhythmSong', JSON.stringify('canon')); localStorage.setItem('typecode:rhythmOptions', JSON.stringify({ autoPlay: true })); } });
await page.addScriptTag({ content: `globalThis.__ctx = () => { const R = globalThis.__TYPECODE__.renderers.rhythm; const L = R.layout(); return [globalThis.__TYPECODE__.run.engine, R, L.width, L.height, L]; };
globalThis.__dom = (root, el, label, pad = 4) => { const a = root.getBoundingClientRect(), b = el.getBoundingClientRect(); return __box(a.width, a.height, b.left - a.left + b.width / 2, b.top - a.top + b.height / 2, b.width + pad * 2, b.height + pad * 2, label); };` });
await page.waitForTimeout(300);
await capture(page, 'rhythm-select', () => { const root = document.getElementById('arcadeStage'); const list = document.querySelector('.song-list'); const detail = document.querySelector('.song-detail');
  const diff = document.querySelector('.song-detail [data-difficulty]')?.parentElement;
  return [__dom(root, list, '곡 목록 — ↑↓ 또는 클릭으로 고르기'), ...(diff ? [__dom(root, diff, '난이도')] : []), __dom(root, detail, '곡 정보 · 최고 기록')]; }, { locator: '#arcadeStage' });
await page.evaluate(() => document.getElementById('hiddenInput')?.focus());
await page.keyboard.press('x');
await page.waitForTimeout(9000);
for (let i = 0; i < 80; i++) {
  const ok = await page.evaluate(() => { const [e, R, W, H, L] = __ctx(); return e.notes.filter(n => n.state === 'pending' && !n.holdEnd && R.noteY(n.hitTime, e, L) > L.topY + 40 && R.noteY(n.hitTime, e, L) < L.judgeY - 60).length >= 2; });
  if (ok) break; await page.waitForTimeout(120);
}
const noteBox = `(e, R, W, H, L, n, label) => __box(W, H, R.laneCenter(n.lane, L), R.noteY(n.hitTime, e, L), L.radius * 2.6, L.radius * 2.6, label)`;
await page.addScriptTag({ content: `globalThis.__note = ${noteBox};` });
await capture(page, 'rhythm-overview', () => { const [e, R, W, H, L] = __ctx();
  const visible = e.notes.filter(n => n.state === 'pending' && !n.holdEnd && R.noteY(n.hitTime, e, L) > L.topY + 40 && R.noteY(n.hitTime, e, L) < L.judgeY - 40);
  const lanes = L.laneWidth * 4;
  return [
  __box(W, H, W / 2, 17, W - 8, 30, '점수 · 콤보 · 진행'),
  __box(W, H, W / 2, L.topY - 37, lanes, 70, '지금 치는 낱말'),
  ...(visible[0] ? [__note(e, R, W, H, L, visible[0], '떨어지는 글자 노트')] : []),
  __box(W, H, W / 2, L.judgeY, lanes + 16, 26, '판정선 — 원이 닿을 때 그 글자 치기'),
  __box(W, H, L.left + L.laneWidth * 4 + 18, (L.topY + 10 + L.judgeY) / 2, 22, L.judgeY - L.topY - 6, '피버 게이지'),
  __box(W, H, W / 2, L.judgeY + 40, lanes, 44, '손가락 구역 4레인(왼손 바깥 · 왼손 안 · 오른손 안 · 오른손 바깥)')]; });
// 롱노트가 화면에 있을 때까지 기다림
for (let i = 0; i < 40; i++) {
  const ok = await page.evaluate(() => { const [e, R, W, H, L] = __ctx(); return e.notes.some(n => n.holdEnd && n.state === 'pending' && R.noteY(n.hitTime, e, L) > L.topY + 60 && R.noteY(n.hitTime, e, L) < L.judgeY - 60); });
  if (ok) break; await page.waitForTimeout(250);
}
await capture(page, 'rhythm-hold', () => { const [e, R, W, H, L] = __ctx();
  const n = e.notes.find(n => n.holdEnd && n.state === 'pending' && R.noteY(n.hitTime, e, L) > L.topY + 60);
  if (!n) return [];
  const y1 = R.noteY(n.hitTime, e, L), y2 = Math.max(L.topY, R.noteY(n.holdEnd, e, L));
  return [__box(W, H, R.laneCenter(n.lane, L), (y1 + y2) / 2, L.radius * 2.8, y1 - y2 + L.radius * 2.6, '롱노트 — 머리에서 누르고 꼬리까지 유지')]; });
// 판정 글자가 뜬 순간
for (let i = 0; i < 200; i++) { const ok = await page.evaluate(() => { const [e] = __ctx(); return e.notes.some(n => n.judgement === 'perfect' && n.resolvedAt !== null && e.gameTime - n.resolvedAt < 0.12 && e.gameTime - n.resolvedAt > 0.04); }); if (ok) break; await page.waitForTimeout(15); }
await capture(page, 'rhythm-judge', () => { const [e, R, W, H, L] = __ctx(); const lanes = L.laneWidth * 4; return [
  __box(W, H, W / 2, L.judgeY - 108, lanes, 58, '판정: PERFECT · GREAT · GOOD · BAD · MISS'),
  __box(W, H, W / 2, L.topY - 37, lanes, 70, '낱말을 다 치면 완성 — 오타 없이 GOOD 이상이면 보너스')]; });
save('rhythm'); console.log(errors); await browser.close();
