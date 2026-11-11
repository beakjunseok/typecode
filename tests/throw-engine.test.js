import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ThrowEngine, ROBOT_TYPES, THROW_RULES, MAX_POINTS_PER_CHARACTER, filterThrowTokens } from '../public/js/throw-engine.js';
import { ARCADE_RULES } from '../public/js/target-game.js';
import { getTokenPool } from '../public/js/tokens.js';

const POOL = ['let', 'fn', 'var', 'map', 'if', 'do', 'go', 'use', 'pub', 'mut', 'xor', 'nil']
  .map(text => ({ text, kind: 'keyword' }));

function seeded(seed = 3) {
  let state = seed;
  return () => ((state = (state * 1664525 + 1013904223) % 4294967296) / 4294967296);
}

function createEngine(overrides = {}) {
  const events = [];
  const engine = new ThrowEngine({ tokenPool: POOL, random: seeded(), onEvent: (type, payload) => events.push({ type, payload }), ...overrides });
  return { engine, events };
}

// 실제 시각을 프레임 단위로 진행
function advance(engine, clock, seconds, step = 0.05) {
  for (let elapsed = 0; elapsed < seconds - 1e-9; elapsed += step) {
    clock.now += step * 1000;
    engine.update(clock.now);
  }
}

function typeText(engine, clock, text) {
  let result;
  for (const character of text) result = engine.input(character, clock.now);
  return result;
}

function startWithRobot(engine, clock, typeKey = 'basic') {
  engine.start(clock.now);
  engine.nextSpawnAt = Infinity;
  engine.nextItemAt = Infinity;
  return engine.spawnRobot(typeKey, 0);
}

test('토큰 길이 필터와 점수 상한 상수', () => {
  assert.ok(filterThrowTokens([{ text: '?' }, { text: 'if' }]).every(token => token.text.length >= 2));
  assert.equal(MAX_POINTS_PER_CHARACTER, 95);
  assert.throws(() => new ThrowEngine({ tokenPool: [{ text: 'a' }] }));
});

test('시작 후 로봇이 생성되고 왼쪽으로 이동한다', () => {
  const { engine, events } = createEngine();
  const clock = { now: 0 };
  engine.start(0);
  advance(engine, clock, 1);
  assert.ok(engine.robots.length >= 1);
  const robot = engine.robots[0];
  const x = robot.x;
  advance(engine, clock, 1);
  assert.ok(robot.x < x);
  assert.ok(events.some(event => event.type === 'spawn'));
});

test('프레임이 오래 멈춰도 한 번에 0.25초만 진행 (탭 전환 시 순간이동 방지)', () => {
  const { engine } = createEngine();
  engine.start(0);
  engine.update(60_000);
  assert.ok(engine.gameTime <= ARCADE_RULES.maxFrameSeconds + 1e-9);
});

test('첫 글자로 가장 가까운 목표를 조준하고, 다 치면 휴대폰을 던져 처치', () => {
  const { engine, events } = createEngine();
  const clock = { now: 0 };
  const near = startWithRobot(engine, clock);
  near.token = { text: 'let', kind: 'keyword' };
  near.x = 0.5;
  const far = engine.spawnRobot('basic', 1);
  far.token = { text: 'lex', kind: 'keyword' };
  far.x = 0.9;

  engine.input('l', clock.now);
  assert.equal(engine.targetId, near.id, '더 가까운 로봇 조준');
  const result = typeText(engine, clock, 'et');
  assert.equal(result.fired, true);
  assert.equal(result.weapon, 'phone');
  assert.equal(near.doomed, true);
  advance(engine, clock, 0.3);
  assert.equal(engine.kills.basic, 1);
  assert.ok(events.some(event => event.type === 'kill'));
  assert.equal(engine.score, 3 * 10 + ROBOT_TYPES.basic.bounty);
});

