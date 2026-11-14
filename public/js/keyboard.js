// 화면 키보드: 다음에 칠 키(주황 점)와 필요한 Shift(반대 손), 손가락 구역, 누름 피드백을 보여준다.
// 스킨(키캡 3단 배색·케이스·소재)과 LED(평상시 무늬 + 터치 반응)를 입힐 수 있다. 코드 토큰은 ASCII라 US ANSI 배열을 쓴다.
import { skinArt } from './skin-art.js';
import { SKIN_BOARDS } from './skin-boards.js';
import { createLedState } from './keyboard-led.js';
import { getSkin, MATERIALS } from './keyboard-skins.js';

const FINGERS = Object.freeze({
  LP: { label: '왼손 새끼', hand: 'left', color: '#ff5c8a' },
  LR: { label: '왼손 약지', hand: 'left', color: '#ffb547' },
  LM: { label: '왼손 중지', hand: 'left', color: '#c3e88d' },
  LI: { label: '왼손 검지', hand: 'left', color: '#36e2ff' },
  RI: { label: '오른손 검지', hand: 'right', color: '#36e2ff' },
  RM: { label: '오른손 중지', hand: 'right', color: '#c3e88d' },
  RR: { label: '오른손 약지', hand: 'right', color: '#ffb547' },
  RP: { label: '오른손 새끼', hand: 'right', color: '#ff5c8a' },
  TH: { label: '엄지', hand: 'both', color: '#c792ea' }
});

// [기본 글자, Shift 글자, 손가락, 너비(1=기본 키)]
const LAYOUT = [
  [['`', '~', 'LP'], ['1', '!', 'LP'], ['2', '@', 'LR'], ['3', '#', 'LM'], ['4', '$', 'LI'], ['5', '%', 'LI'], ['6', '^', 'RI'],
    ['7', '&', 'RI'], ['8', '*', 'RM'], ['9', '(', 'RR'], ['0', ')', 'RP'], ['-', '_', 'RP'], ['=', '+', 'RP'], ['Backspace', null, 'RP', 2]],
  [['Tab', null, 'LP', 1.5], ['q', 'Q', 'LP'], ['w', 'W', 'LR'], ['e', 'E', 'LM'], ['r', 'R', 'LI'], ['t', 'T', 'LI'], ['y', 'Y', 'RI'],
    ['u', 'U', 'RI'], ['i', 'I', 'RM'], ['o', 'O', 'RR'], ['p', 'P', 'RP'], ['[', '{', 'RP'], [']', '}', 'RP'], ['\\', '|', 'RP', 1.5]],
  [['Caps', null, 'LP', 1.75], ['a', 'A', 'LP'], ['s', 'S', 'LR'], ['d', 'D', 'LM'], ['f', 'F', 'LI'], ['g', 'G', 'LI'], ['h', 'H', 'RI'],
    ['j', 'J', 'RI'], ['k', 'K', 'RM'], ['l', 'L', 'RR'], [';', ':', 'RP'], ["'", '"', 'RP'], ['Enter', null, 'RP', 2.25]],
  [['ShiftLeft', null, 'LP', 2.25], ['z', 'Z', 'LP'], ['x', 'X', 'LR'], ['c', 'C', 'LM'], ['v', 'V', 'LI'], ['b', 'B', 'LI'], ['n', 'N', 'RI'],
    ['m', 'M', 'RI'], [',', '<', 'RM'], ['.', '>', 'RR'], ['/', '?', 'RP'], ['ShiftRight', null, 'RP', 2.75]],
  [['Space', null, 'TH', 6.25]]
];

const DISPLAY_NAMES = { Backspace: '⌫ Back', Tab: 'Tab', Caps: 'Caps', Enter: 'Enter', ShiftLeft: 'Shift', ShiftRight: 'Shift', Space: '' };
const HOME_KEYS = new Set(['f', 'j']);
const PRESS_FLASH_MS = 160;

// 글자 → {keyId, shift} 조회표. O(키 수)로 한 번 만든다.
function buildCharacterMap() {
  const map = new Map();
  for (const row of LAYOUT) {
    for (const [base, shifted, finger] of row) {
      if (base.length === 1) {
        map.set(base, { keyId: base, shift: false, finger });
        if (shifted) map.set(shifted, { keyId: base, shift: true, finger });
      }
    }
  }
  map.set(' ', { keyId: 'Space', shift: false, finger: 'TH' });
  return map;
}

const CHARACTER_MAP = buildCharacterMap();

export function describeKey(character) {
  if (character === 'Backspace') return { keyId: 'Backspace', shift: false, finger: 'RP' };
  return CHARACTER_MAP.get(character) ?? null;
}

