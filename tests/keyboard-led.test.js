import { test } from 'node:test';
import assert from 'node:assert/strict';

test('단색 스킨에 색이 흐르는 무늬를 덮어써도 움직임이 보인다(팔레트를 같은 계열 세 색으로 늘림)', async () => {
  const { createLedState, expandPalette } = await import('../public/js/keyboard-led.js');
  const mono = [[192, 100, 70]];
  assert.equal(expandPalette(mono).length, 3);
  assert.equal(expandPalette(mono), expandPalette(mono), '한 번만 만든다');
  assert.equal(expandPalette('rainbow'), 'rainbow');
  const keys = Array.from({ length: 20 }, (_, index) => ({ index, x: index % 15, y: Math.floor(index / 15), mod: false }));
  const led = createLedState(keys);
  const colors = led.frame(3.7, { pattern: 'wave', reactive: 'none', palette: mono }, {}, []);
  assert.ok(new Set(colors.map(color => `${color.h.toFixed(0)}-${color.l.toFixed(0)}`)).size > 3, '키마다 색이 다르다');
});
