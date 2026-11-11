import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BatteryPvpHostEngine, BatteryPvpGuestEngine, PVP_RULES, parsePvpMessage } from '../public/js/battery-pvp.js';
import { BATTERY_RULES, BATTERY_ITEMS } from '../public/js/battery-engine.js';

const POOL = ['alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot', 'golf', 'hotel', 'india', 'juliet', 'kilo', 'lima', 'mike', 'november']
  .map(text => ({ text, kind: 'keyword' }));

function seeded(seed = 11) {
  let state = seed;
  return () => ((state = (state * 1664525 + 1013904223) % 4294967296) / 4294967296);
}

// 같은 프로세스 안의 두 기기: 손님이 보낸 메시지는 방장이 처리하고, 결과·상태는 바로 손님에게 돌아간다
function createMatch() {
  const hostEvents = [];
  const guestEvents = [];
  const clock = { now: 0 };
  const host = new BatteryPvpHostEngine({ tokenPool: POOL, random: seeded(), opponentName: '손님', onEvent: (type, payload) => hostEvents.push({ type, payload }) });
  const toHost = [];
  const guest = new BatteryPvpGuestEngine({
    tokenPool: POOL, random: seeded(99), opponentName: '방장', send: message => toHost.push(message),
    onEvent: (type, payload) => guestEvents.push({ type, payload })
  });
  const sync = () => {
    while (toHost.length) {
      const message = parsePvpMessage(JSON.stringify(toHost.shift()));
      if (message.t === 'progress') host.applyRemoteProgress(message);
      if (message.t === 'claim') guest.applyClaimResult(parsePvpMessage(JSON.stringify(host.applyRemoteClaim(message))));
    }
    guest.applyState(parsePvpMessage(JSON.stringify(host.stateMessage())), clock.now);
  };
  const advance = seconds => {
    for (let elapsed = 0; elapsed < seconds - 1e-9; elapsed += 0.05) {
      clock.now += 50;
      host.update(clock.now);
      guest.update(clock.now);
      sync();
    }
  };
  const start = () => {
    host.start(clock.now);
    host.nextItemAt = Infinity;
    sync();
  };
  return { host, guest, hostEvents, guestEvents, clock, sync, advance, start, toHost };
}

const typeText = (engine, clock, text) => { for (const character of text) engine.input(character, clock.now); };

test('손님 화면은 좌우가 뒤집힌다: 내 탑 = 방장의 상대 탑, 아이템 x·방향 반전, 낱말 교차', () => {
  const { host, guest, sync, start } = createMatch();
  assert.equal(guest.input('a', 0).accepted, false, '방장이 시작하기 전에는 못 친다');
  start();
  assert.equal(guest.status, 'running');
  host.rival.cells = 5.25;
  host.me.cells = 2;
  const item = host.spawnItem('cell', 0.4, 1);
  item.x = 0.2;
  sync();
  const mirrored = guest.items.find(candidate => candidate.id === item.id);
  assert.ok(Math.abs(mirrored.x - 0.8) < 1e-9);
  assert.equal(mirrored.direction, -1);
  assert.equal(guest.me.cells, 5.25);
  assert.equal(guest.rival.cells, 2);
  assert.equal(guest.rivalWord.id, host.myWord.id, '손님이 칠 낱말 = 방장 탑 낱말');
  assert.equal(guest.rivalWord.token.text, host.myWord.token.text);
  assert.equal(guest.myWord.id, host.rivalWord.id);
  assert.equal(guest.rivalName, '방장');
});

test('손님이 아이템을 먼저 치면 손님 것: 방장이 판정하고 점수 보너스를 돌려준다', () => {
  const { host, guest, clock, sync, start, advance, guestEvents } = createMatch();
  start();
  const item = host.spawnItem('powerbank', 0.4, 1);
  sync();
  const guestCellsBefore = host.rival.cells;
  typeText(guest, clock, item.token.text.slice(0, 2));
  sync();
  assert.equal(host.ai.targetId, item.id, '방장 화면에 손님 진행(밑줄) 표시');
  assert.equal(host.aiProgressFor(item.id), 2);
  typeText(guest, clock, item.token.text.slice(2));
  const scoreBeforeResult = guest.score;
  sync();
  assert.equal(host.items.find(candidate => candidate.id === item.id).takenBy, 'rival');
  assert.ok(host.rival.cells > guestCellsBefore, '손님 탑 +1');
  assert.equal(guest.score, scoreBeforeResult + BATTERY_ITEMS.powerbank.bounty);
  assert.equal(guest.itemsCollected, 1);
  assert.ok(guestEvents.some(event => event.type === 'item'));
  advance(0.1);
  assert.ok(Math.abs(guest.me.cells - host.rival.cells) < 0.02, '손님 화면 내 탑에 반영');
});

test('방장이 먼저 가져간 아이템을 손님이 치고 있었으면 조준이 풀리고, 늦은 요청은 거절', () => {
  const { host, guest, clock, sync, start } = createMatch();
  start();
  const item = host.spawnItem('cell', 0.4, 1);
  sync();
  typeText(guest, clock, item.token.text.slice(0, 1));
  assert.equal(guest.targetId, item.id);
  typeText(host, clock, item.token.text);
  sync();
  assert.equal(guest.targetId, null, '방장이 먼저 → 손님 조준 해제');
  assert.equal(guest.stolen, 1);
  const late = host.applyRemoteClaim({ claimId: 99, targetId: item.id, text: item.token.text });
  assert.equal(late.ok, false);
  assert.equal(late.reason, 'taken');
});

