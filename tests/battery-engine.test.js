import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BatteryEngine, BATTERY_RULES, BATTERY_ITEMS, BATTERY_MAX_POINTS_PER_CHARACTER } from '../public/js/battery-engine.js';
import { getTokenPool } from '../public/js/tokens.js';

function seeded(seed = 13) {
  let state = seed;
  return () => ((state = (state * 1664525 + 1013904223) % 4294967296) / 4294967296);
}

function setup({ level = 2, seed = 13 } = {}) {
  const events = [];
  const engine = new BatteryEngine({ tokenPool: getTokenPool('python'), level, random: seeded(seed), onEvent: (type, payload) => events.push({ type, payload }) });
  const clock = { now: 0 };
  engine.start(0);
  return { engine, events, clock };
}

const advance = (engine, clock, seconds, step = 0.05) => {
  for (let elapsed = 0; elapsed < seconds - 1e-9 && engine.status === 'running'; elapsed += step) {
    clock.now += step * 1000;
    engine.update(clock.now);
  }
};
const typeText = (engine, clock, text) => [...text].map(character => engine.input(character, clock.now)).at(-1);
const freezeAi = engine => { engine.ai.pausedUntil = Infinity; };
const noSpawns = engine => { engine.nextItemAt = Infinity; };

test('점수 상한 상수와 시작 상태', () => {
  const { engine } = setup();
  assert.equal(BATTERY_MAX_POINTS_PER_CHARACTER, 35);
  assert.equal(engine.me.cells, BATTERY_RULES.startCells);
  assert.equal(engine.rival.cells, BATTERY_RULES.startCells);
  assert.equal(engine.lives, 1);
});

test('두 탑은 시간이 지나면 방전(침몰)된다', () => {
  const { engine, clock } = setup();
  freezeAi(engine); noSpawns(engine);
  advance(engine, clock, 5);
  assert.ok(engine.me.cells < BATTERY_RULES.startCells - 0.3);
  assert.ok(Math.abs(engine.me.cells - engine.rival.cells) < 1e-9);
});

test('지나가는 셀을 치면 +0.5, 보조배터리는 +1', () => {
  const { engine, clock } = setup();
  freezeAi(engine); noSpawns(engine);
  const cell = engine.spawnItem('cell', 0.3, 1);
  const before = engine.me.cells;
  typeText(engine, clock, cell.token.text);
  advance(engine, clock, 0.3);
  assert.ok(engine.me.cells > before + 0.45);
  const powerbank = engine.spawnItem('powerbank', 0.5, -1);
  const mid = engine.me.cells;
  typeText(engine, clock, powerbank.token.text);
  advance(engine, clock, 0.3);
  assert.ok(engine.me.cells > mid + 0.95);
});

test('뺏기: 상대 탑 낱말을 치면 상대 −0.5 · 나 +0.5, 낱말은 바로 새로 바뀐다', () => {
  const { engine, clock, events } = setup();
  freezeAi(engine); noSpawns(engine);
  const word = engine.rivalWord.token.text;
  const rivalBefore = engine.rival.cells;
  const meBefore = engine.me.cells;
  typeText(engine, clock, word);
  assert.notEqual(engine.rivalWord.token.text, word, '새 낱말');
  advance(engine, clock, 0.3);
  const drift = engine.sinkPerSecond() * 0.4;
  assert.ok(Math.abs((rivalBefore - engine.rival.cells) - 0.5) < drift + 0.01, `상대 ${rivalBefore} → ${engine.rival.cells}`);
  assert.ok(Math.abs((engine.me.cells - meBefore) - 0.5) < drift + 0.01, `나 ${meBefore} → ${engine.me.cells}`);
  assert.ok(events.some(event => event.type === 'drain' && event.payload.stolen === 0.5));
});

test('AI가 내가 치던 아이템을 먼저 끝내면 빼앗긴다 (원작의 선점 경쟁)', () => {
  const { engine, clock, events } = setup({ level: 4 });
  noSpawns(engine);
  const item = engine.spawnItem('cell', 0.4, 1);
  item.token = { text: 'enumerate', kind: 'builtin' };
  engine.ai.targetId = item.id;
  engine.ai.progress = 8.9;
  engine.ai.thinkUntil = 0;
  engine.input('e', clock.now);
  assert.equal(engine.targetId, item.id);
  advance(engine, clock, 0.1);
  assert.equal(item.takenBy, 'rival');
  assert.equal(engine.targetId, null, '내 조준 해제');
  assert.equal(engine.stolen, 1);
  assert.ok(events.some(event => event.type === 'rival-take'));
});

test('AI 뺏기: 방전봇이 내 탑 낱말을 다 치면 나 −0.5 · 방전봇 +0.5', () => {
  const { engine, clock, events } = setup();
  noSpawns(engine);
  engine.ai.targetId = engine.myWord.id;
  engine.ai.progress = engine.myWord.token.text.length - 0.01;
  const meBefore = engine.me.cells;
  const rivalBefore = engine.rival.cells;
  advance(engine, clock, 0.1);
  assert.ok(engine.me.cells < meBefore - 0.45);
  assert.ok(engine.rival.cells > rivalBefore + 0.45);
  assert.ok(events.some(event => event.type === 'rival-attack'));
});

