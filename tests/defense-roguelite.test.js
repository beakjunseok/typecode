import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DefenseEngine, DEFENSE_RULES, DEFAULT_PATH, createRandomPath, towerStats, PLACEMENT, TOWER_TYPES } from '../public/js/defense-engine.js';
import { generatePathPoints, MAP_RULES, PATH_END } from '../public/js/defense-map.js';
import { DEFENSE_CARDS, CARD_RULES, drawCards, cardById } from '../public/js/defense-cards.js';

const POOL = ['let', 'var', 'map', 'if', 'do', 'go', 'use', 'mut', 'xor', 'nil', 'new', 'try', 'int', 'out', 'end']
  .map(text => ({ text, kind: 'keyword' }));

function seeded(seed = 3) {
  let state = seed;
  return () => ((state = (state * 1664525 + 1013904223) % 4294967296) / 4294967296);
}

function setup(overrides = {}) {
  const events = [];
  const engine = new DefenseEngine({ tokenPool: POOL, random: seeded(), onEvent: (type, payload) => events.push({ type, payload }), ...overrides });
  engine.start(1000);
  return { engine, events };
}

// 지금 웨이브를 막은 것처럼 만든다(다 내보냈고 살아 있는 적 없음)
function clearWave(engine, wave) {
  engine.wave = wave;
  engine.phase = 'spawning';
  engine.waveTotal = 1;
  engine.waveSpawned = 1;
  engine.bugs = [];
  engine.checkWaveClear();
}

test('랜덤 맵: 위에서 시작해 PATH_END에서 끝나고, 줄끼리 rowGap 이상 떨어지며, 길이·범위 규칙을 지킨다(시드 300개)', () => {
  let made = 0;
  const shapes = new Set();
  for (let seed = 1; seed <= 300; seed++) {
    const points = generatePathPoints(seeded(seed));
    if (!points) continue;
    made++;
    shapes.add(JSON.stringify(points));
    assert.equal(points[0].y, 0, '들판 위에서 들어온다');
    assert.deepEqual(points.at(-1), { ...PATH_END }, '컴퓨터 위에서 끝난다');
    for (const point of points) assert.ok(point.x >= 0.04 && point.x <= 0.96 && point.y >= 0 && point.y <= PATH_END.y, '들판 안');
    const rows = [...new Set(points.slice(1).map(point => point.y))].sort((a, b) => a - b);
    for (let index = 1; index < rows.length; index++) assert.ok(rows[index] - rows[index - 1] >= MAP_RULES.rowGap - 1e-9, '줄 간격');
    const length = points.slice(1).reduce((sum, point, index) => sum + Math.hypot(point.x - points[index].x, point.y - points[index].y), 0);
    assert.ok(length >= MAP_RULES.length[0] && length <= MAP_RULES.length[1], `길이 ${length}`);
  }
  assert.ok(made >= 290, `거의 항상 만들어진다 (${made}/300)`);
  assert.ok(shapes.size >= 250, '판마다 다른 모양');
});

test('같은 시드면 같은 맵, 맵마다 이름·추천 자리가 있다', () => {
  assert.deepEqual(generatePathPoints(seeded(7)), generatePathPoints(seeded(7)));
  const path = createRandomPath(seeded(9));
  assert.ok(path.name.includes('굽이'));
  assert.ok(path.candidates.length > 10);
  assert.ok(path.candidates.every(spot => !path.isOn(spot)));
});

test('randomMap 엔진: 적이 그 맵의 길을 따라 걷고, 길 위에는 타워를 못 놓는다', () => {
  const { engine } = setup({ randomMap: true, random: seeded(11) });
  assert.notEqual(engine.path, DEFAULT_PATH);
  const bug = engine.spawnBug('packet');
  assert.deepEqual({ x: bug.x, y: bug.y }, engine.path.pointAt(0));
  const onRoad = engine.path.pointAt(0.5);
  assert.equal(engine.placementProblem(onRoad), 'path');
  assert.ok(engine.suggestedSpots().every(spot => !engine.path.isOn(spot)));
  assert.equal(engine.snapshot().map, engine.path.name);
});

test('기본 엔진은 예전 길 그대로', () => {
  const { engine } = setup();
  assert.equal(engine.path, DEFAULT_PATH);
});

