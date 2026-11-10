import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createInputDiffer, INPUT_SENTINEL } from '../public/js/input.js';

function setup() {
  const log = [];
  const differ = createInputDiffer({
    onCharacter: character => log.push(character),
    onBackspace: () => log.push('⌫'),
    onIgnored: character => log.push(`?${character}`)
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

test('한글 조합은 게임에 반영하지 않고, 지워도 Backspace로 세지 않는다', () => {
  const { differ, log } = setup();
  differ.sync(' ㅎ');
  differ.sync(' 하');
  differ.sync(' 한');
  differ.sync(' ');
  assert.deepEqual(log, ['?ㅎ', '?하', '?한']);
});

test('스와이프로 여러 글자가 한 번에 들어와도 순서대로', () => {
  const { differ, log } = setup();
  differ.sync(' const');
  assert.deepEqual(log, ['c', 'o', 'n', 's', 't']);
});
