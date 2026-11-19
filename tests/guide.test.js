import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GUIDES } from '../public/js/guide.js';

test('게임 방법: 모든 모드에 목표·튜토리얼·조작·팁이 있고, 마지막 장은 직접 쳐 보기', () => {
  for (const mode of ['practice', 'throw', 'battery', 'rhythm', 'defense']) {
    const guide = GUIDES[mode];
    assert.ok(guide?.goal, mode);
    assert.ok(guide.steps.length >= 4, mode);
    assert.ok(guide.steps.at(-1).practice, mode);
    assert.equal(guide.steps.filter(step => step.practice).length, 1, mode);
    assert.ok(guide.keys.length && guide.tips.length, mode);
  }
});

import { existsSync } from 'node:fs';
import { GUIDE_SHOTS } from '../public/js/guide-shots.js';

test('게임 방법 캡처: 단계가 가리키는 캡처와 이미지 파일이 있고, 상자는 이미지 안에 있다', () => {
  for (const [mode, guide] of Object.entries(GUIDES)) {
    assert.ok(guide.steps.some(step => step.shot === `${mode}-overview`), mode);
    for (const step of guide.steps.filter(step => step.shot)) {
      const shot = GUIDE_SHOTS[step.shot];
      assert.ok(shot, step.shot);
      assert.ok(existsSync(new URL(`../public/art/guide/${step.shot}.webp`, import.meta.url)), step.shot);
      for (const mark of shot.marks) {
        assert.ok(mark.x > -3 && mark.y > -3 && mark.x + mark.w < 103 && mark.y + mark.h < 103, `${step.shot} ${mark.label}`);
      }
    }
  }
});
