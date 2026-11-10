// 블랙 RGB 화면 키보드: 다음에 칠 키(주황 점)와 필요한 Shift(반대 손), 손가락 구역, 누름 피드백을 보여준다.
// 코드 토큰은 ASCII라 US ANSI 배열을 쓴다.

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

export function createKeyboard(container) {
  if (!container) return createNullKeyboard();
  const keyElements = new Map();
  let nextKeyIds = [];
  let offset = 0;

  const board = document.createElement('div');
  board.className = 'keyboard';
  LAYOUT.forEach((row, rowIndex) => {
    const rowElement = document.createElement('div');
    rowElement.className = 'kb-row';
    offset = 0;
    for (const [base, shifted, finger, width = 1] of row) {
      const key = document.createElement('div');
      key.className = `key${base.length > 1 ? ' wide' : ''}${HOME_KEYS.has(base) ? ' home' : ''}`;
      key.dataset.key = base;
      key.style.setProperty('--w', width);
      // RGB 웨이브: 키의 가로 위치로 색상 위상을 정해 무지개가 왼쪽에서 오른쪽으로 흐르게 한다.
      key.style.setProperty('--hue', String(Math.round((offset + width / 2) * 22 + rowIndex * 14) % 360));
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
      offset += width;
    }
    board.appendChild(rowElement);
  });
  const fingerHint = document.createElement('div');
  fingerHint.className = 'kb-hint';
  container.replaceChildren(board, fingerHint);

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

  // 실제로 친 글자를 잠깐 초록(맞음)/빨강(틀림)으로 번쩍인다.
  function press(character, correct) {
    const info = describeKey(character);
    if (!info) return;
    const targets = [info.keyId];
    if (info.shift) targets.push(shiftKeyFor(info.finger));
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
  }

  return { setNext, press, setVisible, element: board };
}

function createNullKeyboard() {
  return { setNext() {}, press() {}, setVisible() {}, element: null };
}
