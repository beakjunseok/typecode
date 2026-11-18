import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createKeyfitRoutes, mergeChanges } from '../api/_keyfit.js';

// 메모리 저장소: 올린 순서대로 시각을 늘려 '최신'을 가린다
function memoryStorage() {
  const files = new Map();
  let clock = 0, counter = 0;
  return {
    files,
    async putJson(prefix, data) {
      const pathname = `${prefix}${++counter}.json`;
      files.set(pathname, { pathname, url: `mem://${pathname}`, uploadedAt: ++clock, data: JSON.parse(JSON.stringify(data)) });
    },
    async list(prefix) {
      return [...files.values()].filter(file => file.pathname.startsWith(prefix)).map(({ pathname, url, uploadedAt }) => ({ pathname, url, uploadedAt }));
    },
    async readJson(file) {
      return [...files.values()].find(entry => entry.url === file.url).data;
    },
    async remove(urls) {
      for (const [pathname, file] of files) if (urls.includes(file.url)) files.delete(pathname);
    }
  };
}

const post = (routes, body) => routes.POST(new Request('http://x/api/keyfit', { method: 'POST', body: JSON.stringify(body) }));

test('키 위치 저장: 처음 비밀번호를 정하고, 틀리면 거절, 맞으면 합쳐 저장하고 GET으로 받는다', async () => {
  const storage = memoryStorage();
  const routes = createKeyfitRoutes(storage);
  const first = await post(routes, { password: 'abcd', changes: { 'teal-pulse': { keys: { Enter: [0.8, 0.44, 0.12, 0.12] } } } });
  assert.equal(first.status, 200);
  assert.equal((await first.json()).created, true, '처음 저장이 비밀번호를 정한다');
  const wrong = await post(routes, { password: 'zzzz', changes: { 'teal-pulse': { keys: { Enter: [0.1, 0.1, 0.1, 0.1] } } } });
  assert.equal(wrong.status, 401);
  const second = await post(routes, { password: 'abcd', changes: { 'teal-pulse': { legend: { a: '#5FF3FF' } }, 'no-such-skin': { keys: { a: [0, 0, 0.1, 0.1] } } } });
  const secondBody = await second.json();
  assert.equal(secondBody.applied, 1);
  assert.equal(secondBody.skipped, 1);
  const got = await (await routes.GET(new Request('http://x/api/keyfit'))).json();
  assert.deepEqual(got.overrides['teal-pulse'].keys.Enter, [0.8, 0.44, 0.12, 0.12], '앞선 저장이 남는다');
  assert.equal(got.overrides['teal-pulse'].legend.a, '#5ff3ff');
  assert.equal((await storage.list('keyfit/overrides-')).length, 1, '최신 하나만 남긴다');
  const reset = await post(routes, { password: 'abcd', reset: 'teal-pulse' });
  assert.equal(reset.status, 200);
  assert.deepEqual((await (await routes.GET(new Request('http://x/api/keyfit'))).json()).overrides, {}, '스킨 원래대로');
});

test('키 위치 저장: 잘못된 좌표·키·색은 건너뛰고, 넣을 게 없으면 422, 짧은 비밀번호는 거절', async () => {
  const { overrides, applied, skipped } = mergeChanges({}, { 'teal-pulse': { keys: { Enter: [2, 0, 0.1, 0.1], nope: [0, 0, 0.1, 0.1], a: [0.1, 0.1, 0.05, 0.1] }, legend: { a: 'red', s: null } } });
  assert.equal(applied, 2);
  assert.equal(skipped, 3);
  assert.equal(overrides['teal-pulse'].legend.s, null, 'null = 원래 색으로');
  const routes = createKeyfitRoutes(memoryStorage());
  assert.equal((await post(routes, { password: 'ab', changes: {} })).status, 422);
  assert.equal((await post(routes, { password: 'abcd', changes: { 'teal-pulse': { keys: { Enter: [5, 5, 5, 5] } } } })).status, 422);
});

test('게임 쪽 덮어쓰기: 좌표·글씨 색을 SKIN_BOARDS 모양에 반영하고 null은 원래 색으로', async () => {
  const { applySkinOverrides } = await import('../public/js/skin-overrides.js');
  const boards = { demo: { keys: { a: [0, 0, 0.1, 0.1], s: [0.1, 0, 0.1, 0.1] }, legendColors: { s: '#000000' } } };
  const applied = applySkinOverrides({ demo: { keys: { a: [0.2, 0.2, 0.1, 0.1], zz: [0, 0, 1, 1] }, legend: { a: '#ffffff', s: null } }, nope: { keys: {} } }, boards);
  assert.equal(applied, 3);
  assert.deepEqual(boards.demo.keys.a, [0.2, 0.2, 0.1, 0.1]);
  assert.equal(boards.demo.legendColors.a, '#ffffff');
  assert.equal('s' in boards.demo.legendColors, false);
});