test('조준 대상이 없는 첫 글자는 오타, 콤보 리셋', () => {
  const { engine, events } = createEngine();
  const clock = { now: 0 };
  const robot = startWithRobot(engine, clock);
  robot.token = { text: 'fn', kind: 'keyword' };
  engine.combo = 4;
  const result = engine.input('z', clock.now);
  assert.equal(result.correct, false);
  assert.equal(engine.targetId, null);
  assert.equal(engine.combo, 0);
  assert.equal(events.at(-1).type, 'mistake');
});

test('조준 중 오타는 빨갛게 남고, 다 지우면 조준 해제', () => {
  const { engine } = createEngine();
  const clock = { now: 0 };
  const robot = startWithRobot(engine, clock);
  robot.token = { text: 'mut', kind: 'keyword' };
  engine.input('m', clock.now);
  engine.input('x', clock.now);
  assert.deepEqual(engine.getCharacterStates(robot), ['correct', 'wrong', 'current']);
  engine.backspace(clock.now);
  assert.deepEqual(engine.getCharacterStates(robot), ['correct', 'current', 'pending']);
  engine.backspace(clock.now);
  assert.equal(engine.targetId, null);
  typeText(engine, clock, 'mut');
  assert.equal(engine.throws, 1);
  assert.equal(engine.combo, 1, '오타 없이 새로 친 것은 클린');
});

test('탱크 로봇: 휴대폰 3번, 맞을 때마다 새 토큰', () => {
  const { engine } = createEngine();
  const clock = { now: 0 };
  const tank = startWithRobot(engine, clock, 'tank');
  for (let hit = 1; hit <= 3; hit++) {
    const before = tank.token.text;
    typeText(engine, clock, before);
    advance(engine, clock, 0.3);
    assert.equal(tank.hp, 3 - hit);
    if (hit < 3) assert.ok(tank.state === 'walking');
  }
  assert.equal(engine.kills.tank, 1);
});

test('노트북 아이템: 맞히면 8초간 노트북(피해 3), 탱크 한 방', () => {
  const { engine, events } = createEngine();
  const clock = { now: 0 };
  engine.start(0);
  engine.nextSpawnAt = Infinity;
  const item = engine.spawnItem(2);
  typeText(engine, clock, item.token.text);
  advance(engine, clock, 0.3);
  assert.ok(events.some(event => event.type === 'item'));
  assert.ok(engine.laptopRemaining() > 7.5);
  const tank = engine.spawnRobot('tank', 0);
  const result = typeText(engine, clock, tank.token.text);
  assert.equal(result.weapon, 'laptop');
  advance(engine, clock, 0.3);
  assert.equal(engine.kills.tank, 1);
  advance(engine, clock, 8);
  assert.equal(engine.laptopRemaining(), 0);
});

test('로봇이 책상에 닿으면 생명 감소, 0이면 게임 오버 후 입력 무시', () => {
  const { engine, events } = createEngine();
  const clock = { now: 0 };
  engine.start(0);
  engine.nextSpawnAt = Infinity;
  engine.nextItemAt = Infinity;
  for (let lane = 0; lane < 3; lane++) {
    const robot = engine.spawnRobot('fast', lane);
    robot.x = THROW_RULES.playerX + 0.01;
  }
  advance(engine, clock, 0.5);
  assert.equal(engine.lives, 0);
  assert.equal(engine.status, 'finished');
  assert.equal(events.filter(event => event.type === 'damage').length, 3);
  assert.equal(events.filter(event => event.type === 'finish').length, 1);
  assert.equal(engine.input('a', clock.now).accepted, false);
});

test('조준 중인 로봇이 책상에 닿으면 입력 버퍼가 비워진다', () => {
  const { engine, events } = createEngine();
  const clock = { now: 0 };
  const robot = startWithRobot(engine, clock);
  engine.input(robot.token.text[0], clock.now);
  robot.x = THROW_RULES.playerX + 0.001;
  advance(engine, clock, 0.1);
  assert.equal(engine.targetId, null);
  assert.equal(engine.typed.length, 0);
  assert.ok(events.some(event => event.type === 'target-lost'));
});

