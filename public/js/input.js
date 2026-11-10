// 숨은 textarea의 값 변화를 '글자 입력 / 지우기'로 바꾼다.
// 모바일 키보드(Gboard·삼성 키보드)는 영어도 자동완성 때문에 조합(composition) 입력을 쓰고,
// 스와이프 입력·자동수정은 여러 글자를 한꺼번에 바꾼다. 이벤트 종류에 기대지 않고
// '이전 값과 지금 값의 차이'만 보면 모든 입력 방식을 같은 규칙으로 처리할 수 있다.

export const INPUT_SENTINEL = ' ';
const TYPEABLE = /^[\x20-\x7e]$/;

// 두벌식 자판 → 같은 자리 QWERTY 키. 한글 모드로 쳐도 자리가 같으면 영문으로 인식한다(대문자는 Shift 자음·모음만 가능).
const COMPATIBILITY_JAMO_KEYS = 'r R rt s sw sg e E f fr fa fq ft fx fv fg a q Q qt t T d w W c z x v g k o i O j p u P h hk ho hl y n nj np nl b m ml l'.split(' ');
const INITIAL_KEYS = 'r R s e E f a q Q t T d w W c z x v g'.split(' ');
const MEDIAL_KEYS = 'k o i O j p u P h hk ho hl y n nj np nl b m ml l'.split(' ');
const FINAL_KEYS = ' r R rt s sw sg e f fr fa fq ft fx fv fg a q qt t T d w c z x v g'.split(' ');
const SYLLABLE_START = 0xac00;
const SYLLABLE_END = 0xd7a3;
const JAMO_START = 0x3131;
const JAMO_END = 0x3163;

// 한글 글자(완성형·호환 자모)를 자판 키 순서로 풀고 나머지는 그대로 둔다. 문자열 길이 n에 대해 O(n).
// 조합 중 '하' → '한' → '하나'처럼 글자가 바뀌어도 풀어 쓴 키 순서는 앞부분이 유지되므로 접두사 비교가 그대로 통한다.
export function hangulToKeys(value) {
  let keys = '';
  for (const character of value) {
    const code = character.codePointAt(0);
    if (code >= SYLLABLE_START && code <= SYLLABLE_END) {
      const index = code - SYLLABLE_START;
      keys += INITIAL_KEYS[Math.floor(index / 588)] + MEDIAL_KEYS[Math.floor((index % 588) / 28)] + FINAL_KEYS[index % 28];
    } else if (code >= JAMO_START && code <= JAMO_END) {
      keys += COMPATIBILITY_JAMO_KEYS[code - JAMO_START];
    } else {
      keys += character;
    }
  }
  return keys;
}

// onCharacter(ch): 게임에 넘길 ASCII 글자, onBackspace(): 게임에 반영된 글자 하나 지우기,
// onIgnored(ch): 한글 등 게임에서 쓰지 않는 글자(경고용).
// onHangul(): 한글 자판 입력을 영문 키로 바꿨을 때(안내용).
export function createInputDiffer({ onCharacter, onBackspace, onIgnored = () => {}, onHangul = () => {} }) {
  // 센티널 자리는 true: 모바일에서 빈 칸에 Backspace를 누르면 센티널이 지워지는데, 그게 곧 '한 글자 지우기'다.
  let mirror = INPUT_SENTINEL;
  let applied = [true];

  // 공통 접두사 이후를 '지운 글자 + 새 글자'로 본다. 값 길이 n에 대해 O(n)
  function sync(rawValue) {
    const value = hangulToKeys(rawValue);
    if (value !== rawValue && /[\u3131-\u3163\uac00-\ud7a3]/.test(rawValue)) onHangul();
    let common = 0;
    while (common < mirror.length && common < value.length && mirror[common] === value[common]) common++;
    for (let index = mirror.length - 1; index >= common; index--) {
      if (applied[index]) onBackspace();
    }
    applied = applied.slice(0, common);
    for (const character of value.slice(common)) {
      if (TYPEABLE.test(character)) {
        onCharacter(character);
        applied.push(true);
      } else {
        onIgnored(character);
        applied.push(false);
      }
    }
    mirror = value;
  }

  // 조합이 끝났을 때만 textarea를 센티널로 되돌린다(조합 중에 값을 바꾸면 IME가 깨진다).
  function reset() {
    mirror = INPUT_SENTINEL;
    applied = [true];
    return INPUT_SENTINEL;
  }

  return { sync, reset, get value() { return mirror; } };
}
