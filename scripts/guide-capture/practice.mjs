import { openMode, capture, save } from './common.mjs';
const { browser, page, errors } = await openMode('practice', { setup: () => { localStorage.clear(); } });
await page.addScriptTag({ content: `globalThis.__dom = (root, el, label, pad = 4) => { const a = root.getBoundingClientRect(), b = el.getBoundingClientRect(); return __box(a.width, a.height, b.left - a.left + b.width / 2, b.top - a.top + b.height / 2, b.width + pad * 2, b.height + pad * 2, label); };` });
await page.addStyleTag({ content: '.keyboard-wrap, #keyboardHost, .kb-float { }' });
await page.focus('#hiddenInput');
// 몇 토큰 정확히 쳐서 콤보 쌓기
for (let i = 0; i < 12; i++) { const text = await page.evaluate(() => globalThis.__TYPECODE__.run.engine.current.text); await page.keyboard.type(text, { delay: 105 }); }
const text = await page.evaluate(() => globalThis.__TYPECODE__.run.engine.current.text);
await page.keyboard.type(text.slice(0, Math.max(1, Math.floor(text.length / 2))), { delay: 105 });
await page.waitForTimeout(1000);
const shoot = async (id, fn) => { await page.evaluate(() => { const e = globalThis.__TYPECODE__.run.engine; e.__update ??= e.update; e.update = () => {}; });
  const area = await page.evaluate(() => { const a = document.querySelector('.stats').getBoundingClientRect(), b = document.getElementById('stage').getBoundingClientRect(), c = document.querySelector('.controls').getBoundingClientRect(); return { x: Math.min(a.left, b.left, c.left), y: c.top - 6, width: Math.max(a.right, b.right, c.right) - Math.min(a.left, b.left, c.left), height: b.bottom - c.top + 12 }; });
  const marks = await page.evaluate(([fn, area]) => { const root = { getBoundingClientRect: () => ({ left: area.x, top: area.y, width: area.width, height: area.height }) }; return new Function('root', `return (${fn})(root)`)(root); }, [fn.toString(), area]);
  await page.screenshot({ path: `/tmp/guide/${id}.png`, clip: area });
  return { id, marks }; };
const out = {};
let r = await shoot('practice-overview', root => [
  __dom(root, document.getElementById('durationGroup'), '시간 고르기 · ⏳연장'),
  __dom(root, document.getElementById('timeStat'), '남은 시간'),
  __dom(root, document.getElementById('comboValue').parentElement, '콤보'),
  __dom(root, document.getElementById('multiplierStat'), '점수 배율'),
  __dom(root, document.getElementById('currentView'), '지금 칠 토큰 — 친 글자는 밝게'),
  __dom(root, document.getElementById('queueView'), '다음 토큰 미리보기'),
  __dom(root, document.getElementById('historyView'), '이미 친 토큰')]);
out[r.id] = { marks: r.marks };
r = await shoot('practice-combo', root => [
  __dom(root, document.querySelector('.combo-meter'), '콤보 게이지 — 10콤보 ×1.5, 30콤보 ×2.0'),
  __dom(root, document.getElementById('multiplierStat'), '지금 배율'),
  __dom(root, document.getElementById('comboValue').parentElement, '오타가 나면 0으로')]);
out[r.id] = { marks: r.marks };
const { writeFileSync } = await import('node:fs'); writeFileSync('/tmp/guide/practice.json', JSON.stringify(out, null, 1));
console.log(errors); await browser.close();
