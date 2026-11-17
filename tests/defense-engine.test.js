import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DefenseEngine, isOnPath, DEFENSE_COMPUTER, DEFENSE_RULES, BUG_TYPES, TOWER_TYPES, DEFENSE_PATH, bpmForWave, wordCoins, waveBonusCoins, comboCoinFactor } from '../public/js/defense-engine.js';
import { rewardBreakdown } from '../public/js/rewards.js';

const POOL = ['let', 'var', 'map', 'if', 'do', 'go', 'use', 'mut', 'xor', 'nil', 'new', 'try', 'int', 'out', 'end']
  .map(text => ({ text, kind: 'keyword' }));

function seeded(seed = 3) {
  let state = seed;
  return () => ((state = (state * 1664525 + 1013904223) % 4294967296) / 4294967296);
}

function setup(overrides = {}) {
  const events = [];
  const engine = new DefenseEngine({ tokenPool: POOL, random: seeded(), onEvent: (type, payload) => events.push({ type, payload }), ...overrides });
  const clock = { now: 1000 };
  engine.start(clock.now);
  return { engine, events, clock };
}

function advance(engine, clock, seconds, step = 0.05) {
  for (let elapsed = 0; elapsed < seconds - 1e-9 && engine.status === 'running'; elapsed += step) {
    clock.now += step * 1000;
    engine.update(clock.now);
  }
}

function typeWord(engine, clock, text) {
  let result;
  for (const character of text) result = engine.input(character, clock.now);
  return result;
}

// 낱말 줄의 지금 낱말을 n개 친다(코인 벌기)
function typeWords(engine, clock, count) {
  for (let index = 0; index < count && engine.status === 'running'; index++) typeWord(engine, clock, engine.stream[0].token.text);
}

// 빈 땅 하나(추천 자리 첫 번째)
function firstSpot(engine) {
  return engine.suggestedSpots()[0];
}

test('수치: 웨이브 10개, BPM은 웨이브마다 3씩(보통 110→137), 단어 코인·콤보·웨이브 보너스', () => {
  assert.equal(DEFENSE_RULES.waves, 10);
  assert.equal(bpmForWave(2, 1), 110);
  assert.equal(bpmForWave(2, 10), 137);
  assert.equal(bpmForWave(1, 1), 100);
  assert.equal(bpmForWave(2, 99), 137, '웨이브는 10까지만');
  assert.equal(wordCoins(5, 1, 0), 7, '(2 + 5) × 1 × 1');
  assert.equal(wordCoins(5, 5, 30), 28, '(2 + 5) × 2 × 2');
  assert.equal(comboCoinFactor(10), 1.2);
  assert.equal(waveBonusCoins(1, false), 98, '무피해 ×1.3');
});

test('낱말 줄: 지금 낱말만 칠 수 있고, 다 치면 코인과 다음 낱말 · 첫 글자가 틀리면 오타', () => {
  const { engine, events, clock } = setup();
  assert.equal(engine.stream.length, DEFENSE_RULES.streamLength);
  assert.deepEqual(engine.targetables(), [engine.stream[0]]);
  const first = engine.stream[0];
  const second = engine.stream[1];
  const coinsBefore = engine.coins;
  typeWord(engine, clock, first.token.text);
  assert.equal(engine.coins - coinsBefore, wordCoins(first.token.text.length, 1, 0));
  assert.equal(engine.stream[0], second, '다음 낱말이 올라온다');
  assert.equal(engine.stream.length, DEFENSE_RULES.streamLength, '줄은 늘 같은 길이');
  assert.ok(events.some(event => event.type === 'word-done'));
  const wrong = engine.input(engine.stream[0].token.text[0] === 'q' ? 'z' : 'q', clock.now);
  assert.equal(wrong.correct, false);
});

test('막는 건 타워뿐: 타워 없이는 공격이 그대로 닿고, 낱말로 번 코인으로 세운 타워가 웨이브를 막는다', () => {
  const bare = setup();
  advance(bare.engine, bare.clock, 70, 0.1);
  assert.ok(bare.engine.health < bare.engine.maxHealth, '타워가 없으면 맞는다');

  const { engine, events, clock } = setup();
  typeWords(engine, clock, 25);
  for (const tower of ['antivirus', 'antivirus', 'firewall']) {
    engine.coins += 400;
    engine.hotkey(String(Object.keys(TOWER_TYPES).indexOf(tower) + 1));
    assert.ok(engine.buildMode, '숫자 키로 설치 모드');
    engine.hotkey('1');
  }
  assert.equal(engine.towers.length, 3);
  advance(engine, clock, 90, 0.1);
  assert.ok(engine.wavesCleared >= 1, '1웨이브를 막는다');
  assert.ok(events.some(event => event.type === 'bug-kill' && event.payload.source === 'tower'));
});

test('공격이 컴퓨터에 닿으면 체력이 깎이고, 0이면 해킹당해 끝난다', () => {
  const { engine, events, clock } = setup({ level: 4 });
  advance(engine, clock, 300, 0.1);
  assert.equal(engine.status, 'finished');
  assert.equal(engine.summary().outcome, 'breached');
  assert.ok(events.some(event => event.type === 'danger'), '30% 아래로 떨어질 때 위험 신호(음악 필터)');
  assert.equal(engine.health, 0);
});