test('화면의 목표들은 첫 글자가 겹치지 않게 출제된다 (토큰이 충분할 때)', () => {
  const engine = new ThrowEngine({ tokenPool: getTokenPool('javascript'), random: seeded(11) });
  engine.start(0);
  engine.nextSpawnAt = Infinity;
  for (let lane = 0; lane < 4; lane++) engine.spawnRobot('basic', lane);
  engine.spawnItem(1);
  const firstCharacters = engine.targetables().map(entity => entity.token.text[0]);
  assert.equal(new Set(firstCharacters).size, firstCharacters.length);
});

test('긴 플레이에서도 점수는 정타 × 글자당 상한 이하 (서버 검증과 일치)', () => {
  const engine = new ThrowEngine({ tokenPool: getTokenPool('python'), random: seeded(5) });
  const clock = { now: 0 };
  engine.start(0);
  for (let frame = 0; frame < 4000 && engine.status === 'running'; frame++) {
    clock.now += 50;
    engine.update(clock.now);
    if (frame % 3 === 0) {
      const target = engine.target ?? engine.targetables().sort((first, second) => first.x - second.x)[0];
      if (target) {
        const next = target.token.text[engine.typed.length] ?? target.token.text[0];
        engine.input(frame % 41 === 0 ? '§' : next, clock.now);
        if (frame % 41 === 0) engine.backspace(clock.now);
      }
    }
  }
  assert.ok(engine.throws > 20);
  assert.ok(engine.score <= engine.correctKeystrokes * MAX_POINTS_PER_CHARACTER);
  const summary = engine.summary();
  assert.equal(summary.wordsPerMinuteTimeline.length, Math.max(1, Math.ceil(engine.gameTime)));
  assert.equal(summary.totalKills, summary.kills.basic + summary.kills.fast + summary.kills.tank);
});

test('같은 줄의 로봇·아이템은 나올 때도, 빠른 로봇이 따라와도 서로 겹치지 않는다', () => {
  for (const seed of [2, 9, 21]) {
    const engine = new ThrowEngine({ tokenPool: getTokenPool('javascript'), random: seeded(seed) });
    engine.start(0);
    engine.lives = Infinity;
    let now = 0;
    let spawned = 0;
    engine.onEvent = type => { if (type === 'spawn') spawned++; };
    for (let frame = 0; frame < 2400; frame++) {
      now += 50;
      engine.update(now);
      const moving = [
        ...engine.robots.filter(robot => robot.state === 'walking'),
        ...engine.items.filter(item => !item.consumed)
      ];
      for (const first of moving) {
        for (const second of moving) {
          if (first === second || first.lane !== second.lane) continue;
          assert.ok(Math.abs(first.x - second.x) >= THROW_RULES.laneGap - 1e-6,
            `seed ${seed} t=${engine.gameTime.toFixed(2)}: lane ${first.lane} ${first.x.toFixed(3)} vs ${second.x.toFixed(3)}`);
        }
      }
    }
    assert.ok(spawned > 40, `seed ${seed}: ${spawned}마리 — 자리를 기다리느라 너무 적게 나오지 않음`);
  }
});

test('시간이 지나면 빠른 로봇·탱크 로봇이 등장한다', () => {
  const engine = new ThrowEngine({ tokenPool: getTokenPool('go'), random: seeded(9) });
  engine.start(0);
  engine.lives = Infinity;
  const seen = new Set();
  engine.onEvent = (type, payload) => { if (type === 'spawn') seen.add(payload.robot.type); };
  let now = 0;
  for (let frame = 0; frame < 1600; frame++) {
    now += 50;
    engine.update(now);
  }
  assert.deepEqual([...seen].sort(), ['basic', 'fast', 'tank']);
});

