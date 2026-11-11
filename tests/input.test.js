import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createInputDiffer, INPUT_SENTINEL } from '../public/js/input.js';

function setup() {
  const log = [];
  const differ = createInputDiffer({
    onCharacter: character => log.push(character),
    onBackspace: () => log.push('⌫'),
    onIgnored: character => log.push(`?${character}`),
    onEnter: () => log.push('↵')
  });
  return { differ, log };
}

test('일반 입력: 한 글자씩', () => {
  const { differ, log } = setup();
  differ.sync(`${INPUT_SENTINEL}a`);
  differ.reset();
  differ.sync(`${INPUT_SENTINEL}b`);
  assert.deepEqual(log, ['a', 'b']);
});

test('모바일 조합 입력(Gboard 영어 자동완성): h → he → hel 은 글자 3개', () => {
  const { differ, log } = setup();
  differ.sync(' h');
  differ.sync(' he');
  differ.sync(' hel');
  assert.deepEqual(log, ['h', 'e', 'l']);
});

test('조합 중 지우기: hel → he 는 Backspace 1번', () => {
  const { differ, log } = setup();
  differ.sync(' hel');
  differ.sync(' he');
  assert.deepEqual(log, ['h', 'e', 'l', '⌫']);
});

test('입력칸을 센티널로 되돌린 뒤의 모바일 Backspace(센티널 삭제)는 게임 글자 하나 지우기', () => {
  const { differ, log } = setup();
  differ.sync(' a');
  differ.reset();
  differ.sync('');
  assert.deepEqual(log, ['a', '⌫']);
});

test('자동수정이 단어를 통째로 바꾸면 지운 만큼 Backspace 후 새 글자', () => {
  const { differ, log } = setup();
  differ.sync(' teh');
  differ.sync(' the');
  assert.deepEqual(log, ['t', 'e', 'h', '⌫', '⌫', 'h', 'e']);
});

test('한글 모드 두벌식 입력은 같은 자리 영문 키로 바뀐다: ㅇㄷㄹ며ㅣㅅ → default', () => {
  const { differ, log } = setup();
  // 실제 IME 조합 순서: ㄹ+ㅁ이 ㄻ으로 묶였다가 모음이 오면 ㄹ + 며로 갈라진다
  for (const step of [' ㅇ', ' ㅇㄷ', ' ㅇㄷㄹ', ' ㅇㄷㄻ', ' ㅇㄷㄹ며', ' ㅇㄷㄹ며ㅣ', ' ㅇㄷㄹ며ㅣㅅ']) differ.sync(step);
  assert.deepEqual(log, [...'default']);
});

test('조합 중 받침이 다음 글자로 넘어가도(한 → 하나) 키 순서가 유지된다', () => {
  const { differ, log } = setup();
  differ.sync(' ㅎ');
  differ.sync(' 하');
  differ.sync(' 한');
  differ.sync(' 하나');
  assert.deepEqual(log, ['g', 'k', 's', 'k']);
});

test('자판 매핑이 없는 글자(이모지 등)는 무시하고 경고만', () => {
  const { differ, log } = setup();
  differ.sync(' 😀');
  assert.deepEqual(log, ['?😀']);
});

test('스와이프로 여러 글자가 한 번에 들어와도 순서대로', () => {
  const { differ, log } = setup();
  differ.sync(' const');
  assert.deepEqual(log, ['c', 'o', 'n', 's', 't']);
});

test('모바일 Enter(줄바꿈 문자)는 onEnter로, 지워져도 Backspace로 세지 않는다', () => {
  const { differ, log } = setup();
  differ.sync(' ab');
  differ.sync(' ab\n');
  differ.sync(' ab');
  assert.deepEqual(log, ['a', 'b', '↵']);
  differ.reset();
  differ.sync(' \r\n');
  assert.deepEqual(log, ['a', 'b', '↵', '↵', '↵']);
});
