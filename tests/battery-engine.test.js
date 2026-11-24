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
  advance(engine, clock, 12);
  assert.ok(engine.me.cells < BATTERY_RULES.startCells - 0.3);
  assert.ok(Math.abs(engine.me.cells - engine.rival.cells) < 1e-9);
});

test('지나가는 셀을 치면 +0.5, 보조배터리는 등급만큼(일반 +0.8)', () => {
  const { engine, clock } = setup();
  freezeAi(engine); noSpawns(engine);
  const cell = engine.spawnItem('cell', 0.3, 1);
  const before = engine.me.cells;
  typeText(engine, clock, cell.token.text);
  advance(engine, clock, 0.3);
  assert.ok(engine.me.cells > before + 0.45);
  const powerbank = engine.spawnItem('powerbank', 0.5, -1, null, 'common');
  const mid = engine.me.cells;
  typeText(engine, clock, powerbank.token.text);
  advance(engine, clock, 0.3);
  assert.ok(engine.me.cells > mid + 0.75);
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
  assert.equal(engine.outcome, 'rival-sunk', '상대 0 → 승리');
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

test('8칸 충전 → 구조 승리, 클리어 연출 뒤 게임 종료(그동안 입력 무시)', () => {
  const { engine, clock, events } = setup();
  freezeAi(engine); noSpawns(engine);
  engine.correctKeystrokes = 100;
  engine.me.cells = BATTERY_RULES.goalCells - 0.1;
  const item = engine.spawnItem('powerbank', 0.3, 1);
  typeText(engine, clock, item.token.text);
  advance(engine, clock, 0.3);
  const clear = events.find(event => event.type === 'stage-clear');
  assert.ok(clear);
  assert.equal(clear.payload.how, 'charged');
  assert.equal(engine.outcome, 'rescued');
  assert.equal(engine.status, 'running', '연출 중');
  assert.equal(engine.input('x', clock.now).accepted, false);
  advance(engine, clock, BATTERY_RULES.stageClearPause + 0.2);
  assert.equal(engine.status, 'finished');
  assert.equal(engine.summary().outcome, 'rescued');
});

test('스테이지 보너스는 이번 스테이지에 친 글자 수로 상한 (가만히 있어도 점수 폭증 없음)', () => {
  const { engine, clock } = setup();
  freezeAi(engine); noSpawns(engine);
  engine.rival.cells = 0.01;
  advance(engine, clock, 0.5);
  assert.equal(engine.outcome, 'rival-sunk');
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
  assert.ok(engine.throws > 5, `던짐 ${engine.throws}`);
  assert.equal(engine.status, 'finished');
  assert.ok(['rescued', 'rival-sunk'].includes(engine.summary().outcome), `결과 ${engine.summary().outcome}`);
  assert.ok(engine.score <= engine.correctKeystrokes * BATTERY_MAX_POINTS_PER_CHARACTER);
  assert.ok(Object.keys(BATTERY_ITEMS).every(key => key in engine.summary().collected));
});

test('따라잡기 도움: 내 탑이 낮으면 방전봇이 느려진다', () => {
  const { engine } = setup();
  engine.me.cells = BATTERY_RULES.mercyCells + 1;
  const normal = engine.aiCharactersPerSecond();
  engine.me.cells = BATTERY_RULES.mercyCells;
  assert.ok(Math.abs(engine.aiCharactersPerSecond() - normal * BATTERY_RULES.mercyFactor) < 1e-9);
});

test('혼자 하기 상대 캐릭터: 레벨마다 다른 이름, 그림 쪽 이름과 같다', async () => {
  const { DRAIN_BOTS } = await import('../public/js/battery-characters.js');
  const names = [1, 2, 3, 4].map(level => setup({ level }).engine.rivalName);
  assert.equal(new Set(names).size, 4);
  names.forEach((name, index) => assert.equal(name, DRAIN_BOTS[index + 1].name));
});

import { PERSONAS, PERSONA_ORDER, WEATHERS, WEATHER_ORDER, ITEM_LOOKS, pickWeather, mirrorProfile } from '../public/js/battery-modes.js';
import { ITEM_EFFECTS } from '../public/js/battery-engine.js';

function setupMode(options = {}, seed = 13) {
  const events = [];
  const engine = new BatteryEngine({ tokenPool: getTokenPool('python'), level: 2, random: seeded(seed), onEvent: (type, payload) => events.push({ type, payload }), ...options });
  const clock = { now: 0 };
  engine.start(0);
  return { engine, events, clock };
}

test('성격 6종: 모양·도발·아이템 모양이 모두 갖춰져 있다', () => {
  assert.equal(PERSONA_ORDER.length, 6);
  for (const key of PERSONA_ORDER) {
    const persona = PERSONAS[key];
    assert.ok(persona.name && persona.icon && persona.look.glow, key);
    for (const kind of ['start', 'win', 'lose']) assert.ok(persona.taunts[kind]?.length, `${key}.${kind}`);
  }
  for (const key of Object.keys(BATTERY_ITEMS)) {
    assert.ok(ITEM_LOOKS[key], key);
    assert.ok(BATTERY_ITEMS[key].hint && BATTERY_ITEMS[key].about, `${key} 설명`);
  }
});

test('혼자 하기: 아이템 12종이 무작위로 나오고 셀은 절반쯤', () => {
  const { engine } = setupMode({ persona: 'rusher' });
  const rolls = Array.from({ length: 4000 }, () => engine.chooseItemType());
  const seen = new Set(rolls);
  assert.equal(seen.size, Object.keys(BATTERY_ITEMS).length);
  const cellShare = rolls.filter(item => item === 'cell').length / rolls.length;
  assert.ok(cellShare > 0.43 && cellShare < 0.57, `셀 비율 ${cellShare}`);
});

test('고정 목록(deck, 시험용): 셀 + 그 4개만 나온다', () => {
  const deck = ['reflect', 'magnet', 'trap', 'lucky'];
  const { engine } = setupMode({ deck, persona: 'rusher' });
  const seen = new Set(Array.from({ length: 400 }, () => engine.chooseItemType()));
  for (const item of seen) assert.ok(['cell', ...deck].includes(item), item);
  assert.ok(seen.size >= 3);
});

test('반사 방패: 일반은 막기만, 희귀부터 뺏으려던 쪽이 거꾸로 셀을 잃는다', () => {
  const { engine, events } = setupMode({ persona: 'rusher' });
  engine.applyItem(engine.me, engine.rival, { item: 'reflect', rarity: 'common' });
  let before = { me: engine.me.cells, rival: engine.rival.cells };
  let result = engine.steal(engine.rival, engine.me);
  assert.equal(result.reflected, true);
  assert.equal(engine.me.cells, before.me);
  assert.equal(engine.rival.cells, before.rival);
  assert.equal(engine.me.reflect, -1);
  engine.applyItem(engine.me, engine.rival, { item: 'reflect', rarity: 'legendary' });
  before = { me: engine.me.cells, rival: engine.rival.cells };
  result = engine.steal(engine.rival, engine.me);
  assert.ok(engine.rival.cells < before.rival - 1);
  assert.ok(engine.me.cells > before.me + 1);
  assert.ok(events.some(event => event.type === 'reflect'));
});

test('백신 패치: 면역 중엔 뺏기도 막힌다', () => {
  const { engine, events } = setupMode({ persona: 'rusher' });
  engine.applyItem(engine.me, engine.rival, { item: 'cleanse', rarity: 'common' });
  const before = engine.me.cells;
  const result = engine.steal(engine.rival, engine.me);
  assert.equal(result.blocked, true);
  assert.equal(engine.me.cells, before);
  assert.ok(events.some(event => event.type === 'immune-block'));
});

test('오버클럭: 뺏는 양이 2배', () => {
  const { engine } = setupMode({ persona: 'rusher' });
  engine.rival.cells = 3;
  engine.me.overclockUntil = engine.gameTime + 5;
  const result = engine.steal(engine.me, engine.rival);
  assert.equal(result.stolen, BATTERY_RULES.stealCells * ITEM_EFFECTS.overclockFactor);
});

test('난독화와 백신: 면역 중엔 난독화가 막힌다', () => {
  const { engine } = setupMode({ persona: 'rusher' });
  engine.applyItem(engine.rival, engine.me, { item: 'obfuscate' });
  assert.ok(engine.me.obfuscatedUntil > engine.gameTime);
  engine.applyItem(engine.me, engine.rival, { item: 'cleanse' });
  assert.equal(engine.me.obfuscatedUntil, 0);
  engine.applyItem(engine.rival, engine.me, { item: 'obfuscate' });
  assert.equal(engine.me.obfuscatedUntil, 0);
});

test('함정 셀: 놓은 쪽은 무해, 상대는 손해', () => {
  const { engine, events } = setupMode({ persona: 'rusher' });
  const before = engine.me.cells;
  engine.applyItem(engine.me, engine.rival, { item: 'cell', trapOwner: 'rival', trapLoss: 1 });
  assert.equal(engine.me.cells, before - 1);
  assert.ok(events.some(event => event.type === 'trap-sprung'));
  const rivalBefore = engine.rival.cells;
  engine.applyItem(engine.rival, engine.me, { item: 'cell', trapOwner: 'rival' });
  assert.equal(engine.rival.cells, rivalBefore);
});

test('셀 자석: 화면 안 셀을 바로 가져간다(함정은 제외)', () => {
  const { engine, events } = setupMode({ persona: 'rusher' });
  engine.applyItem(engine.me, engine.rival, { item: 'magnet', rarity: 'common' });
  assert.equal(engine.me.magnetCharges, 2);
  assert.equal(engine.magnetPull({ id: 900, item: 'cell', x: 0.5 }), true);
  assert.equal(engine.magnetPull({ id: 901, item: 'cell', x: 0.5, trapOwner: 'rival' }), false);
  assert.equal(engine.magnetPull({ id: 902, item: 'heat', x: 0.5 }), false);
  assert.equal(engine.magnetPull({ id: 903, item: 'cell', x: 0.5 }), true);
  assert.equal(engine.magnetPull({ id: 904, item: 'cell', x: 0.5 }), false, '자석 횟수 다 씀');
  assert.ok(events.some(event => event.type === 'magnet-take'));
});

test('날씨: 파도는 10초마다 크게 가라앉고, 썰물은 덜 가라앉는다', () => {
  const calm = setupMode({ persona: 'rusher', weather: 'calm' }).engine;
  const ebb = setupMode({ persona: 'rusher', weather: 'ebb' }).engine;
  assert.ok(ebb.sinkPerSecond() < calm.sinkPerSecond());
  const { engine, events, clock } = setupMode({ persona: 'rusher', weather: 'waves' });
  freezeAi(engine);
  noSpawns(engine);
  advance(engine, clock, WEATHERS.waves.every + 0.2);
  assert.ok(events.some(event => event.type === 'big-wave'));
  assert.ok(engine.gameTime < engine.waveUntil);
  assert.ok(engine.sinkPerSecond() > calm.sinkPerSecond());
});

test('날씨 뽑기: 같은 날씨가 연달아 나오지 않는다', () => {
  const random = seeded(5);
  let previous = 'calm';
  for (let round = 0; round < 50; round++) {
    const next = pickWeather(random, previous);
    assert.ok(WEATHER_ORDER.includes(next));
    assert.notEqual(next, previous);
    previous = next;
  }
});

test('미러봇 프로필: 이상한 값은 안전한 범위로', () => {
  const profile = mirrorProfile({ charactersPerSecond: 999, attacks: 5, collects: 0 });
  assert.ok(profile.cps > 0 && profile.cps < 20);
  assert.ok(profile.attack >= 0 && profile.attack <= 1);
  const empty = mirrorProfile(null);
  assert.ok(empty.cps > 0);
});
