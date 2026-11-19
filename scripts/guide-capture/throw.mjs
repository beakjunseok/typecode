import { openMode, startArcade, capture, save } from './common.mjs';
const { browser, page, errors } = await openMode('throw');
await startArcade(page);
const ent = `(e, R, W, H, entity, w, h, dy, label) => __rbox(W, H, entity.id, label, { up: (entity.kind === 'item' ? 50 : entity.kind === 'pad' ? 44 : 66) * R.depthScale(entity.x), minWidth: 74 })`;
await page.addScriptTag({ content: `globalThis.__ent = ${ent}; globalThis.__ctx = () => { const R = globalThis.__TYPECODE__.renderers.throw; return [globalThis.__TYPECODE__.run.engine, R, R.surface.width, R.surface.height]; };` });
// 전체 화면
await page.evaluate(() => { const e = globalThis.__TYPECODE__.run.engine; e.nextSpawnAt = Infinity; e.nextItemAt = Infinity; e.nextBatteryAt = Infinity; e.robots = [];
  const a = e.spawnRobot('basic', 0); a.x = 0.58; const b = e.spawnRobot('basic', 2); b.x = 0.75; const c = e.spawnRobot('basic', 3); c.x = 0.42; globalThis.__aim = c; globalThis.__others = [a, b];
  globalThis.__item = e.spawnItem(1, 'battery'); if (globalThis.__item) globalThis.__item.x = 0.66; });
await page.waitForTimeout(200);
const word = await page.evaluate(() => globalThis.__aim.token.text);
await page.keyboard.type(word.slice(0, 2)); await page.waitForTimeout(250);
await capture(page, 'throw-overview', () => { const [e, R, W, H] = __ctx(); return [
  __box(W, H, 50, 17, 96, 26, '생명(3칸)'),
  __box(W, H, W / 2, 17, 90, 26, '처치 수 / 50'),
  __ent(e, R, W, H, globalThis.__aim, 100, 86, -18, '조준 중인 로봇(파란 테두리)'),
  __ent(e, R, W, H, globalThis.__item, 80, 70, -14, '아이템'),
  __box(W, H, W / 2, R.dangerY, W - 12, 14, '위험선 — 넘으면 생명 −1'),
  __box(W, H, R.playerPosition().x + 8, R.playerPosition().y + 2, 130, 116, '나(휴대폰을 던짐)')]; });
await capture(page, 'throw-aim', () => { const [e, R, W, H] = __ctx(); return [
  __ent(e, R, W, H, globalThis.__aim, 100, 86, -18, '첫 글자를 친 로봇 — 파란 테두리로 잠김, 친 글자는 밝게'),
  ...globalThis.__others.map(r => __ent(e, R, W, H, r, 90, 80, -18, '다른 로봇 — 첫 글자가 서로 달라 헷갈리지 않아요'))]; });
await page.keyboard.type(word.slice(2)); await page.waitForTimeout(130);
await capture(page, 'throw-fire', () => { const [e, R, W, H] = __ctx(); const p = R.playerPosition(); const t = globalThis.__aim; return [
  __box(W, H, (p.x + R.columnX(t.lane)) / 2, (p.y + R.toY(t.x)) / 2, Math.abs(p.x - R.columnX(t.lane)) + 90, Math.abs(p.y - R.toY(t.x)) + 40, '낱말을 끝까지 치면 휴대폰이 날아가요')]; });
await page.waitForTimeout(700);
await page.evaluate(() => { const e = globalThis.__TYPECODE__.run.engine; e.robots = []; e.items = []; const r = e.spawnRobot('basic', 1); r.x = 0.12; });
await page.waitForTimeout(900);
await capture(page, 'throw-life', () => { const [e, R, W, H] = __ctx(); return [
  __box(W, H, 50, 17, 96, 26, '생명이 1칸 줄었어요'),
  __box(W, H, W / 2, R.dangerY, W - 12, 14, '로봇이 이 선에 닿으면 생명 −1')]; });
await page.evaluate(() => { const e = globalThis.__TYPECODE__.run.engine; e.robots = []; globalThis.__i1 = e.spawnItem(1, 'battery'); globalThis.__i2 = e.spawnItem(3, 'laptop'); globalThis.__i1.x = 0.55; globalThis.__i2.x = 0.7; });
await page.waitForTimeout(300);
await capture(page, 'throw-items', () => { const [e, R, W, H] = __ctx(); return [
  __ent(e, R, W, H, globalThis.__i1, 80, 76, -16, '🔋 건전지 — 낱말을 치면 생명 회복'),
  __ent(e, R, W, H, globalThis.__i2, 80, 76, -16, '💻 노트북 — 8초간 두 개씩 던짐')]; });
await page.evaluate(() => { const e = globalThis.__TYPECODE__.run.engine; e.robots = []; e.items = [];
  globalThis.__shield = e.spawnFormation('shieldWall'); [0.5, 0.63, 0.76].forEach((x, i) => globalThis.__shield[i] && (globalThis.__shield[i].x = x));
  globalThis.__twins = e.spawnFormation('twins'); globalThis.__twins.forEach(r => r.x = 0.4);
  globalThis.__mirror = e.spawnFormation('mirror'); globalThis.__mirror[0].x = 0.66; });
await page.waitForTimeout(300);
await capture(page, 'throw-special', () => { const [e, R, W, H] = __ctx(); const up = r => 66 * R.depthScale(r.x); const sh = globalThis.__shield.filter(Boolean);
  return [
  __rbox(W, H, globalThis.__twins.map(r => r.id), '쌍둥이 — 같은 낱말, 한 번 치면 둘 다', { up: up(globalThis.__twins[0]) }),
  __rbox(W, H, sh.map(r => r.id), '방패 편대 — 🔒 방패봇(맨 앞)부터', { up: up(sh[sh.length - 1]) + 10 }),
  __ent(e, R, W, H, globalThis.__mirror[0], 0, 0, 0, '거울봇 — 글자가 거꾸로 보여요')]; });
await page.evaluate(() => { const e = globalThis.__TYPECODE__.run.engine; e.robots = []; e.pads = []; e.bossPhase = null; e.bossKind = 'printer'; e.kills.basic = 50; e.checkGoal(); e.gameTime = e.bossAt; e.stepBossWave(); const b = e.boss(); b.x = 0.62; e.nextPadAt = Infinity; e.useSkill(b, 'spray'); e.pads.forEach(p => p.x = 0.42); });
await page.waitForTimeout(300);
await capture(page, 'throw-boss', () => { const [e, R, W, H] = __ctx(); const b = e.boss(); const label = __rect(b.id); return [
  __box(W, H, W / 2, 46, W * 0.44, 18, '보스 체력'),
  label ? __box(W, H, W / 2, (60 + label.top + label.height) / 2, W * 0.5, label.top + label.height - 60 + 8, '보스 — 아래 낱말을 쳐서 맞히기') : null,
  ...e.pads.slice(0, 1).map(p => __ent(e, R, W, H, p, 0, 0, 0, '날아오는 종이 — 낱말을 쳐서 막기'))]; });
save('throw'); console.log(word, errors); await browser.close();
