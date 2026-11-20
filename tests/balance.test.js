import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.BLOB_READ_WRITE_TOKEN ??= 'vercel_blob_rw_test_dummy';
const lib = await import('../api/_lib.js');
const { createBalanceRoutes, decodeReportPath, recentWeeks } = await import('../api/_balance.js');
const { buildReport, normalizeReport, aggregateDefense, aggregateItems, MAX_REPORT_LENGTH, MIN_SAMPLES } = await import('../public/js/balance-report.js');
const { DEFENSE_CARDS } = await import('../public/js/defense-cards.js');

const memoryStorage = () => {
  const names = [];
  return {
    names,
    async exists(prefix) { return names.some(name => name.startsWith(prefix)); },
    async save(pathname) { names.push(pathname); },
    async list(prefix, limit) { return names.filter(name => name.startsWith(prefix)).slice(0, limit); }
  };
};
const post = body => new Request('http://localhost/api/balance', { method: 'POST', body: JSON.stringify(body) });
const defenseSummary = (extra = {}) => ({
  mode: 'defense', level: 3, survivedSeconds: 200, charactersPerMinute: 250, wavesCleared: 9, outcome: 'breached',
  draftLog: [{ wave: 3, hand: ['overclock', 'miner', 'crit'], pick: 'crit' }, { wave: 6, hand: ['awaken', 'stash', 'lag'], pick: 'awaken' }], ...extra
});

test('기록 만들기: 짧은 판·자동 연주·모르는 모드는 안 보냄, 디펜스는 고른 카드 순번까지', () => {
  assert.equal(buildReport({ ...defenseSummary(), survivedSeconds: 5 }), null);
  assert.equal(buildReport({ ...defenseSummary(), autoPlay: true }), null);
  assert.equal(buildReport({ mode: 'rhythm', survivedSeconds: 100 }), null);
  const report = buildReport(defenseSummary());
  assert.deepEqual(report.d, [[3, 'overclock|miner|crit', 2], [6, 'awaken|stash|lag', 0]]);
  assert.equal(report.w, 9);
  assert.equal(report.win, 0);
});

test('검증: 모르는 카드·아이템·등급은 버리고, 길면 경로 길이 안으로 줄인다', () => {
  const report = normalizeReport('defense', { v: 1, l: 9, s: 99999, w: 300, win: 1, d: [[3, 'overclock|hacked|miner', 1], [6, 'nope', 0], ...Array(30).fill([9, 'overclock|miner|crit', 0])] });
  assert.equal(report.l, 4);
  assert.equal(report.s, 3600);
  assert.equal(report.w, 99);
  assert.deepEqual(report.d[0], [3, 'overclock|miner', 1]);
  assert.ok(JSON.stringify(report).length <= MAX_REPORT_LENGTH);
  const battery = normalizeReport('battery', { v: 1, l: 2, s: 60, win: 1, it: { 'powerbank:legendary': [2, 1], 'fake:rare': [1, 0], 'eco:mythic': [1, 1] } });
  assert.deepEqual(battery.it, { 'powerbank:legendary': [2, 1] });
  assert.equal(normalizeReport('defense', { v: 2 }), null);
  assert.equal(normalizeReport('rhythm', { v: 1 }), null);
});

test('서버: 서명된 세션만, 판마다 한 번, 모드가 맞아야 받는다. 저장 경로는 950자 안', async () => {
  const storage = memoryStorage();
  const { POST, GET } = createBalanceRoutes(storage);
  const { token, session } = lib.issueSessionToken({ mode: 'defense', language: 'go', level: 3 });
  const report = buildReport({ ...defenseSummary(), survivedSeconds: 0 }) ?? { ...buildReport(defenseSummary()), s: 0 };
  assert.equal((await POST(post({ token: 'bad.token', report }))).status, 401);
  assert.equal((await POST(post({ token, report: { v: 1 } }))).status, 201, '빈 기록도 형식만 맞으면 정리해서 받는다');
  assert.equal((await POST(post({ token, report }))).status, 409, '같은 판은 한 번만');
  const late = lib.issueSessionToken({ mode: 'defense', language: 'go', level: 3 }).token;
  assert.equal((await POST(post({ token: late, report: { ...report, s: 500 } }))).status, 422, '서버 시간보다 긴 판');
  const rhythm = lib.issueSessionToken({ mode: 'rhythm', language: 'go' }).token;
  assert.equal((await POST(post({ token: rhythm, report }))).status, 422);
  assert.ok(storage.names.every(name => name.length < 950));
  assert.ok(storage.names[0].includes(session.sid));
  const decoded = decodeReportPath('defense', storage.names[0]);
  assert.equal(decoded.v, 1);
  const response = await GET(new Request('http://localhost/api/balance?mode=defense&weeks=2&raw=1'));
  const body = await response.json();
  assert.equal(body.runs, 1);
  assert.equal(body.reports.length, 1);
  assert.equal(recentWeeks(3).length, 3);
});

test('디펜스 집계: 같은 순번끼리 비교한 lift, 등급별 평균과 셈·약함 판정', () => {
  const reports = [];
  for (let index = 0; index < 200; index++) {
    // crit을 고른 판은 3웨이브 더 버티고, miner를 고른 판은 1웨이브 덜 버틴 가짜 자료
    const pick = index % 3;
    const hand = ['overclock', 'miner', 'crit'];
    reports.push({ v: 1, l: 2, s: 100, cpm: 200, win: 0, w: 10 + (pick === 2 ? 3 : pick === 1 ? -1 : 0), d: [[3, hand.join('|'), pick]] });
  }
  const result = aggregateDefense(reports);
  const row = id => result.cards.find(card => card.id === id);
  assert.equal(row('crit').offered, 200);
  assert.ok(Math.abs(row('crit').pickRate - 1 / 3) < 0.02);
  assert.ok(row('crit').lift > 2);
  assert.ok(row('miner').lift < 0);
  assert.equal(row('awaken').lift, null, '표본 없음');
  assert.equal(result.cards.length, DEFENSE_CARDS.length);
});

test('아이템 집계: 먹은 판과 안 먹은 판의 승률 차이(같은 난이도끼리)', () => {
  const reports = [];
  for (let index = 0; index < 120; index++) {
    const took = index % 2 === 0;
    reports.push({ v: 1, l: 2, s: 90, cpm: 200, win: took ? (index % 4 === 0 ? 1 : 1) : (index % 4 === 1 ? 1 : 0), it: took ? { 'powerbank:epic': [1, 0] } : {} });
  }
  const result = aggregateItems('battery', reports);
  const row = result.items.find(item => item.item === 'powerbank' && item.rarity === 'epic');
  assert.ok(row.runs >= MIN_SAMPLES);
  assert.ok(row.winLift > 0.4);
});
