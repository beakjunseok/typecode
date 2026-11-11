import { test } from 'node:test';
import assert from 'node:assert/strict';
import { throwPose, chargePose, THROW_TIMING } from '../public/js/developer-view.js';

const close = (actual, expected, message) => assert.ok(Math.abs(actual - expected) < 1e-9, `${message}: ${actual} ≠ ${expected}`);

test('장전: 낱말을 칠수록 팔꿈치를 들고 휴대폰을 귀 뒤로 넘긴다(단조 증가)', () => {
  let previous = chargePose(0);
  for (let step = 1; step <= 10; step++) {
    const pose = chargePose(step / 10);
    assert.ok(pose.upper >= previous.upper, `위팔 ${step / 10}`);
    assert.ok(pose.bend >= previous.bend, `아래팔 접힘 ${step / 10}`);
    assert.ok(pose.twist >= previous.twist, `어깨 비틀기 ${step / 10}`);
    previous = pose;
  }
  assert.ok(chargePose(1).bend > 2, '아래팔을 머리 쪽으로 깊게 접는다');
  assert.ok(chargePose(1).lean < 0, '몸을 뒤로 젖힌다');
  assert.equal(chargePose(1).twist, 1, '오른어깨가 뒤로');
  assert.equal(chargePose(0).twist, 0);
});

test('던지기: 장전 자세에서 시작해 이어지고(끊김 없음), RELEASE 시점에 손을 떠난다', () => {
  const start = throwPose({ charge: 0, sinceThrow: 0 });
  close(start.upper, chargePose(1).upper, '던진 순간 = 장전 끝 자세');
  close(start.bend, chargePose(1).bend, '던진 순간 아래팔도 장전 끝');
  assert.equal(start.held, 1, '아직 손에 있음');
  assert.equal(start.released, false);
  const justBefore = throwPose({ charge: 0, sinceThrow: THROW_TIMING.release - 1e-6 });
  const justAfter = throwPose({ charge: 0, sinceThrow: THROW_TIMING.release + 1e-6 });
  for (const joint of ['upper', 'bend', 'lean', 'twist']) {
    assert.ok(Math.abs(justBefore[joint] - justAfter[joint]) < 1e-3, `RELEASE 앞뒤로 ${joint}가 이어진다`);
  }
  assert.equal(justAfter.held, 0, '놓은 뒤 빈손');
  assert.equal(justAfter.released, true);
});

test('운동 사슬: 몸통이 먼저 돌고 아래팔은 늦게 출발해 마지막에 펴진다', () => {
  const quarter = throwPose({ charge: 0, sinceThrow: THROW_TIMING.release * 0.25 });
  const start = throwPose({ charge: 0, sinceThrow: 0 });
  const end = throwPose({ charge: 0, sinceThrow: THROW_TIMING.release - 1e-9 });
  const share = joint => (quarter[joint] - start[joint]) / (end[joint] - start[joint]);
  assert.ok(share('twist') > share('upper'), `몸통(${share('twist')}) > 위팔(${share('upper')})`);
  assert.ok(share('upper') > share('bend'), `위팔(${share('upper')}) > 아래팔(${share('bend')})`);
});

test('따라 휘두르기: 놓은 뒤에도 앞으로 넘어가 몸 뒤로 숨었다가 준비 자세로 돌아온다', () => {
  const release = throwPose({ charge: 0, sinceThrow: THROW_TIMING.release });
  const follow = throwPose({ charge: 0, sinceThrow: THROW_TIMING.follow });
  assert.ok(follow.upper < release.upper, '놓은 뒤에도 계속 앞으로');
  assert.ok(follow.lean > 0, '상체가 앞으로');
  assert.equal(release.front, 1, '놓는 순간엔 팔이 보인다');
  assert.equal(follow.front, 0, '몸 앞을 가로지르는 동안 몸 뒤에 그린다');
  assert.equal(throwPose({ charge: 0, sinceThrow: (THROW_TIMING.follow + THROW_TIMING.low) / 2 }).front, 0, '몸 뒤로 돌아 내려오는 중');
  assert.equal(throwPose({ charge: 0, sinceThrow: THROW_TIMING.low + 0.01 }).front, 1, '몸 옆으로 나와 다시 보인다');
  const almost = throwPose({ charge: 0, sinceThrow: THROW_TIMING.recover - 1e-6 });
  close(Math.round(almost.upper * 1e4) / 1e4, Math.round(chargePose(0).upper * 1e4) / 1e4, '복귀 직전 ≈ 준비 자세');
  assert.equal(almost.front, 1, '복귀 끝엔 다시 앞');
  const done = throwPose({ charge: 0, sinceThrow: THROW_TIMING.recover + 0.1 });
  close(done.upper, chargePose(0).upper, '복귀 후 준비 자세');
  assert.equal(done.held, 1, '새 휴대폰을 든다');
});

test('복귀 경로는 머리 위를 가로지르지 않는다: 팔이 보이는 동안 위팔은 늘 정면 위보다 오른쪽', () => {
  const straightUp = -Math.PI / 2;
  for (let time = THROW_TIMING.follow; time < THROW_TIMING.recover; time += 0.005) {
    const pose = throwPose({ charge: 0, sinceThrow: time });
    if (pose.front === 0) continue;
    const absolute = straightUp + pose.upper;
    const wrapped = Math.atan2(Math.sin(absolute), Math.cos(absolute));
    assert.ok(wrapped >= straightUp, `${time.toFixed(3)}s 위팔 ${wrapped.toFixed(2)}rad가 머리 쪽(왼쪽)으로 넘어감`);
  }
});

test('복귀 중 다음 낱말을 치기 시작하면 그 장전 자세로 돌아간다', () => {
  const resting = throwPose({ charge: 0.5, sinceThrow: THROW_TIMING.recover + 0.01 });
  close(resting.upper, chargePose(0.5).upper, '장전 0.5 자세');
  const newPhone = throwPose({ charge: 0, sinceThrow: THROW_TIMING.newPhone + THROW_TIMING.newPhonePop / 2 });
  assert.ok(newPhone.held > 0 && newPhone.held < 1.2, `새 휴대폰이 튀어나오는 중 ${newPhone.held}`);
  assert.ok(THROW_TIMING.newPhone >= THROW_TIMING.follow && THROW_TIMING.newPhone <= THROW_TIMING.low, '새 휴대폰은 팔이 몸 옆으로 내려왔을 때 생긴다');
  assert.equal(throwPose({ charge: 0, sinceThrow: -Infinity }).held, 1, '아직 안 던졌으면 손에 있음');
});
