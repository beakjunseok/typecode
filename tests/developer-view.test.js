import { test } from 'node:test';
import assert from 'node:assert/strict';
import { throwPose, chargePose, THROW_TIMING } from '../public/js/developer-view.js';

const close = (actual, expected, message) => assert.ok(Math.abs(actual - expected) < 1e-9, `${message}: ${actual} ≠ ${expected}`);

test('장전: 낱말을 칠수록 팔을 뒤로 더 당긴다(단조 증가)', () => {
  let previous = chargePose(0).upper;
  for (let step = 1; step <= 10; step++) {
    const pose = chargePose(step / 10);
    assert.ok(pose.upper >= previous, `charge ${step / 10}`);
    previous = pose.upper;
  }
  assert.ok(chargePose(1).bend < 0 && chargePose(0).bend > 0, '아래팔을 반대로 접어 휴대폰을 머리 뒤로 넘긴다');
  let previousBend = chargePose(0).bend;
  for (let step = 1; step <= 10; step++) {
    assert.ok(chargePose(step / 10).bend <= previousBend, `bend ${step / 10}`);
    previousBend = chargePose(step / 10).bend;
  }
  assert.ok(chargePose(1).lean < 0, '몸을 뒤로 젖힌다');
});

test('던지기: 장전 자세에서 시작해 이어지고(끊김 없음), RELEASE 시점에 손을 떠난다', () => {
  const start = throwPose({ charge: 0, sinceThrow: 0 });
  close(start.upper, chargePose(1).upper, '던진 순간 = 장전 끝 자세');
  assert.equal(start.held, 1, '아직 손에 있음');
  assert.equal(start.released, false);
  const justBefore = throwPose({ charge: 0, sinceThrow: THROW_TIMING.release - 1e-6 });
  const justAfter = throwPose({ charge: 0, sinceThrow: THROW_TIMING.release + 1e-6 });
  assert.ok(Math.abs(justBefore.upper - justAfter.upper) < 1e-3, 'RELEASE 앞뒤로 자세가 이어진다');
  assert.equal(justAfter.held, 0, '놓은 뒤 빈손');
  assert.equal(justAfter.released, true);
});

test('따라 휘두르기: 목표 방향을 지나 앞으로 넘어갔다가 준비 자세로 돌아온다', () => {
  const follow = throwPose({ charge: 0, sinceThrow: THROW_TIMING.follow });
  assert.ok(follow.upper < throwPose({ charge: 0, sinceThrow: THROW_TIMING.release }).upper, '놓은 뒤에도 계속 앞으로');
  assert.ok(follow.lean > 0, '상체가 앞으로');
  const almost = throwPose({ charge: 0, sinceThrow: THROW_TIMING.recover - 1e-6 });
  close(Math.round(almost.upper * 1e4) / 1e4, Math.round(chargePose(0).upper * 1e4) / 1e4, '복귀 직전 ≈ 준비 자세');
  const done = throwPose({ charge: 0, sinceThrow: THROW_TIMING.recover + 0.1 });
  close(done.upper, chargePose(0).upper, '복귀 후 준비 자세');
  assert.equal(done.held, 1, '새 휴대폰을 든다');
});

test('복귀 중 다음 낱말을 치기 시작하면 그 장전 자세로 돌아간다', () => {
  const resting = throwPose({ charge: 0.5, sinceThrow: THROW_TIMING.recover + 0.01 });
  close(resting.upper, chargePose(0.5).upper, '장전 0.5 자세');
  const newPhone = throwPose({ charge: 0, sinceThrow: THROW_TIMING.newPhone + THROW_TIMING.newPhonePop / 2 });
  assert.ok(newPhone.held > 0 && newPhone.held < 1.2, `새 휴대폰이 튀어나오는 중 ${newPhone.held}`);
  assert.equal(throwPose({ charge: 0, sinceThrow: -Infinity }).held, 1, '아직 안 던졌으면 손에 있음');
});
