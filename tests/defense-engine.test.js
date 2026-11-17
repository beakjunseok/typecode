import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DefenseEngine, isOnPath, DEFENSE_COMPUTER, DEFENSE_RULES, BUG_TYPES, TOWER_TYPES, DEFENSE_PATH, bpmForWave, bossHp, wordCoins, waveBonusCoins, comboCoinFactor, towerStats, PLACEMENT, COMPUTER_GUARD, COMPUTER_LEVELS, GUARDIAN } from '../public/js/defense-engine.js';
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

test('수치: 웨이브 25개, BPM은 웨이브마다 2씩(보통 110→158), 보스는 다시 나올수록 단단, 단어 코인·콤보·웨이브 보너스', () => {
  assert.equal(DEFENSE_RULES.waves, 25);
  assert.equal(bpmForWave(2, 1), 110);
  assert.equal(bpmForWave(2, 25), 158);
  assert.equal(bossHp('ransomware', 5), 40);
  assert.equal(bossHp('ransomware', 15), 72);
  assert.equal(bossHp('rootkit', 25), 198);
  assert.deepEqual(Object.keys(DEFENSE_RULES.bossWaves).map(Number), [5, 10, 15, 20, 25]);
  assert.equal(bpmForWave(1, 1), 100);
  assert.equal(bpmForWave(2, 99), 158, '웨이브는 25까지만');
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

test('자유 배치: 길 가장자리까지 붙일 수 있고, 길·컴퓨터·겹침을 누르면 가장 가까운 빈자리로 밀어 짓는다', () => {
  const { engine, events } = setup({ level: 3 });
  engine.coins = 100000;
  assert.equal(engine.placementProblem({ x: 0.5, y: 0.16 }), 'path', '길 한가운데는 안 된다');
  assert.equal(engine.placementProblem({ x: 0.5, y: 0.16 + 0.06 }), null, '길 가장자리 바로 옆은 된다');
  assert.equal(engine.placementProblem({ x: 0.5, y: 0.87 }), 'computer', '책상·모니터 자리만 막는다');
  assert.equal(engine.placementProblem({ x: 0.36, y: 0.8 }), null, '컴퓨터 바로 옆도 된다');
  engine.selectShopItem('firewall');
  const onPath = engine.placeAtPoint({ x: 0.5, y: 0.16 });
  assert.equal(onPath.bought, true, '길을 눌러도 옆으로 밀어서 짓는다');
  assert.equal(onPath.nudged, true);
  assert.equal(isOnPath(onPath.tower), false);
  assert.ok(Math.hypot((onPath.tower.x - 0.5) / 0.6, onPath.tower.y - 0.16) <= PLACEMENT.nudgeRadius + 1e-9, '가까운 곳으로');
  engine.selectShopItem('firewall');
  assert.equal(engine.placeAtPoint({ x: onPath.tower.x, y: onPath.tower.y }).bought, true, '같은 타워를 누르면 강화');
  assert.equal(onPath.tower.level, 2);
  engine.selectShopItem('antivirus');
  const beside = engine.placeAtPoint({ x: onPath.tower.x + 0.005, y: onPath.tower.y });
  assert.equal(beside.bought, true);
  assert.ok(beside.nudged, '다른 타워 위면 옆으로');
  assert.ok(events.some(event => event.type === 'tower-built' && event.payload.nudged));
  engine.selectShopItem('antivirus');
  engine.hotkey('Escape');
  assert.equal(engine.buildMode, null, 'Esc로 취소');
  assert.ok(DEFENSE_PATH.at(-1).y < DEFENSE_COMPUTER.y, '길은 컴퓨터 위에서 끝난다');
  assert.ok(engine.suggestedSpots().every(spot => !isOnPath(spot)));
  engine.health = 10;
  engine.hotkey(String(Object.keys(TOWER_TYPES).length + 1));
  assert.equal(engine.health, 10 + DEFENSE_RULES.repairAmount, '마지막 숫자 = 수리');
});

test('강화(최대 Lv.3)와 판매: 타워를 눌러 강화, Lv.3 특수 능력, 70% 환급(이번 웨이브에 지은 건 100%)', () => {
  const { engine, events } = setup();
  engine.coins = 100000;
  engine.selectShopItem('antivirus');
  const { tower } = engine.placeAtPoint({ x: 0.3, y: 0.27 });
  assert.equal(engine.towerAt({ x: tower.x + 0.01, y: tower.y }), tower, '근처를 누르면 그 타워');
  const before = engine.upgradeInfo(tower);
  assert.equal(before.level, 1);
  assert.ok(before.next.range > before.current.range && before.next.cooldown < before.current.cooldown);
  assert.equal(engine.upgradeTower(tower).bought, true, '설치 모드 없이도 강화');
  assert.equal(engine.upgradeInfo(tower).perk.damage, 2, '다음이 Lv.3이면 특수 능력 미리보기');
  engine.upgradeTower(tower);
  assert.equal(tower.level, DEFENSE_RULES.maxTowerLevel);
  assert.equal(towerStats('antivirus', 3).damage, 2);
  assert.equal(towerStats('interceptor', 3).shots, 2);
  assert.ok(towerStats('firewall', 3).slow < towerStats('firewall', 2).slow);
  assert.equal(engine.upgradeTower(tower).reason, 'max-level', 'Lv.3이 끝');
  assert.ok(events.some(event => event.type === 'tower-upgraded' && event.payload.perk));
  const spent = tower.spent;
  const coins = engine.coins;
  assert.equal(engine.sellValue(tower), spent, '이번 웨이브에 지은 건 전액');
  engine.wave += 1;
  assert.equal(engine.sellValue(tower), Math.floor(spent * PLACEMENT.sellRefund));
  assert.equal(engine.sellTower(tower).sold, true);
  assert.equal(engine.towers.length, 0);
  assert.equal(engine.coins, coins + Math.floor(spent * PLACEMENT.sellRefund));
});

test('허니팟: 길에 끈끈이 웅덩이 → 위의 지상 적 모두 감속 + 지속 피해, 방화벽: 약한 한 발 + 화상 지속 피해', () => {
  const { engine, clock } = setup();
  engine.coins = 100000;
  engine.phase = 'spawning';
  engine.phaseUntil = Infinity;
  engine.nextSpawnAt = Infinity;
  const first = engine.spawnBug('malware');
  const second = engine.spawnBug('malware');
  first.progress = second.progress = 0.3;
  engine.moveBugs(0);
  engine.selectShopItem('honeypot');
  const { tower } = engine.placeAtPoint({ x: first.x, y: first.y + 0.08 });
  advance(engine, clock, 0.6, 0.05);
  assert.equal(engine.puddles.length, 1, '끈끈이를 던졌다');
  const puddle = engine.puddles[0];
  advance(engine, clock, puddle.activeAt - engine.gameTime + 0.01, 0.05);
  first.x = second.x = puddle.x;
  first.y = second.y = puddle.y;
  assert.ok(engine.slowFactor(first) <= towerStats('honeypot', 1).puddle.slow, '웅덩이 위는 느리다');
  first.steppedPuddles = new Set();
  second.steppedPuddles = new Set();
  first.hp = first.maxHp = second.hp = second.maxHp = 20;
  const before = [first.hp, second.hp];
  const stats = towerStats('honeypot', 1).puddle;
  assert.ok(stats.slow <= 0.35, '꿀 위는 많이 느리다');
  engine.applyLingeringDamage(1);
  assert.ok(first.hp < before[0] && second.hp < before[1], '광역 지속 피해');
  assert.ok(Math.abs(before[0] - first.hp - stats.dps - stats.stepDamage) < 1e-9, '처음 밟을 때 밟음 피해 + 지속 피해');
  const afterFirst = first.hp;
  engine.applyLingeringDamage(1);
  assert.ok(Math.abs(afterFirst - first.hp - stats.dps) < 1e-9, '밟음 피해는 웅덩이마다 한 번');
  const drone = engine.spawnBug('drone');
  drone.x = puddle.x; drone.y = puddle.y;
  assert.equal(engine.activePuddlesUnder(drone).length, 0, '공중은 안 밟는다');
  assert.ok(tower);
  assert.ok(towerStats('firewall', 1).damage < 1, '방화벽 한 발은 약하다');
  const burning = engine.spawnBug('malware');
  burning.burnUntil = engine.gameTime + 2;
  burning.burnDps = towerStats('firewall', 1).burn.dps;
  const hp = burning.hp;
  engine.applyLingeringDamage(1);
  assert.ok(hp - burning.hp >= burning.burnDps - 1e-9, '화상 지속 피해');
  assert.ok(towerStats('honeypot', 3).puddle.slow < towerStats('honeypot', 2).puddle.slow, 'Lv.3 초강력 끈끈이');
});

test('EMP포: 떨어진 곳 반경 안의 지상 적 모두에게 피해(스플래시), Lv.3은 반경 1.5배', () => {
  const { engine, events } = setup();
  engine.coins = 100000;
  engine.phase = 'spawning';
  engine.phaseUntil = Infinity;
  engine.nextSpawnAt = Infinity;
  const group = [0, 1, 2].map(() => engine.spawnBug('malware'));
  const far = engine.spawnBug('malware');
  for (const bug of [...group, far]) bug.hp = bug.maxHp = 10;
  group.forEach((bug, index) => { bug.progress = 0.3; bug.x = 0.5 + index * 0.01; bug.y = 0.16; });
  far.x = 0.92; far.y = 0.5; far.progress = 0.1;
  engine.selectShopItem('emp');
  const { tower } = engine.placeAtPoint({ x: 0.5, y: 0.27 });
  tower.readyAt = 0;
  engine.fireTowers();
  assert.ok(group.every(bug => bug.hp === 9), '무리 전체가 맞는다');
  assert.equal(far.hp, 10, '반경 밖은 안 맞는다');
  assert.ok(events.some(event => event.type === 'splash' && event.payload.hits === 3));
  assert.ok(Math.abs(towerStats('emp', 3).splash / towerStats('emp', 2).splash - 1.5 * 1.2 / 1.1) < 1e-9);
  const drone = engine.spawnBug('drone');
  drone.hp = drone.maxHp = 10;
  drone.x = group[0].x; drone.y = group[0].y;
  tower.readyAt = 0;
  engine.fireTowers();
  assert.equal(drone.hp, 9.5, '드론은 절반 피해');
  assert.ok(engine.slowFactor(drone) <= 0.5, '그리고 느려진다');
  assert.ok(events.some(event => event.type === 'air-jammed'));
});

test('컴퓨터 대공 포탑: 가까이 온 공중 적만 자동으로 쏜다', () => {
  const { engine, events, clock } = setup();
  engine.phase = 'spawning';
  engine.phaseUntil = Infinity;
  engine.nextSpawnAt = Infinity;
  const drone = engine.spawnBug('drone');
  drone.hp = drone.maxHp = 5;
  const ground = engine.spawnBug('malware');
  ground.hp = ground.maxHp = 5;
  drone.x = ground.x = COMPUTER_GUARD.x;
  drone.y = ground.y = COMPUTER_GUARD.y - 0.05;
  engine.lastWord = 'const';
  engine.fireGuard();
  assert.equal(engine.guardShots[0].text, 'const', '방금 친 낱말을 던진다');
  assert.equal(drone.hp, 5, '날아가는 중에는 아직');
  engine.gameTime += COMPUTER_GUARD.flightSeconds;
  engine.landGuardShots();
  assert.equal(drone.hp, 4, '닿으면 피해');
  assert.equal(ground.hp, 5, '지상은 안 쏜다');
  engine.fireGuard();
  engine.gameTime += COMPUTER_GUARD.flightSeconds;
  engine.landGuardShots();
  assert.equal(drone.hp, 4, '쿨다운');
  assert.ok(events.some(event => event.type === 'guard-shot'));
  const farDrone = engine.spawnBug('drone');
  farDrone.x = 0.5; farDrone.y = 0.05;
  engine.guardReadyAt = 0;
  drone.state = 'dead';
  engine.fireGuard();
  assert.equal(farDrone.hp, farDrone.maxHp, '멀리 있으면 안 쏜다');
});

test('컴퓨터 강화: Lv.3까지 대공 사거리·연사·체력, Lv.3은 2발 동시 + 자동 복구', () => {
  const { engine } = setup();
  engine.coins = 100000;
  const health = engine.maxHealth;
  const first = engine.computerUpgradeInfo();
  assert.equal(first.level, 1);
  assert.ok(first.next.range > first.current.range && first.next.cooldown < first.current.cooldown);
  assert.equal(engine.upgradeComputer().bought, true);
  assert.equal(engine.maxHealth, health + COMPUTER_LEVELS[2].bonusHealth);
  engine.upgradeComputer();
  assert.equal(engine.computerLevel, 3);
  assert.equal(engine.upgradeComputer().reason, 'max-level');
  engine.health = 10;
  engine.applyLingeringDamage(2);
  assert.equal(engine.health, 10 + COMPUTER_LEVELS[3].regen * 2, '자동 복구');
  engine.phase = 'spawning';
  engine.phaseUntil = Infinity;
  engine.nextSpawnAt = Infinity;
  const drones = [engine.spawnBug('drone'), engine.spawnBug('drone')];
  for (const drone of drones) { drone.x = COMPUTER_GUARD.x; drone.y = COMPUTER_GUARD.y - 0.05; }
  engine.guardReadyAt = 0;
  engine.fireGuard();
  assert.equal(engine.guardShots.filter(shot => !shot.landed).length, 2, '두 표적 동시');
  const poor = setup().engine;
  poor.coins = 0;
  assert.equal(poor.upgradeComputer().reason, 'coins');
});

test('가디언 봇: 컴퓨터 최대 강화 때 출동, 적 옆에 떨어져 서서(겹치지 않게) 때리고, 없으면 집으로', () => {
  const { engine, events } = setup();
  engine.coins = 100000;
  engine.upgradeComputer();
  assert.equal(engine.guardian, undefined, 'Lv.2에서는 아직');
  engine.upgradeComputer();
  assert.ok(engine.guardian, 'Lv.3 출동');
  assert.ok(events.some(event => event.type === 'guardian-spawn'));
  engine.phase = 'spawning';
  engine.phaseUntil = Infinity;
  engine.nextSpawnAt = Infinity;
  const bug = engine.spawnBug('malware');
  bug.hp = bug.maxHp = 10;
  const pinned = { x: GUARDIAN.home.x + 0.12, y: GUARDIAN.home.y - 0.05 };
  for (let frame = 0; frame < 120; frame++) {
    bug.x = pinned.x; bug.y = pinned.y;
    engine.gameTime += 0.05;
    engine.updateGuardian(0.05);
  }
  const bot = engine.guardian;
  assert.ok(bug.hp < 10, '때렸다');
  assert.ok(Math.abs(bot.x - bug.x) >= GUARDIAN.standOff * 0.9, '겹치지 않고 옆에 선다');
  assert.ok(Math.abs(bot.y - bug.y) < 0.01);
  assert.equal(bot.facing, bot.x < bug.x ? 1 : -1, '적을 바라본다');
  bug.state = 'dead';
  for (let frame = 0; frame < 120; frame++) { engine.gameTime += 0.05; engine.updateGuardian(0.05); }
  assert.ok(engine.fieldDistance(bot, GUARDIAN.home) < 0.01, '집으로 돌아옴');
  assert.equal(bot.state, 'idle');
});

test('가디언 봇과 적이 서로 때린다: 봇을 만난 지상 적은 (보스까지) 멈추고, 봇은 맞다가 쓰러지면 잠시 뒤 다시 출동', () => {
  const { engine, events } = setup();
  engine.coins = 100000;
  engine.upgradeComputer();
  engine.upgradeComputer();
  engine.phase = 'spawning';
  engine.phaseUntil = Infinity;
  engine.nextSpawnAt = Infinity;
  const bot = engine.guardian;
  engine.gameTime += 1;
  engine.updateGuardian(0.05);
  const bug = engine.spawnBug('malware');
  bug.hp = bug.maxHp = 1000;
  bug.progress = 0.97;
  engine.moveBugs(0);
  bot.x = bug.x - GUARDIAN.standOff; bot.y = bug.y;
  engine.updateGuardian(0.05);
  assert.ok(engine.isHeldByGuardian(bug), '봇을 만나면 멈춘다');
  const progress = bug.progress;
  engine.moveBugs(1);
  assert.equal(bug.progress, progress, '걸음이 멈췄다');
  const follower = engine.spawnBug('packet');
  follower.progress = bug.progress - GUARDIAN.queueGap * 0.5;
  const followerStart = follower.progress;
  engine.moveBugs(1);
  assert.equal(follower.progress, followerStart, '뒤에 오던 적도 간격을 두고 줄 서서 멈춘다');
  const far = engine.spawnBug('packet');
  far.progress = 0.2;
  engine.moveBugs(0.5);
  assert.ok(far.progress > 0.2, '멀리 있는 적은 계속 걷는다');
  follower.state = far.state = 'dead';
  const boss = engine.spawnBug('ransomware');
  boss.x = bot.x + 0.04; boss.y = bot.y;
  assert.ok(engine.isHeldByGuardian(boss), '보스도 멈춘다');
  boss.state = 'dead';
  const drone = engine.spawnBug('drone');
  drone.x = bot.x; drone.y = bot.y;
  assert.equal(engine.isHeldByGuardian(drone), false, '공중은 막지 못한다');
  drone.state = 'dead';
  for (let frame = 0; frame < 400 && bot.state !== 'down'; frame++) {
    engine.gameTime += 0.05;
    engine.updateGuardian(0.05);
  }
  assert.ok(events.some(event => event.type === 'guardian-hurt' && event.payload.damage === GUARDIAN.enemyHit.malware), '적이 봇을 때린다');
  assert.ok(events.some(event => event.type === 'guardian-hit'), '봇도 적을 때린다');
  assert.equal(bot.state, 'down', '쓰러진다');
  assert.equal(engine.isHeldByGuardian(bug), false, '쓰러지면 적이 다시 걷는다');
  engine.gameTime += GUARDIAN.respawnSeconds;
  engine.updateGuardian(0.05);
  assert.equal(engine.guardian.hp, GUARDIAN.maxHp, '다시 출동');
  assert.ok(events.some(event => event.type === 'guardian-spawn' && event.payload.respawn));
});

test('가격과 성능: 요격포가 백신보다 강하고(사거리·화력·공중) 더 비싸다', () => {
  const antivirus = towerStats('antivirus', 1), interceptor = towerStats('interceptor', 1);
  assert.ok(interceptor.range > antivirus.range);
  assert.ok(1 / interceptor.cooldown > 1 / antivirus.cooldown);
  assert.ok(TOWER_TYPES.interceptor.price > TOWER_TYPES.antivirus.price);
  assert.ok(1 / antivirus.cooldown / TOWER_TYPES.antivirus.price >= 1 / interceptor.cooldown / TOWER_TYPES.interceptor.price, '지상 가성비는 백신');
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

test('요격포: 공중·지상 모두 쏘고, 사거리가 가장 넓으며, 공중을 먼저 노린다', () => {
  assert.ok(TOWER_TYPES.interceptor.range > TOWER_TYPES.antivirus.range);
  const { engine } = setup();
  const tower = { id: 999, type: 'interceptor', x: 0.5, y: 0.5, level: 1 };
  const ground = { air: false, progress: 0.9 };
  const air = { air: true, progress: 0.1 };
  assert.equal(engine.canTarget(tower, ground), true);
  assert.equal(engine.canTarget(tower, air), true);
  assert.ok(engine.targetPriority(tower, air) > engine.targetPriority(tower, ground), '공중 먼저');
  const antivirus = { ...tower, type: 'antivirus' };
  assert.equal(engine.canTarget(antivirus, air), false);
  assert.ok(engine.targetPriority(antivirus, ground) > engine.targetPriority(antivirus, { air: false, progress: 0.2 }));
});

test('보스: 5웨이브 랜섬웨어 · 10웨이브 루트킷, 체력 절반에서 2페이즈(잠깐 무적·소환·타워 잠금)', () => {
  assert.equal(DEFENSE_RULES.bossWaves[5], 'ransomware');
  assert.equal(DEFENSE_RULES.bossWaves[10], 'rootkit');
  const { engine, events, clock } = setup();
  assert.equal(engine.bugsInWave(5), Math.round(DEFENSE_RULES.bugsPerWave.base + DEFENSE_RULES.bugsPerWave.step * 4) + 1);
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
  const at = (wavesCleared, waveProgress) => rewardBreakdown({ ...base, outcome: 'breached', wavesCleared, waveProgress, waves: 25 }).progressBonus;
  assert.ok(at(1, 0) < at(3, 0) && at(3, 0) < at(4, 0));
  assert.ok(at(3, 0.6) > at(3, 0.2), '웨이브 절반 넘게 잡았으면 반 웨이브 인정');
  const cleared = rewardBreakdown({ ...base, outcome: 'cleared', wavesCleared: 25, waves: 25 });
  assert.equal(cleared.cleared, true);
  assert.equal(cleared.firstClearKey, 'defense:2');
});
