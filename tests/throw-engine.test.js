import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ThrowEngine, ROBOT_TYPES, THROW_RULES, BOSS_RULES, BOSS_KINDS, FORMATIONS, MAX_POINTS_PER_CHARACTER, filterThrowTokens } from '../public/js/throw-engine.js';
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
  assert.equal(MAX_POINTS_PER_CHARACTER, 330, '쌍둥이봇: 노트북 두 발 × 쌍둥이 둘');
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

test('탱크 로봇: 휴대폰 2번, 맞을 때마다 새 토큰', () => {
  const { engine } = createEngine();
  const clock = { now: 0 };
  const tank = startWithRobot(engine, clock, 'tank');
  assert.equal(ROBOT_TYPES.tank.hp, 2);
  for (let hit = 1; hit <= 2; hit++) {
    const before = tank.token.text;
    typeText(engine, clock, before);
    advance(engine, clock, 0.3);
    assert.equal(tank.hp, 2 - hit);
    if (hit < 2) assert.ok(tank.state === 'walking');
  }
  assert.equal(engine.kills.tank, 1);
});

test('달팽봇: 탱크보다도 느리고, 휴대폰은 낱말 두 개(맞으면 새 낱말), 노트북은 한 방', () => {
  assert.ok(ROBOT_TYPES.slow.speed < ROBOT_TYPES.tank.speed);
  const { engine } = createEngine();
  const clock = { now: 0 };
  const snail = startWithRobot(engine, clock, 'slow');
  const first = snail.token.text;
  typeText(engine, clock, first);
  advance(engine, clock, 0.3);
  assert.equal(snail.hp, 1);
  assert.equal(snail.state, 'walking');
  typeText(engine, clock, snail.token.text);
  advance(engine, clock, 0.3);
  assert.equal(engine.kills.slow, 1);

  engine.laptopUntil = engine.gameTime + 8;
  const armored = engine.spawnRobot('slow', 1);
  assert.equal(typeText(engine, clock, armored.token.text).weapon, 'laptop');
  advance(engine, clock, 0.45);
  assert.equal(engine.kills.slow, 2, '노트북 한 방');
});

