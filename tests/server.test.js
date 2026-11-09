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
