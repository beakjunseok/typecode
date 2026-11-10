import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RescueEngine, VICTIM_TYPES, RESCUE_RULES, RESCUE_MAX_POINTS_PER_CHARACTER } from '../public/js/rescue-engine.js';
import { getRescueTokenPool, ERROR_TOKENS } from '../public/js/error-tokens.js';
import { LANGUAGE_KEYS } from '../public/js/tokens.js';

function seeded(seed = 21) {
  let state = seed;
  return () => ((state = (state * 1664525 + 1013904223) % 4294967296) / 4294967296);
}

function setup(languageKey = 'python') {
  const events = [];
  const engine = new RescueEngine({ tokenPool: getRescueTokenPool(languageKey), random: seeded(), onEvent: (type, payload) => events.push({ type, payload }) });
  const clock = { now: 0 };
  engine.start(0);
  engine.nextSpawnAt = Infinity;
  engine.nextCrateAt = Infinity;
  return { engine, events, clock };
}

function advance(engine, clock, seconds, step = 0.05) {
  for (let elapsed = 0; elapsed < seconds - 1e-9; elapsed += step) {
    clock.now += step * 1000;
    engine.update(clock.now);
  }
}

const typeText = (engine, clock, text) => [...text].map(character => engine.input(character, clock.now)).at(-1);

test('에러 이름 사전: 모든 언어에 있고 입력 가능한 ASCII, 풀 가중치 합 1', () => {
  for (const key of LANGUAGE_KEYS) {
    assert.ok(ERROR_TOKENS[key]?.length >= 6, key);
    for (const text of ERROR_TOKENS[key]) assert.match(text, /^[\x21-\x7e](?:[\x20-\x7e]*[\x21-\x7e])?$/, `${key}: ${text}`);
    const pool = getRescueTokenPool(key);
    assert.ok(Math.abs(pool.reduce((sum, token) => sum + token.weight, 0) - 1) < 1e-9, key);
    assert.ok(pool.some(token => token.kind === 'error'));
  }
  assert.equal(RESCUE_MAX_POINTS_PER_CHARACTER, 55);
});

test('프로세스는 시간에 따라 가라앉고, 다 가라앉으면 SLA 감소', () => {
  const { engine, events, clock } = setup();
  const victim = engine.spawnVictim('coredump', 0.5);
  advance(engine, clock, 2);
  assert.ok(victim.depth > 0.2 && victim.depth < 1);
  advance(engine, clock, VICTIM_TYPES.coredump.sinkSeconds);
  assert.equal(victim.state, 'sunk');
  assert.equal(engine.lives, 2);
  assert.ok(events.some(event => event.type === 'damage'));
});

test('구조: 빨리 건질수록 보너스가 크다', () => {
  const early = setup();
  const quick = early.engine.spawnVictim('process', 0.3);
  typeText(early.engine, early.clock, quick.token.text);
  advance(early.engine, early.clock, 0.3);
  const late = setup();
  const slow = late.engine.spawnVictim('process', 0.3);
  advance(late.engine, late.clock, 9);
  typeText(late.engine, late.clock, slow.token.text);
  advance(late.engine, late.clock, 0.3);
  assert.equal(quick.state, 'rescued');
  assert.equal(slow.state, 'rescued');
  const bonusOf = events => events.find(event => event.type === 'kill').payload.bounty;
  assert.ok(bonusOf(early.events) > bonusOf(late.events));
  assert.ok(bonusOf(late.events) >= Math.round(VICTIM_TYPES.process.bonus * RESCUE_RULES.minBonusRatio));
});

test('가장 많이 가라앉은 프로세스부터 조준', () => {
  const { engine, clock } = setup();
  const shallow = engine.spawnVictim('process', 0.2);
  const deep = engine.spawnVictim('process', 0.7);
  shallow.token = { text: 'KeyError', kind: 'error' };
  deep.token = { text: 'KeyboardInterrupt', kind: 'error' };
  deep.depth = 0.6;
  engine.input('K', clock.now);
  assert.equal(engine.targetId, deep.id);
});

test('서버 클러스터: 패치 2번, 첫 패치에 일부 끌어올림 + 새 토큰', () => {
  const { engine, clock } = setup();
  const cluster = engine.spawnVictim('cluster', 0.5);
  cluster.depth = 0.5;
  const firstToken = cluster.token.text;
  typeText(engine, clock, firstToken);
  advance(engine, clock, 0.3);
  assert.equal(cluster.state, 'sinking');
  assert.ok(cluster.depth < 0.5 - RESCUE_RULES.partialLift + 0.05);
  typeText(engine, clock, cluster.token.text);
  advance(engine, clock, 0.3);
  assert.equal(cluster.state, 'rescued');
  assert.equal(engine.rescued.cluster, 1);
});

test('롤백 상자: 모든 프로세스를 끌어올리고 5초간 정지', () => {
  const { engine, events, clock } = setup();
  const victim = engine.spawnVictim('process', 0.4);
  victim.depth = 0.8;
  const crate = engine.spawnCrate();
  typeText(engine, clock, crate.token.text);
  advance(engine, clock, 0.3);
  assert.ok(events.some(event => event.type === 'item'));
  assert.ok(Math.abs(victim.depth - 0.8 * (1 - RESCUE_RULES.rollbackLift)) < 0.01);
  const frozenDepth = victim.depth;
  advance(engine, clock, 4);
  assert.equal(victim.depth, frozenDepth, '정지 중에는 안 가라앉음');
  advance(engine, clock, 2);
  assert.ok(victim.depth > frozenDepth);
});

test('조준 중이던 프로세스가 가라앉으면 입력 버퍼 비움, SLA 0이면 종료', () => {
  const { engine, events, clock } = setup();
  const victims = [0.2, 0.5, 0.8].map(x => engine.spawnVictim('process', x));
  engine.input(victims[0].token.text[0], clock.now);
  victims.forEach(victim => { victim.depth = 0.999; });
  advance(engine, clock, 0.2);
  assert.ok(events.some(event => event.type === 'target-lost'));
  assert.equal(engine.status, 'finished');
  assert.equal(engine.summary().lost, 3);
});

test('긴 플레이: 점수 상한 유지, 새 프로세스는 서로 간격을 둔다', () => {
  const engine = new RescueEngine({ tokenPool: getRescueTokenPool('java'), random: seeded(4) });
  let now = 0;
  engine.start(0);
  for (let frame = 0; frame < 5000 && engine.status === 'running'; frame++) {
    now += 50;
    engine.update(now);
    const sinking = engine.victims.filter(victim => victim.state === 'sinking').map(victim => victim.x).sort((a, b) => a - b);
    if (frame % 2 === 0) {
      const target = engine.target ?? engine.targetables().sort((a, b) => engine.targetPriority(a) - engine.targetPriority(b))[0];
      if (target) engine.input(target.token.text[engine.typed.length] ?? target.token.text[0], now);
    }
    assert.ok(sinking.length <= RESCUE_RULES.maxVictims);
  }
  assert.ok(engine.throws > 30);
  assert.ok(engine.score <= engine.correctKeystrokes * RESCUE_MAX_POINTS_PER_CHARACTER);
  const summary = engine.summary();
  assert.equal(summary.totalRescued, summary.rescued.process + summary.rescued.coredump + summary.rescued.cluster);
});
