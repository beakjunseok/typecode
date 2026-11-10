import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  TimeAttackEngine, TIME_ATTACK_RULES, TIME_ATTACK_MAX_SECONDS_PER_CHARACTER, rawTimeBonus, timeBonusDecay
} from '../public/js/time-attack-engine.js';
import { calculateCharactersPerMinute, calculateWordsPerMinute } from '../public/js/engine.js';

const POOL = [
  { text: 'let', kind: 'keyword' },
  { text: 'return', kind: 'keyword' },
  { text: '=>', kind: 'operator' }
];

function seededRandom(seed = 7) {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

function createEngine() {
  const events = [];
  const engine = new TimeAttackEngine({ tokenPool: POOL, random: seededRandom(), onEvent: (type, payload) => events.push({ type, payload }) });
  return { engine, events };
}

function typeCurrent(engine, nowMs) {
  let result;
  for (const character of engine.current.text) result = engine.input(character, nowMs);
  return result;
}

test('시작 20초, 토큰을 완성하면 남은 시간이 늘어난다', () => {
  const { engine, events } = createEngine();
  engine.input(engine.current.text[0], 0);
  assert.equal(engine.status, 'running');
  assert.equal(engine.snapshot(0).remainingSeconds, TIME_ATTACK_RULES.startSeconds);
  const length = engine.current.text.length;
  for (const character of engine.current.text.slice(1)) engine.input(character, 1000);
  const token = events.find(event => event.type === 'token').payload;
  const expected = rawTimeBonus({ length, clean: true, tier: 0, elapsedSeconds: 1 });
  assert.ok(Math.abs(token.timeBonus - expected) < 0.01, `보너스 ${token.timeBonus} ≈ ${expected}`);
  assert.ok(engine.snapshot(1000).remainingExact > 19 + expected - 0.01);
});

test('오타가 있었던 토큰은 보너스 40%, 긴 토큰일수록 보너스가 크다', () => {
  const clean = rawTimeBonus({ length: 6, clean: true, tier: 0, elapsedSeconds: 0 });
  const dirty = rawTimeBonus({ length: 6, clean: false, tier: 0, elapsedSeconds: 0 });
  assert.ok(Math.abs(dirty - clean * TIME_ATTACK_RULES.dirtyFactor) < 1e-9);
  assert.ok(rawTimeBonus({ length: 8, clean: true, tier: 0, elapsedSeconds: 0 }) > rawTimeBonus({ length: 3, clean: true, tier: 0, elapsedSeconds: 0 }));
  assert.ok(rawTimeBonus({ length: 5, clean: true, tier: 2, elapsedSeconds: 0 }) > rawTimeBonus({ length: 5, clean: true, tier: 0, elapsedSeconds: 0 }), '콤보 단계 보너스');
});

test('보너스는 4분에 걸쳐 15%까지, 8분에 0까지 줄어든다', () => {
  assert.equal(timeBonusDecay(0), 1);
  assert.ok(Math.abs(timeBonusDecay(240) - TIME_ATTACK_RULES.decayFloor) < 1e-9);
  assert.ok(timeBonusDecay(120) < 1 && timeBonusDecay(120) > TIME_ATTACK_RULES.decayFloor);
  assert.ok(Math.abs(timeBonusDecay(360) - TIME_ATTACK_RULES.decayFloor / 2) < 1e-9);
  assert.equal(timeBonusDecay(480), 0);
  assert.equal(timeBonusDecay(10_000), 0);
});

test('남은 시간은 30초 넘게 쌓이지 않는다', () => {
  const { engine } = createEngine();
  let now = 0;
  for (let round = 0; round < 60; round++) {
    typeCurrent(engine, now);
    now += 50;
  }
  const snapshot = engine.snapshot(now);
  assert.ok(snapshot.remainingExact <= TIME_ATTACK_RULES.maxBankSeconds + 1e-6, `남은 ${snapshot.remainingExact}`);
  assert.ok(snapshot.remainingRatio <= 1 + 1e-9);
});

test('마감 시간이 지나면 끝나고, 생존 시간·타수가 요약에 담긴다', () => {
  const { engine, events } = createEngine();
  typeCurrent(engine, 0);
  typeCurrent(engine, 2000);
  const deadline = engine.deadlineSeconds();
  engine.update(deadline * 1000 - 10);
  assert.equal(engine.status, 'running');
  engine.update(deadline * 1000 + 10);
  assert.equal(engine.status, 'finished');
  const summary = events.find(event => event.type === 'finish').payload.summary;
  assert.equal(summary.mode, 'timeattack');
  assert.equal(summary.survivedSeconds, Math.floor(deadline));
  assert.equal(summary.charactersPerMinute, calculateCharactersPerMinute(summary.correctKeystrokes, deadline));
  assert.equal(summary.wordsPerMinute, calculateWordsPerMinute(summary.correctKeystrokes, deadline));
  assert.ok(summary.timeBonusTotal > 0);
  assert.equal(summary.wordsPerMinuteTimeline.length, Math.ceil(deadline));
  assert.equal(engine.input('x', deadline * 1000 + 50).accepted, false, '끝난 뒤 입력 무시');
});

test('서버가 허용하는 최고 속도(초당 25타, 오타 0)로 쳐도 510초 안에 반드시 끝난다', () => {
  const engine = new TimeAttackEngine({ tokenPool: [{ text: ';', kind: 'punctuation' }], random: seededRandom() });
  let now = 0;
  engine.input(';', now);
  while (engine.status === 'running' && now < 2_000_000) {
    now += 1000 / 25;
    engine.input(';', now);
  }
  assert.equal(engine.status, 'finished');
  assert.ok(engine.summary().survivedSeconds <= TIME_ATTACK_RULES.maxSessionSeconds, `생존 ${engine.summary().survivedSeconds}s`);
});

test('보통 속도(분당 200타)는 20초 시작 시간보다 오래 버티지만 몇 분 안에 끝난다', () => {
  const { engine } = createEngine();
  let now = 0;
  engine.input(engine.current.text[0], now);
  while (engine.status === 'running' && now < 2_000_000) {
    now += 300;
    engine.input(engine.current.text[engine.typed.length], now);
  }
  const survived = engine.summary().survivedSeconds;
  assert.ok(survived > TIME_ATTACK_RULES.startSeconds && survived < 300, `생존 ${survived}s`);
});

test('서버 상한: 생존 시간 ≤ 시작 시간 + 정타 × 글자당 최대 보너스', () => {
  const { engine } = createEngine();
  let now = 0;
  engine.input(engine.current.text[0], now);
  while (engine.status === 'running' && now < 2_000_000) {
    now += 100;
    engine.input(engine.current.text[engine.typed.length], now);
  }
  const summary = engine.summary();
  assert.ok(summary.survivedSeconds <= TIME_ATTACK_RULES.startSeconds + summary.correctKeystrokes * TIME_ATTACK_MAX_SECONDS_PER_CHARACTER);
});

test('고정 시간 연습 모드도 타수를 계산한다', async () => {
  const { TypingEngine } = await import('../public/js/engine.js');
  const engine = new TypingEngine({ tokenPool: POOL, durationSeconds: 30, random: seededRandom() });
  typeCurrent(engine, 0);
  typeCurrent(engine, 6000);
  const snapshot = engine.snapshot(6000);
  assert.equal(snapshot.charactersPerMinute, calculateCharactersPerMinute(engine.correctKeystrokes, 6));
  assert.equal(snapshot.mode, 'practice');
  engine.update(31_000);
  assert.equal(engine.summary().charactersPerMinute, calculateCharactersPerMinute(engine.correctKeystrokes, 30));
});
