import { test } from 'node:test';
import assert from 'node:assert/strict';
import { QualityGovernor } from '../public/js/game-view.js';

// 프레임을 interval초 간격으로 seconds초 동안 흘린다
function run(governor, start, interval, seconds) {
  let now = start;
  for (let elapsed = 0; elapsed < seconds; elapsed += interval) governor.tick(true, (now += interval));
  return now;
}

test('자동 화질: 느린 프레임이 1.5초 넘게 이어지면 저사양, 빠른 프레임이 4초 넘게 이어지면 되돌림', () => {
  const governor = new QualityGovernor(null);
  const ratios = [];
  governor.surfaces.add({ setMaxRatio: value => ratios.push(value) });
  let now = run(governor, 0, 1 / 60, 3);
  assert.equal(governor.lowFx, false, '60fps면 그대로');
  now = run(governor, now, 0.04, 1);
  assert.equal(governor.lowFx, false, '잠깐 느린 건 참는다');
  now = run(governor, now, 0.04, 2);
  assert.equal(governor.lowFx, true, '25fps가 이어지면 저사양');
  assert.deepEqual(ratios, [1.5]);
  now = run(governor, now, 1 / 60, 3);
  assert.equal(governor.lowFx, true, '금방 되돌리지 않는다');
  now = run(governor, now, 1 / 60, 3);
  assert.equal(governor.lowFx, false);
  assert.deepEqual(ratios, [1.5, 2]);
  now = run(governor, now + 1, 0.04, 3);
  assert.equal(governor.lowFx, true, '두 번째 저사양');
  run(governor, now, 1 / 60, 10);
  assert.equal(governor.lowFx, true, '두 번째부터는 계속 저사양(깜빡임 방지)');
});

test('자동 화질: 탭을 떠났다 온 긴 공백·결과 화면은 세지 않는다', () => {
  const governor = new QualityGovernor(null);
  governor.tick(true, 0);
  governor.tick(true, 30);
  governor.tick(false, 30.5);
  for (let index = 0; index < 200; index++) governor.tick(false, 31 + index * 0.1);
  assert.equal(governor.lowFx, false);
  assert.ok(governor.frameMs < 20);
});