test('손님이 방장 탑을 공격: 방장 −0.5칸·손님 +0.5칸, 방장 탑 낱말이 바뀌고 손님 화면에도 반영', () => {
  const { host, guest, clock, sync, start, hostEvents, guestEvents } = createMatch();
  start();
  const hostBefore = host.me.cells;
  const guestBefore = host.rival.cells;
  typeText(guest, clock, guest.rivalWord.token.text);
  assert.equal(guest.targetables().some(entity => entity.id === guest.rivalWord.id), false, '판정 대기 중엔 다시 조준 안 함');
  sync();
  assert.equal(host.me.cells, hostBefore - BATTERY_RULES.stealCells);
  assert.equal(host.rival.cells, guestBefore + BATTERY_RULES.stealCells);
  assert.ok(hostEvents.some(event => event.type === 'rival-attack'));
  assert.ok(guestEvents.some(event => event.type === 'drain'));
  assert.equal(guest.rivalWord.token.text, host.myWord.token.text);
  assert.equal(guest.pendingClaims.size, 0);
  assert.equal(guest.drains, 1);
});

test('낱말이 이미 바뀐 공격(늦게 도착)은 거절', () => {
  const { host, start } = createMatch();
  start();
  const result = host.applyRemoteClaim({ claimId: 1, targetId: host.myWord.id, text: 'definitely-not-the-word' });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'gone');
  assert.equal(host.applyRemoteClaim({ claimId: 2, targetId: host.rivalWord.id, text: host.rivalWord.token.text }).ok, false, '자기 탑 낱말은 못 침');
});

test('화면 꺼짐: 가져간 쪽의 상대가 3초 동안 못 친다(양쪽 모두)', () => {
  const { host, guest, clock, sync, start, advance } = createMatch();
  start();
  const blackout = host.spawnItem('blackout', 0.4, 1);
  sync();
  typeText(guest, clock, blackout.token.text);
  sync();
  assert.ok(host.blockedUntil > host.gameTime);
  assert.equal(host.input(host.rivalWord.token.text[0], clock.now).reason, 'blocked');
  advance(PVP_RULES.blackoutSeconds + 0.1);
  assert.notEqual(host.input(host.rivalWord.token.text[0], clock.now).reason, 'blocked', '3초 뒤 풀림');
  host.clearInput(clock.now);

  const second = host.spawnItem('blackout', 0.5, 1);
  sync();
  typeText(host, clock, second.token.text);
  advance(0.3);
  assert.ok(guest.blockedUntil > guest.gameTime, '방장이 가져가면 손님이 막힘');
  assert.equal(guest.input(guest.rivalWord.token.text[0], clock.now).reason, 'blocked');
});

test('3판 2선승: 판이 끝나면 탑 초기화·잠깐 멈춤, 2승이면 경기 끝(손님은 반대 결과)', () => {
  const { host, guest, sync, start, advance, guestEvents, hostEvents } = createMatch();
  start();
  host.me.cells = BATTERY_RULES.goalCells;
  host.checkOutcome();
  sync();
  assert.deepEqual(host.wins, { host: 1, guest: 0 });
  assert.equal(host.round, 2);
  assert.equal(host.me.cells, BATTERY_RULES.startCells);
  assert.ok(host.pauseUntil > host.gameTime);
  assert.ok(guestEvents.some(event => event.type === 'round-end' && event.payload.mine === false));
  assert.deepEqual(guest.wins, { mine: 0, theirs: 1 });
  advance(BATTERY_RULES.stageClearPause + 0.1);

  host.me.cells = 0.01;
  host.rival.cells = 3;
  advance(0.5);
  assert.deepEqual(host.wins, { host: 1, guest: 1 }, '방장 0% → 손님 승');
  advance(BATTERY_RULES.stageClearPause + 0.1);

  host.rival.cells = 0.001;
  advance(0.2);
  assert.equal(host.status, 'finished');
  assert.equal(host.outcome, 'win');
  assert.equal(guest.status, 'finished');
  assert.equal(guest.outcome, 'lose');
  assert.equal(host.summary().pvp.wins.mine, 2);
  assert.equal(guest.summary().pvp.wins.mine, 1);
  assert.ok(hostEvents.some(event => event.type === 'finish'));
});

test('메시지 검사: JSON·종류·크기', () => {
  assert.equal(parsePvpMessage('not json'), null);
  assert.equal(parsePvpMessage(JSON.stringify({ t: 'hack' })), null);
  assert.equal(parsePvpMessage(JSON.stringify({ t: 'claim', claimId: 1 })).t, 'claim');
  assert.equal(parsePvpMessage('x'.repeat(70_000)), null);
  assert.equal(parsePvpMessage(42), null);
});

test('스냅샷이 6초 넘게 안 오면 연결 끊김으로 본다', () => {
  const { guest, clock, start } = createMatch();
  start();
  assert.equal(guest.isStale(clock.now + 1000), false);
  assert.equal(guest.isStale(clock.now + PVP_RULES.disconnectSeconds * 1000 + 1), true);
});