test('노트북 아이템: 맞히면 8초간 노트북(두 개씩), 탱크는 낱말 하나로 처치', () => {
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
  assert.equal(engine.projectiles.filter(projectile => projectile.targetId === tank.id).length, 2, '두 개 모두 탱크에');
  advance(engine, clock, 0.4);
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
  assert.equal(summary.totalKills, Object.values(summary.kills).reduce((sum, count) => sum + count, 0));
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
  assert.deepEqual([...seen].sort(), ['basic', 'fast', 'slow', 'tank']);
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

test('목표 수를 채우면 보스전: 경고 뒤 보스 등장, 이후 로봇은 안 나옴, 맞으면 밀려나고 쓰러뜨리면 승리', () => {
  const { engine } = createEngine();
  const clock = { now: 0 };
  engine.start(0);
  engine.kills.basic = THROW_RULES.goalKills - 1;
  const last = engine.spawnRobot('basic', 0);
  engine.damageRobot(last, { damage: 1, weapon: 'phone' });
  assert.equal(engine.bossPhase, 'warning');
  assert.equal(engine.outcome, null, '아직 승리 아님');
  advance(engine, clock, BOSS_RULES.warningSeconds + 0.2);
  const boss = engine.boss();
  assert.ok(boss, '보스 등장');
  assert.equal(boss.hp, ROBOT_TYPES.boss.hp);
  assert.equal(boss.lane, (engine.lanes - 1) / 2, '보스는 화면 가운데');
  boss.x = 50;
  advance(engine, clock, 12);
  assert.equal(engine.robots.filter(robot => robot.spawnedAt > boss.spawnedAt).length, 0, '보스 뒤로 새 로봇 없음');
  boss.x = BOSS_RULES.spawnX - 0.1;
  const x = boss.x;
  engine.lives = 1;
  engine.damageRobot(boss, { damage: 1, weapon: 'phone' });
  assert.ok(boss.x > x, '맞으면 밀려남');
  assert.equal(engine.lives, 2, '보스를 때리면 건전지 1칸 회복');
  engine.damageRobot(boss, { damage: ROBOT_TYPES.boss.hp, weapon: 'laptop' });
  assert.equal(engine.outcome, 'cleared');
  assert.equal(engine.input('a', clock.now).accepted, false);
  advance(engine, clock, THROW_RULES.winPauseSeconds + 0.3);
  assert.equal(engine.status, 'finished');
  assert.equal(engine.summary().bossDefeated, true);
});

test('보스 근접: 내 앞에 멈춰 딜레이마다 펀치(건전지 1칸), 그동안 대포 없음, 맞혀 밀어내면 펀치 취소', () => {
  const { engine, events } = createEngine();
  const clock = { now: 0 };
  engine.start(0);
  engine.bossPhase = 'warning';
  engine.bossAt = 0;
  advance(engine, clock, 0.1);
  const boss = engine.boss();
  for (const robot of engine.robots) if (robot !== boss) robot.x = 50;
  engine.nextPadAt = 0;
  boss.chargeUntil = null;
  boss.x = THROW_RULES.playerX + BOSS_RULES.reachGap + 0.001;
  advance(engine, clock, 0.3);
  assert.ok(boss.inMelee);
  assert.equal(boss.state, 'walking', '계속 맞힐 수 있다');
  const lives = engine.lives;
  advance(engine, clock, BOSS_RULES.punchFirstDelay + BOSS_RULES.punchWindupSeconds + 0.1);
  assert.equal(engine.lives, lives - 1, '펀치 한 대 = 건전지 1칸');
  assert.equal(engine.status, 'running');
  assert.equal(engine.pads.length, 0, '근접 중 대포 없음');
  advance(engine, clock, BOSS_RULES.punchDelay - 0.3);
  assert.equal(engine.lives, lives - 1, '딜레이 동안은 안 맞음');
  advance(engine, clock, 0.4);
  assert.ok(boss.punchStartAt != null, '두 번째 펀치 준비');
  engine.damageRobot(boss, { damage: 1, weapon: 'phone' });
  advance(engine, clock, 0.05);
  assert.equal(boss.punchStartAt, null, '밀려나면 취소');
  assert.ok(events.some(event => event.type === 'boss-pushed'));
});

test('보스 대포: 충전 뒤 패드 발사, 짧은 낱말을 쳐서 막으면 보너스, 못 막으면 건전지 1칸', () => {
  const { engine, events } = createEngine();
  const clock = { now: 0 };
  engine.start(0);
  engine.bossPhase = 'warning';
  engine.bossAt = 0;
  advance(engine, clock, 0.1);
  const boss = engine.boss();
  for (const robot of engine.robots) if (robot !== boss) robot.x = 2;
  advance(engine, clock, BOSS_RULES.padFirstDelay + BOSS_RULES.cannonChargeSeconds + 0.2);
  assert.ok(events.some(event => event.type === 'boss-charge'));
  const pad = engine.pads[0];
  assert.ok(pad && pad.token.text.length <= BOSS_RULES.padMaxLength, '패드 발사');
  const score = engine.score;
  for (const character of pad.token.text) engine.input(character, clock.now);
  advance(engine, clock, ARCADE_RULES.projectileSeconds + 0.1);
  assert.ok(pad.blocked, '막음');
  assert.ok(engine.score >= score + BOSS_RULES.padBlockBonus);

  engine.nextPadAt = engine.gameTime;
  advance(engine, clock, BOSS_RULES.cannonChargeSeconds + 0.1);
  const second = engine.pads.find(entity => !entity.consumed);
  assert.ok(second);
  const lives = engine.lives;
  second.x = THROW_RULES.playerX + 0.001;
  advance(engine, clock, 0.1);
  assert.ok(second.hitPlayer);
  assert.equal(engine.lives, lives - 1, '못 막으면 건전지 1칸');
});

test('노트북 두 개: 목표가 한 방이면 두 번째는 옆 로봇에게, 옆 로봇이 없으면 하나만', () => {
  const { engine } = createEngine();
  const clock = { now: 0 };
  engine.start(0);
  engine.nextSpawnAt = Infinity;
  engine.nextItemAt = Infinity;
  for (const robot of engine.robots) robot.state = 'crashed';
  engine.robots = [];
  engine.laptopUntil = 100;
  const target = engine.spawnRobot('basic', 0);
  target.x = 0.5;
  const near = engine.spawnRobot('basic', 1);
  near.x = 0.55;
  const far = engine.spawnRobot('basic', 3);
  far.x = 0.95;
  typeText(engine, clock, target.token.text);
  assert.deepEqual(engine.projectiles.map(projectile => projectile.targetId).sort(), [target.id, near.id].sort());
  advance(engine, clock, 0.5);
  assert.equal(engine.kills.basic, 2, '목표와 옆 로봇 모두 처치');
  assert.equal(far.state, 'walking');

  typeText(engine, clock, far.token.text);
  assert.equal(engine.projectiles.length, 1, '옆 로봇이 없으면 하나만');
  advance(engine, clock, 0.5);
  assert.equal(engine.kills.basic, 3);
});

// ---------- 특수 로봇 편대·보스 3종 ----------
function specialEngine(seed = 5) {
  let state = seed;
  const random = () => ((state = (state * 1664525 + 1013904223) % 4294967296) / 4294967296);
  const pool = ['let', 'var', 'map', 'if', 'do', 'go', 'use', 'mut', 'xor', 'nil', 'new', 'try', 'int', 'out', 'end', 'async', 'await', 'return', 'struct', 'import', 'export', 'default', 'function', 'continue']
    .map(text => ({ text, kind: 'keyword' }));
  const events = [];
  const engine = new ThrowEngine({ tokenPool: pool, random, specials: true, onEvent: (type, payload) => events.push({ type, payload }) });
  engine.start(0);
  return { engine, events };
}
const typeOut = (engine, text) => { for (const character of text) engine.input(character, 0); };

test('방패 편대: 방패봇이 살아 있는 동안 뒤 로봇은 조준할 수 없고, 같은 속도로 걷는다', () => {
  const { engine } = specialEngine();
  const [shield, ...followers] = engine.spawnFormation('shieldWall');
  assert.equal(shield.type, 'shield');
  assert.equal(followers.length, 2);
  for (const follower of followers) {
    assert.equal(engine.robotSpeed(follower), engine.robotSpeed(shield));
    assert.ok(!engine.targetables().includes(follower), '막혀 있음');
  }
  shield.state = 'dying';
  assert.ok(followers.every(follower => engine.targetables().includes(follower)), '방패가 쓰러지면 열린다');
});

test('쌍둥이: 같은 낱말, 한 번 치면 둘 다 쓰러진다', () => {
  const { engine, events } = specialEngine();
  const [left, right] = engine.spawnFormation('twins');
  assert.equal(left.token.text, right.token.text);
  assert.notEqual(left.lane, right.lane);
  typeOut(engine, left.token.text);
  assert.ok(left.doomed && right.doomed);
  assert.ok(events.some(event => event.type === 'twin-hit'));
});

test('카멜레온: 시간이 되면 낱말이 바뀌고, 치는 중에는 안 바뀐다', () => {
  const { engine, events } = specialEngine();
  const [robot] = engine.spawnFormation('chameleon');
  engine.targetId = robot.id;
  engine.gameTime = robot.nextMorphAt + 0.1;
  engine.morphChameleons();
  assert.ok(!events.some(event => event.type === 'morph'), '치는 중');
  engine.targetId = null;
  engine.morphChameleons();
  assert.ok(events.some(event => event.type === 'morph'));
});

test('분열봇: 쓰러지면 꼬마봇 둘, 거울봇은 거울 표시', () => {
  const { engine, events } = specialEngine();
  const [splitter] = engine.spawnFormation('splitter');
  engine.damageRobot(splitter, { damage: 2, weapon: 'phone' });
  const split = events.find(event => event.type === 'split');
  assert.equal(split.payload.minis.length, 2);
  assert.ok(split.payload.minis.every(mini => mini.type === 'mini' && mini.state === 'walking'));
  const [mirror] = engine.spawnFormation('mirror');
  assert.equal(mirror.mirror, true);
});

test('편대는 열린 시간부터만, specials가 꺼져 있으면 안 나온다', () => {
  const { engine } = specialEngine();
  engine.gameTime = 0;
  for (let index = 0; index < 50; index++) assert.equal(engine.trySpawnFormation(), null);
  engine.gameTime = 100;
  const kinds = new Set();
  for (let index = 0; index < 200; index++) {
    engine.robots = [];
    const kind = engine.trySpawnFormation();
    if (kind) kinds.add(kind);
  }
  assert.deepEqual([...kinds].sort(), Object.keys(FORMATIONS).sort());
  const plain = new ThrowEngine({ tokenPool: Array.from({ length: 20 }, (_, index) => ({ text: `w${index}x`, kind: 'keyword' })) });
  plain.gameTime = 100;
  assert.equal(plain.trySpawnFormation(), null);
});

test('보스 3종: 셋 중 하나가 나오고, 기술은 그 보스 목록에서 같은 기술 연속 없이 무작위', () => {
  const seen = new Set();
  for (let seed = 1; seed < 40; seed++) {
    const { engine } = specialEngine(seed);
    engine.kills.basic = THROW_RULES.goalKills;
    engine.checkGoal();
    seen.add(engine.bossKind);
  }
  assert.deepEqual([...seen].sort(), Object.keys(BOSS_KINDS).sort());
  for (const kind of Object.keys(BOSS_KINDS)) {
    const { engine, events } = specialEngine(3);
    engine.bossKind = kind;
    engine.kills.basic = THROW_RULES.goalKills;
    engine.checkGoal();
    engine.gameTime = engine.bossAt;
    engine.stepBossWave();
    const boss = engine.boss();
    assert.equal(boss.type, kind);
    const used = [];
    for (let round = 0; round < 12; round++) {
      engine.pads = [];
      engine.nextPadAt = engine.gameTime;
      boss.x = 0.6;
      engine.stepSkill(boss);
      engine.gameTime = boss.chargeUntil;
      engine.stepSkill(boss);
      used.push(boss.lastSkill);
    }
    for (let index = 1; index < used.length; index++) assert.notEqual(used[index], used[index - 1], '같은 기술 연속 없음');
    assert.ok(used.every(skill => BOSS_KINDS[kind].skills.includes(skill)));
    assert.equal(new Set(used).size, BOSS_KINDS[kind].skills.length, `${kind} 기술 모두 등장`);
    if (kind === 'printer') assert.ok(events.some(event => event.type === 'boss-fire' && event.payload.pad.paper));
    if (kind === 'hacker') assert.ok(events.some(event => event.type === 'boss-mask') && events.some(event => event.type === 'boss-decoy'));
  }
});
