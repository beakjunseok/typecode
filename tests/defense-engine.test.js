import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DefenseEngine, DEFENSE_RULES, BUG_TYPES, TOWER_TYPES, DEFENSE_PATH, pointOnPath, bpmForWave, wordCoins, waveBonusCoins, comboCoinFactor } from '../public/js/defense-engine.js';
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

// 살아 있는 버그를 컴퓨터에 가까운 것부터 모두 친다
function typeAllBugs(engine, clock) {
  for (const bug of engine.bugs.filter(entry => entry.state === 'alive' && !entry.doomed).sort((a, b) => b.y - a.y)) {
    if (engine.status !== 'running' || engine.winAt != null) return;
    typeWord(engine, clock, bug.token.text);
  }
}

test('수치: BPM은 웨이브마다 5씩(보통 110→130), 단어 코인·콤보·웨이브 보너스', () => {
  assert.deepEqual([1, 2, 3, 4, 5].map(wave => bpmForWave(2, wave)), [110, 115, 120, 125, 130]);
  assert.equal(bpmForWave(1, 1), 100);
  assert.equal(bpmForWave(4, 9), 150, '웨이브는 5까지만');
  assert.equal(wordCoins(5, 1, 0), 7, '(2 + 5) × 1 × 1');
  assert.equal(wordCoins(5, 5, 30), 28, '(2 + 5) × 2 × 2');
  assert.equal(comboCoinFactor(9), 1);
  assert.equal(comboCoinFactor(10), 1.2);
  assert.equal(waveBonusCoins(1, true), 75);
  assert.equal(waveBonusCoins(1, false), 98, '무피해 ×1.3');
});

test('웨이브: 소개 뒤 버그가 나오고, 다 잡으면 보너스 코인과 다음 웨이브', () => {
  const { engine, events, clock } = setup();
  assert.equal(engine.phase, 'intro');
  advance(engine, clock, DEFENSE_RULES.introSeconds + 0.1);
  assert.equal(engine.phase, 'spawning');
  for (let guard = 0; guard < 400 && engine.wave === 1 && engine.status === 'running'; guard++) {
    typeAllBugs(engine, clock);
    advance(engine, clock, 0.3);
  }
  assert.equal(engine.wavesCleared, 1);
  const clear = events.find(event => event.type === 'wave-clear');
  assert.ok(clear, '웨이브 클리어 이벤트');
  assert.equal(clear.payload.perfect, true, '피해 없이');
  assert.ok(engine.coins > DEFENSE_RULES.startCoins + 75, '단어 코인 + 무피해 웨이브 보너스');
});

test('공격이 컴퓨터에 닿으면 체력이 깎이고, 0이면 해킹당해 끝난다', () => {
  const { engine, events, clock } = setup({ level: 4 });
  advance(engine, clock, 300, 0.1);
  assert.equal(engine.status, 'finished');
  assert.equal(engine.summary().outcome, 'breached');
  assert.ok(events.some(event => event.type === 'danger'), '30% 아래로 떨어질 때 위험 신호(음악 필터)');
  assert.equal(engine.health, 0);
});

test('상점: 코인이 모자라면 거절, 있으면 설치 자리마다 낱말이 뜨고 그 낱말을 치면 그 자리에 타워', () => {
  const { engine, events, clock } = setup();
  typeWord(engine, clock, 'firewall');
  assert.ok(events.some(event => event.type === 'shop-denied' && event.payload.reason === 'coins'), '시작 코인 60 < 120');
  assert.equal(engine.buildMode, null);
  engine.coins = 1000;
  typeWord(engine, clock, 'antivirus');
  assert.equal(engine.buildMode.tower, 'antivirus');
  const spots = engine.spots.filter(spot => spot.token);
  assert.equal(spots.length, DEFENSE_RULES.slots, '빈 자리 6곳 모두 낱말');
  assert.ok(spots.every(spot => spot.token.text.length <= DEFENSE_RULES.spotTokenMaxLength));
  assert.equal(new Set(engine.targetables().map(entity => entity.token.text[0])).size, engine.targetables().length, '첫 글자가 모두 다름');
  const chosen = spots[3];
  typeWord(engine, clock, chosen.token.text);
  assert.equal(engine.towers.length, 1);
  assert.equal(engine.towers[0].slot, chosen.slot, '고른 자리에 선다');
  assert.equal(engine.buildMode, null);
  assert.ok(engine.spots.every(spot => !spot.token), '자리 낱말은 사라진다');
  assert.equal(engine.coins, 1000 - TOWER_TYPES.antivirus.price);
  advance(engine, clock, 40, 0.1);
  assert.ok(events.some(event => event.type === 'tower-shot'), '타워가 쏜다');
  assert.ok(events.some(event => event.type === 'bug-kill' && event.payload.source === 'tower'));
});

