import { test } from 'node:test';
import assert from 'node:assert/strict';
process.env.BLOB_READ_WRITE_TOKEN ??= 'vercel_blob_rw_test_dummy';
const { createRoomRoutes, createMemoryRoomStorage, normalizeRoomCode, ROOM_TTL_MS, ROOM_CODE_ALPHABET } = await import('../api/_rooms.js');

const OFFER = { type: 'offer', sdp: 'v=0\r\no=- 1 2 IN IP4 127.0.0.1\r\n' };
const ANSWER = { type: 'answer', sdp: 'v=0\r\no=- 3 4 IN IP4 127.0.0.1\r\n' };

function setup() {
  const clock = { now: 1_000_000 };
  const storage = createMemoryRoomStorage({ now: () => clock.now });
  const routes = createRoomRoutes(storage, { now: () => clock.now });
  const post = body => routes.POST(new Request('http://x/api/room', { method: 'POST', body: JSON.stringify(body) }));
  const get = query => routes.GET(new Request(`http://x/api/room?${new URLSearchParams(query)}`));
  return { clock, storage, post, get };
}

test('방 만들기 → 손님이 offer 받기 → answer 보내기 → 방장이 answer 받기', async () => {
  const { post, get } = setup();
  const created = await (await post({ action: 'create', offer: OFFER, name: '방장', settings: { language: 'python', level: 3 } })).json();
  assert.match(created.code, new RegExp(`^[${ROOM_CODE_ALPHABET}]{4}$`));
  assert.equal(typeof created.key, 'string');

  const joined = await (await get({ code: created.code.toLowerCase() })).json();
  assert.deepEqual(joined.offer, OFFER, '소문자 코드도 허용');
  assert.equal(joined.hostName, '방장');
  assert.deepEqual(joined.settings, { language: 'python', level: 3 });

  const waiting = await (await get({ code: created.code, key: created.key })).json();
  assert.equal(waiting.answer, null, '아직 손님 없음');

  assert.equal((await post({ action: 'answer', code: created.code, answer: ANSWER, name: '손님' })).status, 200);
  const answered = await (await get({ code: created.code, key: created.key })).json();
  assert.deepEqual(answered.answer, ANSWER);
  assert.equal(answered.guestName, '손님');
});

test('두 번째 손님은 409, 방장 키가 틀리면 403, 없는 코드는 404, 형식 오류는 422', async () => {
  const { post, get } = setup();
  const { code, key } = await (await post({ action: 'create', offer: OFFER })).json();
  await post({ action: 'answer', code, answer: ANSWER });
  assert.equal((await post({ action: 'answer', code, answer: ANSWER })).status, 409);
  assert.equal((await get({ code })).status, 409, '찬 방은 offer도 안 줌');
  assert.equal((await get({ code, key: `${key}x` })).status, 403);
  const missing = ROOM_CODE_ALPHABET.slice(0, 4) === code ? ROOM_CODE_ALPHABET.slice(1, 5) : ROOM_CODE_ALPHABET.slice(0, 4);
  assert.equal((await get({ code: missing })).status, 404);
  assert.equal((await get({ code: 'AB1' })).status, 422);
  assert.equal((await get({ code: 'ABI0' })).status, 422, '헷갈리는 글자 제외');
  assert.equal((await post({ action: 'create', offer: { type: 'offer', sdp: 'hello' } })).status, 422);
  assert.equal((await post({ action: 'create', offer: { type: 'answer', sdp: 'v=0' } })).status, 422);
  assert.equal((await post({ action: 'create', offer: { type: 'offer', sdp: `v=0${'a'.repeat(20_000)}` } })).status, 422, '크기 상한');
  assert.equal((await post({ action: 'dance' })).status, 400);
});

test('10분이 지난 방은 만료(404)', async () => {
  const { clock, post, get } = setup();
  const { code } = await (await post({ action: 'create', offer: OFFER })).json();
  clock.now += ROOM_TTL_MS + 1;
  assert.equal((await get({ code })).status, 404);
  assert.equal((await post({ action: 'answer', code, answer: ANSWER })).status, 404);
});

test('이름은 정리되고 설정은 허용 값만', async () => {
  const { post, get } = setup();
  const { code } = await (await post({ action: 'create', offer: OFFER, name: '<b>x</b>', settings: { language: 'cobol', level: 9 } })).json();
  const joined = await (await get({ code })).json();
  assert.equal(joined.hostName, 'bx/b');
  assert.deepEqual(joined.settings, { language: 'javascript', level: 2 });
  assert.equal(normalizeRoomCode(' ab2c '), 'AB2C');
});
