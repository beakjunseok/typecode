import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { LANGUAGES, LANGUAGE_KEYS, TOKEN_KINDS, KIND_WEIGHTS, getTokenPool } from '../public/js/tokens.js';
import { TypingEngine } from '../public/js/engine.js';
import { getWeekLabel } from '../public/js/week.js';
import { buildAll, renderModule, grammarsInstalled, OUTPUT_PATH } from '../scripts/generate-tokens.mjs';

test('12개 언어, 모든 토큰은 키보드로 칠 수 있는 ASCII이고 앞뒤 공백·중복이 없다', () => {
  assert.equal(LANGUAGE_KEYS.length, 12);
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

test('모든 언어에 키워드와 tree-sitter 연산자가 있다', () => {
  for (const languageKey of LANGUAGE_KEYS) {
    const { groups } = LANGUAGES[languageKey];
    assert.ok(groups.keyword?.length >= 20, `${languageKey}: keyword ${groups.keyword?.length}`);
    assert.ok(groups.operator?.length >= 5, `${languageKey}: operator ${groups.operator?.length}`);
  }
});

test('제외 목록이 반영됐다 (미사용 예약어·문법 조각·주석 기호)', () => {
  const keywords = key => new Set(LANGUAGES[key].groups.keyword);
  for (const word of ['become', 'box', 'expr', 'tt']) assert.ok(!keywords('rust').has(word), `rust: ${word}`);
  assert.ok(keywords('rust').has('mut') && keywords('rust').has('crate'));
  assert.ok(!keywords('c').has('fortran'));
  assert.ok(!keywords('swift').has('canImport'));
  assert.ok(keywords('swift').has('guard') && keywords('swift').has('defer'));
  assert.ok(!LANGUAGES.javascript.groups.operator.includes('//'));
  assert.ok(LANGUAGES.python.groups.operator.includes('//'), '파이썬 // 는 정수 나눗셈');
  assert.ok(LANGUAGES.sql.groups.keyword.every(text => text === text.toUpperCase()));
});

test('종류별 출제 비율: 가중치 합은 1, 종류 몫은 설정 비율에 비례', () => {
  for (const languageKey of LANGUAGE_KEYS) {
    const pool = getTokenPool(languageKey);
    const total = pool.reduce((sum, token) => sum + token.weight, 0);
    assert.ok(Math.abs(total - 1) < 1e-9, `${languageKey}: 합 ${total}`);
    const share = kind => pool.filter(token => token.kind === kind).reduce((sum, token) => sum + token.weight, 0);
    const ratio = share('keyword') / share('operator');
    assert.ok(Math.abs(ratio - KIND_WEIGHTS.keyword / KIND_WEIGHTS.operator) < 1e-9, `${languageKey}: ${ratio}`);
  }
});

test('엔진은 가중치대로 뽑는다 (SQL: 키워드 159개여도 출제 비율은 고정)', () => {
  let seed = 7;
  const random = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
  const pool = getTokenPool('sql');
  const engine = new TypingEngine({ tokenPool: pool, durationSeconds: 30, random });
  const counts = {};
  const draws = 40000;
  for (let index = 0; index < draws; index++) {
    const token = engine.drawWeightedToken();
    counts[token.kind] = (counts[token.kind] ?? 0) + 1;
  }
  const expected = kind => pool.filter(token => token.kind === kind).reduce((sum, token) => sum + token.weight, 0);
  for (const kind of Object.keys(counts)) {
    assert.ok(Math.abs(counts[kind] / draws - expected(kind)) < 0.015, `${kind}: ${counts[kind] / draws} vs ${expected(kind)}`);
  }
});

test('tokens.generated.js가 소스 설정과 일치한다 (문법 소스가 설치된 경우)', { skip: !grammarsInstalled() && 'npm run grammars 미실행' }, () => {
  assert.equal(readFileSync(OUTPUT_PATH, 'utf8'), renderModule(buildAll()), '`npm run tokens`로 다시 생성하세요');
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