test('뺏을 게 없으면 뺏지 못한다 (거의 바닥난 상대에게서 0.5를 만들어내지 않음)', () => {
  const { engine, clock } = setup();
  freezeAi(engine); noSpawns(engine);
  engine.rival.cells = 0.3;
  const meBefore = engine.me.cells;
  typeText(engine, clock, engine.rivalWord.token.text);
  advance(engine, clock, 0.3);
  assert.ok(engine.me.cells - meBefore <= 0.31);
  assert.equal(engine.stage, 2, '상대 0 → 스테이지 클리어');
});

test('아이템 효과: 저전력(내 방전 감속)·발열(상대 가속)·화면 꺼짐(AI 정지)', () => {
  const { engine, clock } = setup();
  noSpawns(engine);
  freezeAi(engine);
  for (const kind of ['eco', 'heat']) {
    const item = engine.spawnItem(kind, 0.3, 1);
    typeText(engine, clock, item.token.text);
    advance(engine, clock, 0.3);
  }
  const me = engine.me.cells;
  const rival = engine.rival.cells;
  advance(engine, clock, 2);
  const myLoss = me - engine.me.cells;
  const rivalLoss = rival - engine.rival.cells;
  assert.ok(rivalLoss > myLoss * 4, `${myLoss} vs ${rivalLoss}`);
  engine.ai.pausedUntil = 0;
  const blackout = engine.spawnItem('blackout', 0.5, 1);
  typeText(engine, clock, blackout.token.text);
  advance(engine, clock, 0.3);
  assert.ok(engine.ai.pausedUntil > engine.gameTime + 2.5);
});

test('8칸 충전 → 스테이지 클리어, 탑 초기화, 다음 스테이지는 더 빠르다', () => {
  const { engine, clock, events } = setup();
  freezeAi(engine); noSpawns(engine);
  const sinkBefore = engine.sinkPerSecond();
  engine.correctKeystrokes = 100;
  engine.me.cells = BATTERY_RULES.goalCells - 0.1;
  const item = engine.spawnItem('powerbank', 0.3, 1);
  typeText(engine, clock, item.token.text);
  advance(engine, clock, 0.3);
  const clear = events.find(event => event.type === 'stage-clear');
  assert.ok(clear);
  assert.equal(clear.payload.how, 'charged');
  assert.equal(engine.stage, 2);
  assert.equal(engine.me.cells, BATTERY_RULES.startCells);
  assert.ok(engine.sinkPerSecond() > sinkBefore);
});

test('스테이지 보너스는 이번 스테이지에 친 글자 수로 상한 (가만히 있어도 점수 폭증 없음)', () => {
  const { engine, clock } = setup();
  freezeAi(engine); noSpawns(engine);
  engine.rival.cells = 0.01;
  advance(engine, clock, 0.5);
  assert.equal(engine.stage, 2);
  assert.equal(engine.score, 0);
});

test('내 탑이 0이 되면 패배 → 게임 종료', () => {
  const { engine, clock, events } = setup();
  freezeAi(engine); noSpawns(engine);
  engine.me.cells = 0.01;
  engine.rival.cells = 2;
  advance(engine, clock, 0.5);
  assert.equal(engine.status, 'finished');
  assert.equal(engine.summary().outcome, 'sunk');
  assert.ok(events.some(event => event.type === 'finish'));
});

test('긴 플레이: 점수 상한 유지, 아이템은 겹치지 않는 높이에 등장', () => {
  const engine = new BatteryEngine({ tokenPool: getTokenPool('go'), level: 2, random: seeded(7) });
  let now = 0;
  engine.start(0);
  for (let frame = 0; frame < 6000 && engine.status === 'running'; frame++) {
    now += 50;
    engine.update(now);
    if (frame % 2 === 0) {
      const target = engine.target ?? engine.targetables().sort((a, b) => engine.targetPriority(a) - engine.targetPriority(b))[0];
      if (target) engine.input(target.token.text[engine.typed.length] ?? target.token.text[0], now);
    }
    const ys = engine.items.filter(item => !item.consumed).map(item => item.y).sort((a, b) => a - b);
    for (let index = 1; index < ys.length; index++) assert.ok(ys[index] - ys[index - 1] >= BATTERY_RULES.itemGap - 1e-9);
  }
  assert.ok(engine.throws > 30);
  assert.ok(engine.stagesCleared >= 1, `클리어 ${engine.stagesCleared}`);
  assert.ok(engine.score <= engine.correctKeystrokes * BATTERY_MAX_POINTS_PER_CHARACTER);
  assert.ok(Object.keys(BATTERY_ITEMS).every(key => key in engine.summary().collected));
});
