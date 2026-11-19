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
