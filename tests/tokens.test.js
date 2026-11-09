import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LANGUAGES, LANGUAGE_KEYS, TOKEN_KINDS, getTokenPool } from '../public/js/tokens.js';
import { getWeekLabel } from '../public/js/week.js';

test('모든 언어의 토큰은 키보드로 칠 수 있는 ASCII이고, 앞뒤 공백·중복이 없다', () => {
  for (const languageKey of LANGUAGE_KEYS) {
    const pool = getTokenPool(languageKey);
    assert.ok(pool.length >= 40, `${languageKey}: 토큰이 너무 적음 (${pool.length})`);
    const texts = pool.map(token => token.text);
    assert.equal(new Set(texts).size, texts.length, `${languageKey}: 중복 토큰`);
    for (const { text, kind } of pool) {
      assert.match(text, /^[\x21-\x7e](?:[\x20-\x7e]*[\x21-\x7e])?$/, `${languageKey}: '${text}'`);
      assert.ok(TOKEN_KINDS[kind], `${languageKey}: 알 수 없는 종류 ${kind}`);
    }
  }
});

test('언어 메타데이터와 알 수 없는 언어 처리', () => {
  for (const key of LANGUAGE_KEYS) assert.ok(LANGUAGES[key].label && LANGUAGES[key].file);
  assert.throws(() => getTokenPool('cobol'));
});

test('주차 경계: 월요일 00:00 KST에 바뀐다', () => {
  assert.equal(getWeekLabel(Date.UTC(2026, 10, 8, 15, 0)), '2026-W46');
  assert.equal(getWeekLabel(Date.UTC(2026, 10, 8, 14, 59)), '2026-W45');
  assert.equal(getWeekLabel(Date.UTC(2026, 0, 1, 0, 0)), '2026-W01');
  assert.equal(getWeekLabel(Date.UTC(2026, 11, 31, 14, 0)), '2026-W53');
});