test('건전지 아이템: 생명이 깎이면 몇 초 뒤 나오고 1칸 회복, 가득 차면 더 안 나온다', () => {
  const { engine } = createEngine({ random: () => 0.1 });
  const clock = { now: 0 };
  engine.start(0);
  engine.nextSpawnAt = Infinity;
  engine.nextItemAt = Infinity;
  assert.equal(engine.chooseItemType(), 'laptop', '정기 아이템은 노트북');
  assert.equal(engine.nextBatteryAt, Infinity, '생명이 가득하면 건전지 없음');
  const robot = engine.spawnRobot('basic', 0);
  robot.x = THROW_RULES.playerX + 0.001;
  advance(engine, clock, 0.2);
  assert.equal(engine.lives, 2);
  assert.ok(Number.isFinite(engine.nextBatteryAt), '생명이 깎이면 건전지 예약');
  advance(engine, clock, THROW_RULES.batteryFirstDelay[1] + 0.5);
  const battery = engine.items.find(item => item.item === 'battery' && !item.consumed);
  assert.ok(battery, '건전지 등장');
  typeText(engine, clock, battery.token.text);
  advance(engine, clock, 0.3);
  assert.equal(engine.lives, 3);
  assert.equal(engine.laptopRemaining(), 0, '건전지는 노트북 모드를 켜지 않음');
  assert.equal(engine.nextBatteryAt, Infinity, '가득 차면 건전지 예약 해제');
});

test('난이도: Lv.4는 Lv.1보다 로봇이 빠르다', () => {
  const slow = new ThrowEngine({ tokenPool: POOL, level: 1 });
  const fast = new ThrowEngine({ tokenPool: POOL, level: 4 });
  assert.ok(fast.speedMultiplier() > slow.speedMultiplier() * 1.9);
  assert.equal(new ThrowEngine({ tokenPool: POOL, level: 9 }).level, 2, '잘못된 레벨은 기본값');
});

test('세로 모바일 설정: 레인 3개, 토큰 14자 이하', () => {
  const engine = new ThrowEngine({ tokenPool: getTokenPool('java'), lanes: 3, maxTokenLength: 14, random: seeded(2) });
  engine.start(0);
  for (let index = 0; index < 30; index++) engine.spawnRobot();
  assert.ok(engine.robots.every(robot => robot.lane >= 0 && robot.lane < 3));
  assert.ok(engine.tokenPool.every(token => token.text.length <= 14));
});

test('Enter(clearInput): 친 낱말을 한 번에 지우고 조준을 푼다 — 콤보·점수 유지', () => {
  const { engine, events } = createEngine();
  const clock = { now: 0 };
  const robot = startWithRobot(engine, clock);
  typeText(engine, clock, robot.token.text.slice(0, 1));
  assert.equal(engine.targetId, robot.id);
  assert.equal(engine.typed.length, 1);
  const score = engine.score;
  const combo = engine.combo;
  assert.equal(engine.clearInput(clock.now).accepted, true);
  assert.equal(engine.targetId, null);
  assert.deepEqual(engine.typed, []);
  assert.equal(engine.score, score);
  assert.equal(engine.combo, combo);
  assert.ok(events.some(event => event.type === 'unlock'));
  assert.equal(engine.clearInput(clock.now).accepted, false, '지울 게 없으면 무시');
});

test('게임 모드도 타수를 계산한다(스냅샷·요약)', async () => {
  const { calculateCharactersPerMinute } = await import('../public/js/engine.js');
  const { engine } = createEngine();
  const clock = { now: 0 };
  const robot = startWithRobot(engine, clock);
  advance(engine, clock, 2);
  typeText(engine, clock, robot.token.text);
  assert.equal(engine.snapshot().charactersPerMinute, calculateCharactersPerMinute(engine.correctKeystrokes, engine.gameTime));
  assert.equal(typeof engine.summary().charactersPerMinute, 'number');
});
