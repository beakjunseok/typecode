"""키보드 그림의 줄별 키 수를 센다(위에서부터 14·14·13·12개여야 한다). 그림을 넣기 전에 다시 만들어야 하는지 알려 준다.
사용: python3 scripts/check-keys.py 그림1.png 그림2.png ...  시간 O(픽셀 × 그림 수)"""
import importlib.util
import pathlib
import sys

import cv2

ROOT = pathlib.Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location('detect_keys', ROOT / 'scripts' / 'detect-keys.py')
detect_keys = importlib.util.module_from_spec(spec)
spec.loader.exec_module(detect_keys)
LAYOUT = [['`', '1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '-', '=', 'Backspace'], ['Tab'] + list('qwertyuiop[]\\'),
          ['Caps'] + list("asdfghjkl;'") + ['Enter'], ['ShiftLeft'] + list('zxcvbnm,./') + ['ShiftRight'], ['Space']]
EXPECTED = [len(row) for row in LAYOUT[:4]]


def check(path):
    """반환: (줄별 키 수 또는 None, 판정 문구)"""
    image = cv2.imread(str(path))
    if image is None:
        return None, '그림을 열 수 없음'
    try:
        rows = detect_keys.detect_rows(image)
        _, counts, _, _ = detect_keys.grid_rows(rows, LAYOUT)
    except Exception as error:  # 키를 거의 못 찾은 그림
        return None, f'키를 찾지 못함 ({error.__class__.__name__})'
    missing = [expected - count for expected, count in zip(EXPECTED, counts)]
    if missing == [0, 0, 0, 0]:
        return counts, '통과'
    if all(0 <= value <= 2 for value in missing):
        return counts, f'자동 보충 가능(줄마다 {max(missing)}개 빠짐)'
    return counts, '다시 만들기'


if __name__ == '__main__':
    for argument in sys.argv[1:]:
        counts, verdict = check(argument)
        print(f'{pathlib.Path(argument).name}: {counts} → {verdict}')
