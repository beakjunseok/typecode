"""키보드 배열(public/js/keyboard.js LAYOUT과 동일)을 한 곳에 두고, 정면 일러스트 생성용 템플릿 PNG와 기본 키 좌표를 만든다.
좌표는 그림 크기 대비 비율(0~1)로 [x, y, w, h]. 시간 O(키 수)."""
import json
import sys
from PIL import Image, ImageDraw

ROWS = [
    [('`', 1), ('1', 1), ('2', 1), ('3', 1), ('4', 1), ('5', 1), ('6', 1), ('7', 1), ('8', 1), ('9', 1), ('0', 1), ('-', 1), ('=', 1), ('Backspace', 2)],
    [('Tab', 1.5), ('q', 1), ('w', 1), ('e', 1), ('r', 1), ('t', 1), ('y', 1), ('u', 1), ('i', 1), ('o', 1), ('p', 1), ('[', 1), (']', 1), ('\\', 1.5)],
    [('Caps', 1.75), ('a', 1), ('s', 1), ('d', 1), ('f', 1), ('g', 1), ('h', 1), ('j', 1), ('k', 1), ('l', 1), (';', 1), ("'", 1), ('Enter', 2.25)],
    [('ShiftLeft', 2.25), ('z', 1), ('x', 1), ('c', 1), ('v', 1), ('b', 1), ('n', 1), ('m', 1), (',', 1), ('.', 1), ('/', 1), ('ShiftRight', 2.75)],
    [('Space', 6.25)],
]
UNITS_W, UNITS_H = 15, 5
BEZEL_U = 0.45   # 케이스 테두리 두께(키 단위)
GAP_U = 0.08     # 키 사이 틈


def unit_layout():
    """케이스 포함 보드 기준 비율 좌표. 반환: (보드 비율 w/h, {키: [x,y,w,h]})."""
    total_w, total_h = UNITS_W + 2 * BEZEL_U, UNITS_H + 2 * BEZEL_U
    keys = {}
    for row_index, row in enumerate(ROWS):
        row_width = sum(width for _, width in row)
        cursor = (UNITS_W - row_width) / 2
        for key, width in row:
            x = BEZEL_U + cursor + GAP_U / 2
            y = BEZEL_U + row_index + GAP_U / 2
            keys[key] = [round(x / total_w, 5), round(y / total_h, 5),
                         round((width - GAP_U) / total_w, 5), round((1 - GAP_U) / total_h, 5)]
            cursor += width
    return total_w / total_h, keys


def draw_template(path, size=2048):
    """정사각 캔버스 가운데에 글자 없는 키 배열을 그린다(생성 모델이 배치를 덜 섞도록 1:1)."""
    ratio, keys = unit_layout()
    board_w = int(size * 0.92)
    board_h = int(board_w / ratio)
    left, top = (size - board_w) // 2, (size - board_h) // 2
    image = Image.new('RGB', (size, size), (26, 26, 26))
    draw = ImageDraw.Draw(image)
    draw.rounded_rectangle([left, top, left + board_w, top + board_h], radius=int(board_h * 0.06), fill=(70, 70, 76))
    for x, y, w, h in keys.values():
        box = [left + x * board_w, top + y * board_h, left + (x + w) * board_w, top + (y + h) * board_h]
        draw.rounded_rectangle(box, radius=int(board_h * 0.025), fill=(205, 205, 210))
    image.save(path)
    return {'canvas': size, 'board': [left, top, board_w, board_h]}


if __name__ == '__main__':
    output = sys.argv[1] if len(sys.argv) > 1 else 'board-template.png'
    info = draw_template(output)
    print(json.dumps(info))