// 오른손 키의 대문자·기호는 왼쪽 Shift, 왼손 키는 오른쪽 Shift (반대 손 원칙)
export function shiftKeyFor(finger) {
  return FINGERS[finger]?.hand === 'left' ? 'ShiftRight' : 'ShiftLeft';
}

const ACCENT_KEYS = new Set(['Enter', 'Backspace']);
const LED_FRAME_MS = 1000 / 40;
const reducedMotion = () => globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
const ledCss = color => `hsl(${color.h.toFixed(0)} ${color.s.toFixed(0)}% ${color.l.toFixed(0)}%)`;

// options.compact: 미리보기용 작은 키보드(손가락 힌트 없음) / options.interactive: 키를 누르면(클릭·탭) LED 반응
export function createKeyboard(container, { compact = false, interactive = false } = {}) {
  if (!container) return createNullKeyboard();
  const keyElements = new Map();
  const ledKeys = [];
  let nextKeyIds = [];
  let offset = 0;

  const board = document.createElement('div');
  board.className = `keyboard${compact ? ' compact' : ''}`;
  LAYOUT.forEach((row, rowIndex) => {
    const rowElement = document.createElement('div');
    rowElement.className = 'kb-row';
    offset = 0;
    for (const [base, shifted, finger, width = 1] of row) {
      const key = document.createElement('div');
      const role = ACCENT_KEYS.has(base) ? ' accent' : base.length > 1 ? ' mod' : '';
      key.className = `key${base.length > 1 ? ' wide' : ''}${role}${HOME_KEYS.has(base) ? ' home' : ''}`;
      key.dataset.key = base;
      key.style.setProperty('--w', width);
      key.style.setProperty('--finger', FINGERS[finger].color);
      key.title = FINGERS[finger].label;
      const glow = document.createElement('span');
      glow.className = 'glow';
      const legend = document.createElement('span');
      legend.className = 'legend';
      if (shifted && base.length === 1 && shifted.toLowerCase() !== base) {
        const top = document.createElement('span');
        top.className = 'shifted';
        top.textContent = shifted;
        legend.appendChild(top);
      }
      const main = document.createElement('span');
      main.className = 'base';
      main.textContent = DISPLAY_NAMES[base] ?? (base.length === 1 && /[a-z]/.test(base) ? base.toUpperCase() : base);
      legend.appendChild(main);
      key.append(glow, legend);
      rowElement.appendChild(key);
      keyElements.set(base, key);
      // LED 좌표: 키 가운데의 가로 위치(키 단위)와 줄 번호
      key.ledIndex = ledKeys.length;
      ledKeys.push({ index: ledKeys.length, x: offset + width / 2, y: rowIndex, mod: base.length > 1, element: key });
      offset += width;
    }
    board.appendChild(rowElement);
  });
  const fingerHint = document.createElement('div');
  fingerHint.className = 'kb-hint';
  // 떠 있는 키보드 무대: 스킨 카드 그림처럼 떠서 둥실거리고, 뒤로 LED 색 오라가 번진다(.kb-float)
  const floating = document.createElement('div');
  floating.className = 'kb-float';
  // 그림과 맞춘 장식(루비·블랙홀·이진수 파편 등). 스킨별 CSS가 모양을 정한다
  const decoration = document.createElement('div');
  decoration.className = 'kb-deco';
  decoration.setAttribute('aria-hidden', 'true');
  floating.append(decoration, board);
  container.classList.add('kb-stage');
  container.replaceChildren(...(compact ? [floating] : [floating, fingerHint]));

  // ---------- 스킨·LED ----------
  const led = createLedState(ledKeys);
  const colors = [];
  let ledConfig = getSkin(null).led;
  let ledGlow = 1;
  let shine = false;
  let energy = 0;
  let audioSource = null;
  let frameId = 0;
  let lastFrameAt = 0;
  const clock = () => (globalThis.performance?.now() ?? Date.now()) / 1000;

  function paintLeds(time) {
    const audio = ledConfig.pattern.startsWith('audio') ? audioSource?.() : null;
    led.frame(time, ledConfig, { bands: audio?.bands, level: audio?.level, energy }, colors);
    for (const key of ledKeys) {
      const color = colors[key.index];
      const style = key.element.style;
      style.setProperty('--led', ledCss(color));
      style.setProperty('--led-a', (color.a * ledGlow).toFixed(3));
      if (shine) style.setProperty('--led-text', color.a > 0.08 ? ledCss({ ...color, l: Math.max(color.l, 66) }) : '');
    }
    const space = colors[ledKeys.length - 1];
    if (space) {
      board.style.setProperty('--under', ledCss(space));
      board.style.setProperty('--under-a', space.a.toFixed(3));
    }
  }

  function loop(timestamp) {
    frameId = 0;
    if (!board.isConnected || container.hidden) return;
    if (timestamp - lastFrameAt >= LED_FRAME_MS) {
      lastFrameAt = timestamp;
      paintLeds(reducedMotion() ? 0 : clock());
    }
    frameId = globalThis.requestAnimationFrame?.(loop) ?? 0;
  }

  function startLeds() {
    if (frameId || !globalThis.requestAnimationFrame) {
      if (!globalThis.requestAnimationFrame) paintLeds(0);
      return;
    }
    frameId = globalThis.requestAnimationFrame(loop);
  }

  // 무대 꾸미기: 오라 색(LED 팔레트, 무지개면 원뿔 그라데이션), 등급(효과 세기), 카드 그림이 있으면 흐린 배경으로
  function applyStage(skin) {
    const palette = skin.led.palette;
    const aura = palette === 'rainbow'
      ? 'conic-gradient(from 0deg, #ff4d6d, #ffe066, #39ff88, #36e2ff, #a855f7, #ff4d6d)'
      : palette.length > 1
        ? `linear-gradient(120deg, ${palette.map(([hue, saturation, lightness]) => `hsl(${hue} ${saturation}% ${lightness}%)`).join(', ')})`
        : `hsl(${palette[0][0]} ${palette[0][1]}% ${palette[0][2]}%)`;
    floating.style.setProperty('--kb-aura', skin.led.pattern === 'off' ? 'rgba(255, 255, 255, 0.25)' : aura);
    floating.dataset.rarity = skin.rarity;
    floating.dataset.skin = skin.id;
    const art = skinArt(skin.id);
    if (art) container.style.setProperty('--kb-art', `url('${art}')`);
    else container.style.removeProperty('--kb-art');
    container.dataset.rarity = skin.rarity;
    container.dataset.skin = skin.id;
  }

  // 정면 일러스트가 있는 스킨: 그림 한 장을 판으로 깔고, 키마다 같은 그림에서 제 자리만 잘라 보여 준다.
  // 그래서 가만히 있을 땐 그림과 똑같고, 누르면 그 키캡만 내려간다. 좌표는 그림 대비 비율. O(키 수)
  function clearBoardArt() {
    board.classList.remove('art-board');
    board.style.removeProperty('--board');
    board.style.removeProperty('--board-ratio');
    board.style.removeProperty('--board-scale');
    for (const element of keyElements.values()) {
      element.classList.remove('art-light');
      for (const name of ['--kx', '--ky', '--kw', '--kh']) element.style.removeProperty(name);
    }
  }

  function paintBoardArt(art) {
    board.style.setProperty('--board', `url('${art.image}')`);
    board.style.setProperty('--board-ratio', String(art.ratio));
    board.style.setProperty('--board-scale', String(Number(art.scale) > 0 ? art.scale : 1.04));
    const lightKeys = new Set(Array.isArray(art.lightKeys) ? art.lightKeys : []);
    for (const [keyId, element] of keyElements) {
      element.classList.toggle('art-light', lightKeys.has(keyId));
      const box = art.keys[keyId];
      if (!Array.isArray(box) || box.length !== 4) continue;
      const [x, y, w, h] = box;
      element.style.setProperty('--kx', String(x));
      element.style.setProperty('--ky', String(y));
      element.style.setProperty('--kw', String(w));
      element.style.setProperty('--kh', String(h));
    }
    board.classList.add('art-board');
  }

  // 정면 일러스트가 있는 스킨: 그림 한 장을 판으로 깔고, 키마다 같은 그림에서 제 자리만 잘라 보여 준다.
  // 그림을 다 받은 뒤에만 바꾼다. 못 받으면(네트워크·옛 캐시) 키캡이 투명해지지 않게 CSS 키보드를 그대로 둔다. O(키 수)
  let boardArtToken = 0;
  function applyBoardArt(skin) {
    const art = SKIN_BOARDS[skin.id];
    const token = ++boardArtToken;
    clearBoardArt();
    if (!art || typeof Image === 'undefined') return;
    const probe = new Image();
    probe.onload = () => { if (token === boardArtToken) paintBoardArt(art); };
    probe.onerror = () => { if (token === boardArtToken) clearBoardArt(); };
    probe.src = art.image;
  }

  // 스킨(아이디 또는 스킨 객체)을 입힌다. override = { pattern, reactive } 로 LED만 바꿀 수 있다
  function setSkin(skinOrId, override = null) {
    const skin = typeof skinOrId === 'string' || !skinOrId ? getSkin(skinOrId) : skinOrId;
    const material = MATERIALS[skin.material] ?? MATERIALS.pbt;
    const { colors: palette } = skin;
    const style = board.style;
    style.setProperty('--kc-alpha-bg', palette.alphaBg);
    style.setProperty('--kc-alpha-fg', palette.alphaFg);
    style.setProperty('--kc-mod-bg', palette.modBg);
    style.setProperty('--kc-mod-fg', palette.modFg);
    style.setProperty('--kc-accent-bg', palette.accentBg);
    style.setProperty('--kc-accent-fg', palette.accentFg);
    style.setProperty('--case-bg', palette.case);
    board.dataset.material = skin.material;
    board.dataset.rarity = skin.rarity;
    board.dataset.skin = skin.id;
    applyStage(skin);
    applyBoardArt(skin);
    board.classList.toggle('underglow', skin.underglow);
    ledGlow = material.glow;
    shine = Boolean(material.shine);
    board.classList.toggle('shine', shine);
    if (!shine) for (const key of ledKeys) key.element.style.removeProperty('--led-text');
    ledConfig = { ...skin.led, ...(override?.pattern ? { pattern: override.pattern } : {}), ...(override?.reactive ? { reactive: override.reactive } : {}) };
    led.reset();
    paintLeds(clock());
    startLeds();
  }

  function flashLed(keyId, correct) {
    const key = keyElements.get(keyId);
    if (key) led.hit(key.ledIndex, clock(), correct);
  }

  if (interactive) {
    board.addEventListener('pointerdown', event => {
      const key = event.target.closest?.('.key');
      if (!key) return;
      flashLed(key.dataset.key, true);
      key.classList.remove('pressed-ok');
      void key.offsetWidth;
      key.classList.add('pressed-ok');
      setTimeout(() => key.classList.remove('pressed-ok'), PRESS_FLASH_MS);
    });
  }

  // 다음에 칠 글자 표시. null이면 표시 없음. 'Backspace'면 지우기 키.
  function setNext(character) {
    for (const keyId of nextKeyIds) keyElements.get(keyId)?.classList.remove('next', 'next-shift');
    nextKeyIds = [];
    const info = character == null ? null : describeKey(character);
    if (!info) {
      fingerHint.textContent = '';
      return;
    }
    keyElements.get(info.keyId)?.classList.add('next');
    nextKeyIds.push(info.keyId);
    let hint = `${FINGERS[info.finger].label}`;
    if (info.shift) {
      const shiftId = shiftKeyFor(info.finger);
      keyElements.get(shiftId)?.classList.add('next-shift');
      nextKeyIds.push(shiftId);
      hint += ` + ${shiftId === 'ShiftLeft' ? '왼쪽' : '오른쪽'} Shift`;
    }
    fingerHint.textContent = character === 'Backspace' ? '오타를 지우세요 · 오른손 새끼 ⌫' : `다음 키 ${character === ' ' ? 'Space' : character} · ${hint}`;
    fingerHint.style.setProperty('--finger', FINGERS[info.finger].color);
  }

  // 실제로 친 글자를 잠깐 초록(맞음)/빨강(틀림)으로 번쩍이고 LED 터치 반응을 일으킨다
  function press(character, correct) {
    const info = character === 'Enter' ? { keyId: 'Enter', shift: false } : describeKey(character);
    if (!info) return;
    const targets = [info.keyId];
    if (info.shift) targets.push(shiftKeyFor(info.finger));
    flashLed(info.keyId, correct);
    for (const keyId of targets) {
      const key = keyElements.get(keyId);
      if (!key) continue;
      key.classList.remove('pressed-ok', 'pressed-bad');
      void key.offsetWidth;
      key.classList.add(correct ? 'pressed-ok' : 'pressed-bad');
      clearTimeout(key.pressTimer);
      key.pressTimer = setTimeout(() => key.classList.remove('pressed-ok', 'pressed-bad'), PRESS_FLASH_MS);
    }
  }

  function setVisible(visible) {
    container.hidden = !visible;
    if (visible) startLeds();
  }

  // 0~1: 콤보 등. 'energy' LED(전설)는 이 값만큼 빨라지고 밝아진다
  const setEnergy = value => { energy = Math.max(0, Math.min(1, Number(value) || 0)); };
  // () => { bands: number[0~1], level: 0~1 } — 소리 반응 LED가 읽는다
  const setAudioSource = source => { audioSource = typeof source === 'function' ? source : null; };

  setSkin(null);
  return { setNext, press, setVisible, setSkin, setEnergy, setAudioSource, element: board };
}

function createNullKeyboard() {
  return { setNext() {}, press() {}, setVisible() {}, setSkin() {}, setEnergy() {}, setAudioSource() {}, element: null };
}