test('자리가 다 차면 같은 타워 위에 낱말이 떠서 업그레이드, 다시 치면 취소, 패치는 체력을 고친다', () => {
  const { engine, clock } = setup({ level: 3 });
  engine.coins = 100000;
  for (let index = 0; index < DEFENSE_RULES.slots; index++) {
    typeWord(engine, clock, 'firewall');
    typeWord(engine, clock, engine.spots.find(spot => spot.token).token.text);
  }
  assert.equal(engine.towers.length, DEFENSE_RULES.slots);
  typeWord(engine, clock, 'firewall');
  assert.equal(engine.buildMode.upgrade, true);
  typeWord(engine, clock, 'firewall');
  assert.equal(engine.buildMode, null, '같은 상점 낱말을 다시 치면 취소');
  const before = engine.coins;
  typeWord(engine, clock, 'firewall');
  typeWord(engine, clock, engine.spots.find(spot => spot.token).token.text);
  assert.equal(engine.towers.filter(tower => tower.level === 2).length, 1, '업그레이드');
  assert.equal(before - engine.coins, Math.round(TOWER_TYPES.firewall.price * 1.08 * 1.5), 'Lv.3 상점가 ×1.08, 업그레이드 ×1.5');
  engine.health = 10;
  typeWord(engine, clock, 'patch');
  assert.equal(engine.health, 10 + DEFENSE_RULES.repairAmount);
});

test('여러 번 맞혀야 하는 공격은 맞을 때마다 낱말이 바뀐다 · 길을 따라 간다 · 마지막 웨이브에 보스', () => {
  const { engine, clock } = setup();
  engine.wave = 3;
  const trojan = engine.spawnBug('malware');
  const first = trojan.token.text;
  typeWord(engine, clock, first);
  advance(engine, clock, 0.4);
  assert.equal(trojan.state, 'alive');
  assert.equal(trojan.hp, 1);
  assert.equal(engine.bugsInWave(DEFENSE_RULES.waves), DEFENSE_RULES.bugsPerWave.base + DEFENSE_RULES.bugsPerWave.step * 4 + 1);
  assert.equal(BUG_TYPES.ransomware.boss, true);
  const near = (point, target) => Math.abs(point.x - target.x) < 1e-9 && Math.abs(point.y - target.y) < 1e-9;
  assert.ok(near(pointOnPath(0), DEFENSE_PATH[0]));
  assert.ok(near(pointOnPath(1), DEFENSE_PATH.at(-1)));
  const before = { x: trojan.x, y: trojan.y };
  advance(engine, clock, 5);
  assert.ok(trojan.progress > 0 && (trojan.x !== before.x || trojan.y !== before.y), '길 위로 움직인다');
});

test('보상: 버틴 웨이브만큼 진행 보너스, 다 막으면 클리어 보너스', () => {
  const base = { mode: 'defense', level: 2, correctKeystrokes: 300, accuracy: 100, maxCombo: 0 };
  const at = (wavesCleared, waveProgress) => rewardBreakdown({ ...base, outcome: 'breached', wavesCleared, waveProgress, waves: 5 }).progressBonus;
  assert.ok(at(1, 0) < at(3, 0) && at(3, 0) < at(4, 0));
  assert.ok(at(3, 0.6) > at(3, 0.2), '웨이브 절반 넘게 잡았으면 반 웨이브 인정');
  const cleared = rewardBreakdown({ ...base, outcome: 'cleared', wavesCleared: 5, waves: 5 });
  assert.equal(cleared.cleared, true);
  assert.equal(cleared.firstClearKey, 'defense:2');
});
