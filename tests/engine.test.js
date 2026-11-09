import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  TypingEngine, SCORING, MAX_MULTIPLIER, getTierIndex, getTierProgress, getMultiplier
} from '../public/js/engine.js';

const POOL = [
  { text: 'let', kind: 'keyword' },
  { text: 'fn', kind: 'keyword' },
  { text: '=>', kind: 'operator' }
];

// 결정적 난수: 테스트마다 같은 토큰 순서를 보장
function seededRandom(seed = 42) {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

function createEngine(overrides = {}) {
  const events = [];
  const engine = new TypingEngine({
    tokenPool: POOL, durationSeconds: 30, random: seededRandom(), onEvent: (type, payload) => events.push({ type, payload }),
    ...overrides
  });
  return { engine, events };
}

function typeCurrentToken(engine, nowMs) {
  let result;
  for (const character of engine.current.text) result = engine.input(character, nowMs);
  return result;
}

test('배율 단계 경계', () => {
  assert.equal(getTierIndex(0), 0);
  assert.equal(getTierIndex(9), 0);
  assert.equal(getTierIndex(10), 1);
  assert.equal(getTierIndex(29), 1);
  assert.equal(getTierIndex(30), 2);
  assert.equal(getMultiplier(31), MAX_MULTIPLIER);
  assert.deepEqual(getTierProgress(5), { index: 0, ratio: 0.5, remaining: 5, nextMultiplier: 1.5 });
  assert.equal(getTierProgress(40).ratio, 1);
});

test('잘못된 설정은 생성 시 거부', () => {
  assert.throws(() => new TypingEngine({ tokenPool: [], durationSeconds: 30 }));
  assert.throws(() => new TypingEngine({ tokenPool: POOL, durationSeconds: 45 }));
});

test('첫 입력이 타이머를 시작하고, 큐는 항상 가득 차 있다', () => {
  const { engine, events } = createEngine();
  assert.equal(engine.status, 'ready');
  assert.equal(engine.queue.length, 8);
  engine.input(engine.current.text[0], 1000);
  assert.equal(engine.status, 'running');
  assert.equal(engine.startedAt, 1000);
  assert.equal(events[0].type, 'start');
});

test('직전 토큰과 같은 토큰이 연속으로 나오지 않는다', () => {
  const { engine } = createEngine();
  let previous = engine.current.text;
  for (let index = 0; index < 200; index++) {
    typeCurrentToken(engine, 1000);
    assert.notEqual(engine.current.text, previous);
    previous = engine.current.text;
  }
});

test('클린 토큰 10개면 콤보 10, 배율 단계 상승 이벤트', () => {
  const { engine, events } = createEngine();
  for (let index = 0; index < 10; index++) typeCurrentToken(engine, 1000);
  assert.equal(engine.combo, 10);
  const tokenEvents = events.filter(event => event.type === 'token');
  assert.equal(tokenEvents.length, 10);
  assert.equal(tokenEvents[9].payload.tierUp, true);
  assert.equal(tokenEvents[9].payload.milestone, true);
  assert.equal(tokenEvents[8].payload.tierUp, false);
});

test('오타: 빨간 글자로 들어가고 콤보 리셋, 지우면 다시 입력 전 상태로 돌아온다', () => {
  const { engine, events } = createEngine({ random: () => 0.99 });
  for (let index = 0; index < 3; index++) typeCurrentToken(engine, 1000);
  const tokenBefore = engine.current.text;
  const result = engine.input('§', 1000);
  assert.equal(result.correct, false);
  assert.equal(result.comboLost, 3);
  assert.equal(engine.combo, 0);
  assert.equal(engine.cursor, 1);
  assert.deepEqual(engine.getCharacterStates().slice(0, 2), ['wrong', 'current']);

  assert.equal(engine.backspace(1000).accepted, true);
  assert.equal(engine.cursor, 0);
  assert.equal(engine.getCharacterStates()[0], 'current');
  assert.equal(engine.current.text, tokenBefore);

  const completion = typeCurrentToken(engine, 1000);
  assert.equal(completion.clean, false, '고쳐도 오타가 있었던 토큰은 클린이 아님');
  assert.equal(engine.combo, 0);
  assert.equal(events.filter(event => event.type === 'mistake').length, 1);
  assert.equal(events.filter(event => event.type === 'backspace').length, 1);
});

test('틀린 글자가 남아 있으면 칸이 다 차도 완성되지 않고, 더 입력할 수도 없다', () => {
  const { engine } = createEngine({ random: () => 0.99 });
  const text = engine.current.text;
  engine.input('§', 0);
  for (const character of text.slice(1)) engine.input(character, 0);
  assert.equal(engine.current.text, text);
  assert.equal(engine.input('x', 0).reason, 'token_full');
  assert.equal(engine.backspace(0, { wholeToken: true }).deleted, text.length);
  assert.equal(engine.cursor, 0);
  assert.equal(engine.wrongInBuffer, 0);
  typeCurrentToken(engine, 0);
  assert.notEqual(engine.cursor, text.length);
  assert.equal(engine.completedTokens, 1);
});

test('맞는 글자를 지웠다 다시 쳐도 점수는 토큰 완성 때 한 번만', () => {
  const { engine } = createEngine({ random: () => 0.99 });
  const text = engine.current.text;
  for (let round = 0; round < 3; round++) {
    engine.input(text[0], 0);
    engine.backspace(0);
  }
  assert.equal(engine.score, 0);
  typeCurrentToken(engine, 0);
  assert.equal(engine.score, text.length * SCORING.basePoints);
});

test('시작 전·빈 칸에서는 지우기가 무시된다', () => {
  const { engine } = createEngine();
  assert.equal(engine.backspace(0).accepted, false);
  engine.input(engine.current.text[0], 0);
  engine.backspace(0);
  assert.equal(engine.backspace(0).accepted, false);
});

test('점수는 항상 정타 수 × 기본점수 × 최대 배율 이하 (서버 검증 상한과 일치)', () => {
  const { engine } = createEngine();
  for (let index = 0; index < 80; index++) {
    if (index % 17 === 0) {
      engine.input('§', 1000 + index * 100);
      engine.backspace(1000 + index * 100);
    }
    typeCurrentToken(engine, 1000 + index * 100);
  }
  assert.ok(engine.score <= engine.correctKeystrokes * SCORING.basePoints * MAX_MULTIPLIER);
  assert.ok(engine.score > engine.correctKeystrokes * SCORING.basePoints);
});

test('마지막 5초 경고는 초마다 한 번, 시간이 끝나면 finish 후 입력 무시', () => {
  const { engine, events } = createEngine();
  engine.input(engine.current.text[0], 0);
  for (let ms = 0; ms <= 31000; ms += 100) engine.update(ms);
  const warnings = events.filter(event => event.type === 'warning').map(event => event.payload.remainingSeconds);
  assert.deepEqual(warnings, [5, 4, 3, 2, 1]);
  assert.equal(engine.status, 'finished');
  assert.equal(events.filter(event => event.type === 'finish').length, 1);
  const scoreAtFinish = engine.score;
  assert.equal(engine.input('x', 32000).accepted, false);
  assert.equal(engine.score, scoreAtFinish);
});

test('시간이 지난 뒤 들어온 입력은 점수에 반영되지 않는다', () => {
  const { engine } = createEngine();
  engine.input(engine.current.text[0], 0);
  const scoreBefore = engine.score;
  const result = engine.input(engine.current.text[engine.cursor], 30500);
  assert.equal(result.accepted, false);
  assert.equal(engine.score, scoreBefore);
});

test('요약: WPM 추이 길이, 자주 틀린 토큰 집계', () => {
  const { engine } = createEngine();
  engine.input(engine.current.text[0], 0);
  const missedToken = engine.current.text;
  engine.input('§', 100);
  engine.backspace(150);
  engine.input('§', 200);
  engine.update(30000);
  const summary = engine.summary();
  assert.equal(summary.wordsPerMinuteTimeline.length, 30);
  assert.equal(summary.weakTokens[0].text, missedToken);
  assert.equal(summary.weakTokens[0].misses, 2);
  assert.equal(summary.accuracy, 33.3);
});

test('한 글자가 아닌 입력과 리스너 예외는 엔진을 깨뜨리지 않는다', () => {
  const engine = new TypingEngine({ tokenPool: POOL, durationSeconds: 30, onEvent: () => { throw new Error('boom'); } });
  const originalError = console.error;
  console.error = () => {};
  try {
    assert.equal(engine.input('ab', 0).accepted, false);
    assert.equal(engine.input('', 0).accepted, false);
    assert.equal(engine.input(engine.current.text[0], 0).accepted, true);
  } finally {
    console.error = originalError;
  }
});