test('설치: 길이 아닌 곳은 어디든(크기가 들어가면), 길·컴퓨터 자리·겹침은 거절, 같은 타워를 누르면 업그레이드', () => {
  const { engine, events, clock } = setup({ level: 3 });
  engine.coins = 100000;
  engine.selectShopItem('firewall');
  assert.equal(engine.placeAtPoint({ x: 0.5, y: 0.16 }).reason, 'path', '길 위');
  assert.equal(engine.placeAtPoint({ x: 0.5, y: 0.87 }).reason, 'computer', '컴퓨터 자리');
  assert.ok(engine.buildMode, '거절돼도 설치 모드는 그대로');
  assert.equal(engine.placeAtPoint({ x: 0.3, y: 0.27 }).bought, true, '길 사이 빈 땅');
  engine.selectShopItem('firewall');
  assert.equal(engine.placeAtPoint({ x: 0.31, y: 0.28 }).bought, true, '같은 타워를 누르면 업그레이드');
  assert.equal(engine.towers[0].level, 2);
  engine.selectShopItem('antivirus');
  assert.equal(engine.placeAtPoint({ x: 0.33, y: 0.29 }).reason, 'blocked', '다른 타워 위');
  assert.equal(engine.placeAtPoint({ x: 0.3, y: 0.76 }).bought, true, '방패 돔 옆 빈 땅도 된다');
  engine.selectShopItem('antivirus');
  engine.hotkey('Escape');
  assert.equal(engine.buildMode, null, 'Esc로 취소');
  assert.ok(events.some(event => event.type === 'place-denied' && event.payload.reason === 'path'));
  assert.ok(DEFENSE_PATH.at(-1).y < DEFENSE_COMPUTER.y, '길은 컴퓨터 위에서 끝난다');
  assert.ok(engine.suggestedSpots().every(spot => !isOnPath(spot)));
  engine.health = 10;
  engine.hotkey(String(Object.keys(TOWER_TYPES).length + 1));
  assert.equal(engine.health, 10 + DEFENSE_RULES.repairAmount, '마지막 숫자 = 수리');
});

test('공중 공격: 길을 무시하고 곧장 날아오며, 요격포만 맞힌다', () => {
  const { engine, clock } = setup();
  engine.coins = 100000;
  engine.phase = 'spawning';
  engine.phaseUntil = Infinity;
  engine.nextSpawnAt = Infinity;
  const drone = engine.spawnBug('drone');
  assert.equal(drone.air, true);
  assert.equal(drone.y, 0);
  engine.selectShopItem('antivirus');
  engine.placeAtPoint({ x: drone.x + 0.06, y: 0.27 });
  advance(engine, clock, 3, 0.1);
  assert.equal(drone.hp, drone.maxHp, '백신은 공중을 못 맞힌다');
  assert.ok(!isOnPath(drone) || drone.y > 0, '길과 상관없이 움직인다');
  engine.selectShopItem('interceptor');
  const placed = engine.placeAtPoint({ x: 0.5, y: 0.7 });
  assert.equal(placed.bought, true, placed.reason);
  advance(engine, clock, 25, 0.1);
  assert.equal(drone.state, 'dead', '요격포가 떨어뜨린다');
});

test('보스: 5웨이브 랜섬웨어 · 10웨이브 루트킷, 체력 절반에서 2페이즈(잠깐 무적·소환·타워 잠금)', () => {
  assert.equal(DEFENSE_RULES.bossWaves[5], 'ransomware');
  assert.equal(DEFENSE_RULES.bossWaves[10], 'rootkit');
  const { engine, events, clock } = setup();
  assert.equal(engine.bugsInWave(5), DEFENSE_RULES.bugsPerWave.base + DEFENSE_RULES.bugsPerWave.step * 4 + 1);
  engine.coins = 100000;
  engine.selectShopItem('firewall');
  engine.placeAtPoint({ x: 0.3, y: 0.27 });
  engine.wave = 5;
  engine.phase = 'spawning';
  engine.phaseUntil = Infinity;
  engine.nextSpawnAt = Infinity;
  const boss = engine.spawnBug('ransomware');
  const totalBefore = engine.waveTotal;
  while (boss.phase === 1) engine.damageBug(boss, 'tower');
  assert.equal(boss.hp, boss.maxHp * BUG_TYPES.ransomware.phaseTwo.at);
  assert.ok(events.some(event => event.type === 'boss-phase'));
  const hp = boss.hp;
  engine.damageBug(boss, 'tower');
  assert.equal(boss.hp, hp, '변신 중에는 무적');
  advance(engine, clock, DEFENSE_RULES.phaseShieldSeconds + 1.2, 0.1);
  assert.ok(events.some(event => event.type === 'boss-summon'), '졸개 소환');
  assert.ok(engine.waveTotal > totalBefore, '소환한 졸개도 웨이브에 센다');
  assert.ok(events.some(event => event.type === 'tower-locked'), '가까운 타워를 잠근다');
  assert.ok(engine.towers[0].lockedUntil > engine.gameTime);
});

test('보상: 버틴 웨이브만큼 진행 보너스, 다 막으면 클리어 보너스', () => {
  const base = { mode: 'defense', level: 2, correctKeystrokes: 300, accuracy: 100, maxCombo: 0 };
  const at = (wavesCleared, waveProgress) => rewardBreakdown({ ...base, outcome: 'breached', wavesCleared, waveProgress, waves: 10 }).progressBonus;
  assert.ok(at(1, 0) < at(3, 0) && at(3, 0) < at(4, 0));
  assert.ok(at(3, 0.6) > at(3, 0.2), '웨이브 절반 넘게 잡았으면 반 웨이브 인정');
  const cleared = rewardBreakdown({ ...base, outcome: 'cleared', wavesCleared: 10, waves: 10 });
  assert.equal(cleared.cleared, true);
  assert.equal(cleared.firstClearKey, 'defense:2');
});
