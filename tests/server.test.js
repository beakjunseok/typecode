import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.BLOB_READ_WRITE_TOKEN ??= 'vercel_blob_rw_test_dummy';
const lib = await import('../api/_lib.js');
const sessionRoute = await import('../api/session.js');
const scoresRoute = await import('../api/scores.js');

const post = (body, raw) => new Request('http://localhost/api', { method: 'POST', body: raw ?? JSON.stringify(body) });

test('세션 토큰: 정상 검증, 위조·형식 오류는 401', () => {
  const { token, session } = lib.issueSessionToken({ language: 'go', durationSeconds: 30 });
  assert.equal(lib.verifySessionToken(token).sid, session.sid);
  const [, signature] = token.split('.');
  const forgedPayload = Buffer.from(JSON.stringify({ ...session, durationSeconds: 120 })).toString('base64url');
  assert.throws(() => lib.verifySessionToken(`${forgedPayload}.${signature}`), error => error.status === 401);
  assert.throws(() => lib.verifySessionToken('garbage'), error => error.status === 401);
  assert.throws(() => lib.verifySessionToken(undefined), error => error.status === 401);
});

test('제출 검증: 시간·속도·점수 상한, 서버가 WPM·정확도 재계산', () => {
  const { session } = lib.issueSessionToken({ language: 'go', durationSeconds: 30 });
  const base = { correctKeystrokes: 200, wrongKeystrokes: 10, score: 3000, maxCombo: 12 };
  const verified = lib.validateSubmission(session, base, session.startedAt + 31000);
  assert.equal(verified.wpm, 80);
  assert.equal(verified.accuracy, 95.2);
  const at = session.startedAt + 31000;
  assert.throws(() => lib.validateSubmission(session, base, session.startedAt + 10000), error => error.code === 'too_early');
  assert.throws(() => lib.validateSubmission(session, base, session.startedAt + 30000 + 11 * 60000), error => error.code === 'session_expired');
  assert.throws(() => lib.validateSubmission(session, { ...base, correctKeystrokes: 9999, score: 1 }, at), error => error.code === 'implausible_speed');
  assert.throws(() => lib.validateSubmission(session, { ...base, score: 4001 }, at), error => error.code === 'implausible_score');
  assert.throws(() => lib.validateSubmission(session, { ...base, score: -1 }, at), error => error.status === 422);
  assert.throws(() => lib.validateSubmission(session, { ...base, score: '3000' }, at), error => error.status === 422);
});

test('랭킹: 점수 내림차순, 동점은 먼저 달성, 세션당 1건', () => {
  const ranked = lib.rankEntries([
    { sid: 'a', score: 100, achievedAt: 5 }, { sid: 'b', score: 200, achievedAt: 9 },
    { sid: 'c', score: 200, achievedAt: 3 }, { sid: 'a', score: 999, achievedAt: 7 }
  ]);
  assert.deepEqual(ranked.map(entry => entry.sid), ['c', 'b', 'a']);
  assert.equal(ranked[2].score, 100);
});

test('이름 정리', () => {
  assert.equal(lib.sanitizeName('  <b>홍길동</b>\u0007  '), 'b홍길동/b');
  assert.equal(lib.sanitizeName(''), 'anonymous');
  assert.equal(lib.sanitizeName('a'.repeat(40)).length, 16);
});

test('API 상태 코드: 200 / 400 / 401 / 422', async () => {
  const response = await sessionRoute.POST(post({ language: 'rust', durationSeconds: 60 }));
  assert.equal(response.status, 200);
  const { token } = await response.json();
  assert.equal((await sessionRoute.POST(post({ language: 'cobol', durationSeconds: 60 }))).status, 422);
  assert.equal((await sessionRoute.POST(post({ language: 'go', durationSeconds: 45 }))).status, 422);
  assert.equal((await sessionRoute.POST(post(null, '{bad'))).status, 400);
  assert.equal((await scoresRoute.POST(post({ token: 'x.y', score: 1 }))).status, 401);
  const early = await scoresRoute.POST(post({ token, correctKeystrokes: 10, wrongKeystrokes: 0, score: 100, maxCombo: 1 }));
  assert.equal(early.status, 422);
  assert.equal((await early.json()).error, 'too_early');
});

test('아케이드 모드 세션: 시간 제한 없음, 모드가 토큰에 서명된다', async () => {
  for (const mode of ['throw', 'battery']) {
    const response = await sessionRoute.POST(post({ mode, language: 'go' }));
    assert.equal(response.status, 200);
    const { token } = await response.json();
    const session = lib.verifySessionToken(token);
    assert.equal(session.mode, mode);
    assert.equal(session.durationSeconds, null);
  }
  assert.equal((await sessionRoute.POST(post({ mode: 'snake', language: 'go' }))).status, 422);
  assert.equal((await sessionRoute.POST(post({ language: 'go' }))).status, 422, 'practice는 시간 필수');
});

test('아케이드 제출 검증: 생존 시간은 서버 경과 시간 이하, 모드별 점수 상한', () => {
  const { session } = lib.issueSessionToken({ mode: 'throw', language: 'go' });
  const base = { correctKeystrokes: 300, wrongKeystrokes: 20, score: 300 * 90, maxCombo: 20, survivedSeconds: 60 };
  const ok = lib.validateSubmission(session, base, session.startedAt + 62_000);
  assert.equal(ok.survivedSeconds, 60);
  assert.equal(ok.wpm, 60);
  assert.throws(() => lib.validateSubmission(session, base, session.startedAt + 30_000), error => error.code === 'too_early');
  assert.throws(() => lib.validateSubmission(session, { ...base, survivedSeconds: 2 }, session.startedAt + 62_000), error => error.code === 'invalid_survived_seconds');
  assert.throws(() => lib.validateSubmission(session, { ...base, survivedSeconds: undefined }, session.startedAt + 62_000), error => error.status === 422);
  assert.throws(() => lib.validateSubmission(session, { ...base, score: 300 * 96 }, session.startedAt + 62_000), error => error.code === 'implausible_score');

  const battery = lib.issueSessionToken({ mode: 'battery', language: 'go' }).session;
  assert.throws(() => lib.validateSubmission(battery, { ...base, score: 300 * 36 }, battery.startedAt + 62_000), error => error.code === 'implausible_score');
  assert.ok(lib.validateSubmission(battery, { ...base, score: 300 * 35 }, battery.startedAt + 62_000));
  assert.throws(() => lib.resolveMode('rescue'), error => error.status === 422, '옛 모드 이름은 더 이상 없음');
});

test('모드 검증: 알 수 없는 모드는 422, 예전 토큰(mode 없음)은 practice', () => {
  assert.equal(lib.resolveMode(undefined), 'practice');
  assert.throws(() => lib.resolveMode('chess'), error => error.status === 422);
  assert.throws(() => lib.resolveMode('__proto__'), error => error.status === 422);
});