test('카드 뽑기: 겹치지 않게 3장, 최대 횟수에 닿은 카드는 안 나온다', () => {
  const hand = drawCards([], seeded(5));
  assert.equal(hand.length, CARD_RULES.choices);
  assert.equal(new Set(hand).size, hand.length);
  const maxed = DEFENSE_CARDS.flatMap(card => Array(card.max).fill(card.id)).filter(id => id !== 'patch');
  for (let seed = 1; seed < 40; seed++) assert.deepEqual(drawCards(maxed, seeded(seed)), drawCards(maxed, seeded(seed)).filter(id => id === 'patch'));
  assert.deepEqual(drawCards(DEFENSE_CARDS.flatMap(card => Array(card.max).fill(card.id)), seeded(1)), []);
});

test('카드 고르기: 3웨이브마다 멈추고(낱말 입력 막힘), 숫자 키로 고르면 적용되고 쉬는 시간으로', () => {
  const { engine, events } = setup({ cards: true });
  clearWave(engine, 2);
  assert.equal(engine.phase, 'break', '2웨이브 뒤에는 카드 없음');
  clearWave(engine, 3);
  assert.equal(engine.phase, 'draft');
  assert.equal(engine.draft.hand.length, 3);
  assert.ok(events.some(event => event.type === 'draft'));
  assert.equal(engine.input(engine.stream[0].token.text[0], 2000).accepted, false, '고르는 동안 타자 수입 없음');
  const chosen = engine.draft.hand[1];
  assert.equal(engine.hotkey('2'), true);
  assert.equal(engine.phase, 'break');
  assert.deepEqual(engine.cards, [chosen]);
  assert.ok(events.some(event => event.type === 'card-picked' && event.payload.card === chosen));
  assert.equal(engine.chooseCard(0), false, '이미 골랐으면 더 못 고른다');
});

test('카드 없는 엔진은 3웨이브 뒤에도 바로 쉬는 시간', () => {
  const { engine } = setup();
  clearWave(engine, 3);
  assert.equal(engine.phase, 'break');
});

test('카드 효과: 타워 능력치·코인·가격·체력·백업 서버', () => {
  const { engine } = setup({ cards: true });
  const tower = { type: 'antivirus', level: 1 };
  const base = towerStats('antivirus', 1);
  const pick = id => {
    engine.phase = 'draft';
    engine.draft = { wave: 3, hand: [id] };
    assert.equal(engine.chooseCard(0), true);
  };
  pick('antenna');
  pick('overclock');
  pick('vaccine');
  pick('awaken');
  const stats = engine.statsOf(tower);
  assert.ok(Math.abs(stats.range - (base.range + 0.025)) < 1e-9);
  assert.ok(Math.abs(stats.cooldown - base.cooldown * 0.88) < 1e-9);
  assert.ok(Math.abs(stats.damage - base.damage * 1.35 * 1.25) < 1e-9);
  pick('bulk');
  assert.equal(engine.priceAt('antivirus', null), Math.round(TOWER_TYPES.antivirus.price * (DEFENSE_RULES.priceFactor[engine.level] ?? 1) * 0.9));
  const maxBefore = engine.maxHealth;
  pick('heatsink');
  assert.equal(engine.maxHealth, maxBefore + 20);
  pick('backup');
  engine.health = 1;
  engine.breach({ type: 'malware', state: 'alive' });
  assert.equal(engine.status, 'running', '백업 서버로 살아남음');
  assert.equal(engine.health, Math.round(engine.maxHealth * 0.5));
  engine.health = 1;
  engine.breach({ type: 'malware', state: 'alive' });
  assert.notEqual(engine.status, 'running', '백업은 한 번만');
});

test('모든 카드는 이름·설명·효과가 있고 id가 겹치지 않는다', () => {
  assert.equal(new Set(DEFENSE_CARDS.map(card => card.id)).size, DEFENSE_CARDS.length);
  for (const card of DEFENSE_CARDS) {
    assert.ok(card.name && card.text && card.icon && card.max >= 1);
    assert.ok(typeof card.apply === 'function' || typeof card.instant === 'function', card.id);
    assert.ok(['common', 'rare', 'epic'].includes(card.rarity));
    assert.equal(cardById(card.id), card);
  }
  assert.ok(PLACEMENT.pathClear);
});
