import { test } from 'node:test';
import assert from 'node:assert/strict';

test('단색·비슷한 색 스킨에 색이 흐르는 무늬를 덮어써도 움직임이 보인다(팔레트를 같은 계열 네 색으로 늘리고 채도를 올림)', async () => {
  const { createLedState, expandPalette, isFlatPalette } = await import('../public/js/keyboard-led.js');
  const mono = [[192, 100, 70]];
  assert.equal(expandPalette(mono).length, 4);
  const nearlySame = [[215, 100, 70], [220, 100, 70]];
  assert.ok(isFlatPalette(nearlySame), 'granite처럼 5° 차이 두 색도 단색 취급');
  assert.equal(expandPalette(nearlySame).length, 4);
  assert.equal(isFlatPalette([[7, 100, 70], [34, 100, 70]]), true, '30° 안');
  assert.equal(isFlatPalette([[259, 100, 70], [181, 100, 45]]), false, '충분히 다른 두 색은 그대로');
  assert.deepEqual(expandPalette([[208, 55, 64]])[0], [208, 55, 64], '첫 색은 원래 색');
  assert.ok(expandPalette([[208, 55, 64]]).slice(1).every(([, saturation]) => saturation >= 80), '더한 색은 채도를 올린다');
  assert.equal(expandPalette(mono), expandPalette(mono), '한 번만 만든다');
  assert.equal(expandPalette('rainbow'), 'rainbow');
  const keys = Array.from({ length: 20 }, (_, index) => ({ index, x: index % 15, y: Math.floor(index / 15), mod: false }));
  const led = createLedState(keys);
  const colors = led.frame(3.7, { pattern: 'wave', reactive: 'none', palette: mono, overridden: true }, {}, []);
  const own = createLedState(keys).frame(3.7, { pattern: 'static', reactive: 'none', palette: mono }, {}, []);
  assert.ok(own.every(color => color.h === 192 && color.l === 70), '스킨 원래 무늬는 원래 색 그대로');
  assert.ok(new Set(colors.map(color => `${color.h.toFixed(0)}-${color.l.toFixed(0)}`)).size > 3, '키마다 색이 다르다');
});
