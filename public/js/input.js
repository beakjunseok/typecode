// 숨은 textarea의 값 변화를 '글자 입력 / 지우기'로 바꾼다.
// 모바일 키보드(Gboard·삼성 키보드)는 영어도 자동완성 때문에 조합(composition) 입력을 쓰고,
// 스와이프 입력·자동수정은 여러 글자를 한꺼번에 바꾼다. 이벤트 종류에 기대지 않고
// '이전 값과 지금 값의 차이'만 보면 모든 입력 방식을 같은 규칙으로 처리할 수 있다.

export const INPUT_SENTINEL = ' ';
const TYPEABLE = /^[\x20-\x7e]$/;

// onCharacter(ch): 게임에 넘길 ASCII 글자, onBackspace(): 게임에 반영된 글자 하나 지우기,
// onIgnored(ch): 한글 등 게임에서 쓰지 않는 글자(경고용).
export function createInputDiffer({ onCharacter, onBackspace, onIgnored = () => {} }) {
  // 센티널 자리는 true: 모바일에서 빈 칸에 Backspace를 누르면 센티널이 지워지는데, 그게 곧 '한 글자 지우기'다.
  let mirror = INPUT_SENTINEL;
  let applied = [true];

  // 공통 접두사 이후를 '지운 글자 + 새 글자'로 본다. 값 길이 n에 대해 O(n)
  function sync(value) {
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
