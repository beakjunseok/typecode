"""정면 키보드 일러스트(템플릿 board-template.png로 생성한 그림)를 받아 키 좌표를 자동으로 맞추고,
public/skins/board/<skin>.webp 와 public/js/skin-boards.js 를 만든다.
사용: python3 scripts/fit-board.py <skin-id> <image-path>
정렬: 키 테두리 위 에지 세기 합을 최대화하는 전체 이동·배율 격자 탐색 → 키별 미세 이동. 시간 O(탐색칸 × 키 수 × 둘레)."""
import importlib.util
import json
import pathlib
import sys

import numpy as np
from PIL import Image

ROOT = pathlib.Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location('board_layout', ROOT / 'scripts' / 'board-layout.py')
board_layout = importlib.util.module_from_spec(spec)
spec.loader.exec_module(board_layout)
detect_spec = importlib.util.spec_from_file_location('detect_keys', ROOT / 'scripts' / 'detect-keys.py')
detect_keys = importlib.util.module_from_spec(detect_spec)
detect_spec.loader.exec_module(detect_keys)
TEMPLATE_CANVAS, TEMPLATE_BOARD = 2048, (82, 674, 1884, 699)
MISMATCHES = []
MODULE_PATH = ROOT / 'public' / 'js' / 'skin-boards.js'


def edge_map(image):
    """밝기 기울기 크기. 키 경계(틈)가 강하게 나온다."""
    gray = np.asarray(image.convert('L'), dtype=np.float32)
    gy, gx = np.gradient(gray)
    return np.hypot(gx, gy)


def outline_score(edges, box):
    """사각형 둘레를 따라 에지 세기 평균. 범위를 벗어나면 0."""
    left, top, right, bottom = (int(round(v)) for v in box)
    height, width = edges.shape
    if left < 0 or top < 0 or right >= width or bottom >= height or right - left < 4 or bottom - top < 4:
        return 0.0
    ring = np.concatenate([edges[top, left:right], edges[bottom, left:right], edges[top:bottom, left], edges[top:bottom, right]])
    return float(ring.mean())


def guess_board(edges, keys_ratio):
    """에지가 몰린 영역(키보드)의 상자를 잡고, 케이스 테두리 비율만큼 안쪽을 키 판으로 본다."""
    column_profile, row_profile = edges.mean(axis=0), edges.mean(axis=1)
    def span(profile):
        threshold = profile.mean() * 0.8
        active = np.nonzero(profile > threshold)[0]
        return (int(active[0]), int(active[-1])) if active.size else (0, profile.size - 1)
    left, right = span(column_profile)
    top, bottom = span(row_profile)
    return (left, top, right - left, bottom - top)


def key_boxes(board, keys):
    left, top, width, height = board
    return {name: (left + x * width, top + y * height, left + (x + w) * width, top + (y + h) * height) for name, (x, y, w, h) in keys.items()}


def fit_global(edges, keys, guess):
    """보드 위치·크기를 격자 탐색으로 맞춘다."""
    best = (-1.0, guess)
    left0, top0, width0, height0 = guess
    for scale_x in np.linspace(0.94, 1.06, 13):
        for scale_y in np.linspace(0.90, 1.10, 11):
            width, height = width0 * scale_x, height0 * scale_y
            for dx in np.linspace(-0.04, 0.04, 9) * width0:
                for dy in np.linspace(-0.08, 0.08, 9) * height0:
                    board = (left0 + (width0 - width) / 2 + dx, top0 + (height0 - height) / 2 + dy, width, height)
                    score = sum(outline_score(edges, box) for box in key_boxes(board, keys).values())
                    if score > best[0]:
                        best = (score, board)
    return best[1]


def runs_below(profile, threshold, min_length):
    """profile < threshold 인 연속 구간 [(시작, 끝)]. 너무 짧은 구간은 버린다."""
    inside = profile < threshold
    runs, start = [], None
    for index, flag in enumerate(inside):
        if flag and start is None:
            start = index
        elif not flag and start is not None:
            if index - start >= min_length:
                runs.append((start, index - 1))
            start = None
    if start is not None and len(inside) - start >= min_length:
        runs.append((start, len(inside) - 1))
    return runs


def split_run(run, names, boxes):
    """한 구간에 키 여러 개가 붙어 잡히면 템플릿 너비 비율로 나눈다."""
    widths = [boxes[name][2] - boxes[name][0] for name in names]
    total, cursor, result = sum(widths), run[0], {}
    for name, width in zip(names, widths):
        span = (run[1] - run[0]) * width / total
        result[name] = (cursor, cursor + span)
        cursor += span
    return result


def spacebar_span(pixels, refined, template_box, band_rows, unit_x):
    """스페이스는 케이스와 색이 비슷할 때가 많아 색 구간 대신 세로 에지 한 쌍을 찾는다.
    가운데는 위 줄들(이미 맞춘 키)의 가운데로 잡고, 양 끝을 기대 위치 ±1키 안에서 가장 센 에지로 정한다."""
    gray = pixels.mean(axis=2)
    edges = np.abs(np.gradient(gray, axis=1))[band_rows[0]:band_rows[1]].mean(axis=0)
    upper = [box for name, box in refined.items() if name not in ('Space',)]
    center = (min(box[0] for box in upper) + max(box[2] for box in upper)) / 2 if upper else (template_box[0] + template_box[2]) / 2
    half = (template_box[2] - template_box[0]) / 2

    def strongest(around):
        start, stop = max(0, int(around - unit_x)), min(edges.size - 1, int(around + unit_x))
        return start + int(np.argmax(edges[start:stop + 1])) if stop > start else around
    return (strongest(center - half), strongest(center + half))


def refine_keys(image, boxes, board):
    """키캡 색으로 실제 키캡 구간을 찾는다: 줄마다 키 가운데 색(중앙값)과 다른 정도를 세로로 평균 내면
    키캡 안은 낮고 틈은 높다. 낮은 구간을 순서대로 키에 짝지어 왼·오른 경계를, 같은 방식으로 위·아래 경계를 정한다.
    그림의 키 크기가 템플릿과 달라도 맞는다. 시간 O(그림 픽셀)."""
    pixels = np.asarray(image, dtype=np.float32)
    height, width, _ = pixels.shape
    unit_x = board[2] / (board_layout.UNITS_W + 2 * board_layout.BEZEL_U)
    unit_y = board[3] / (board_layout.UNITS_H + 2 * board_layout.BEZEL_U)
    rows = {}
    for name, box in boxes.items():
        rows.setdefault(round((box[1] - board[1]) / unit_y), []).append(name)
    refined = dict(boxes)
    for names in rows.values():
        names.sort(key=lambda name: boxes[name][0])
        samples = []
        for name in names:
            left, top, right, bottom = boxes[name]
            cx, cy = int((left + right) / 2), int((top + bottom) / 2)
            radius = max(2, int(unit_x * 0.12))
            samples.append(pixels[max(0, cy - radius):cy + radius, max(0, cx - radius):cx + radius].reshape(-1, 3))
        key_color = np.median(np.concatenate(samples), axis=0)
        distance = np.linalg.norm(pixels - key_color, axis=2)
        top, bottom = boxes[names[0]][1], boxes[names[0]][3]
        middle = (top + bottom) / 2
        band = distance[int(middle - unit_y * 0.22):int(middle + unit_y * 0.22) + 1]
        reach = unit_x * (4 if len(names) == 1 else 0.5)
        row_left = max(0, int(boxes[names[0]][0] - reach))
        row_right = min(width, int(boxes[names[-1]][2] + reach))
        profile = band.mean(axis=0)[row_left:row_right]
        low, high = np.percentile(profile, 10), np.percentile(profile, 90)
        runs = [(a + row_left, b + row_left) for a, b in runs_below(profile, (low + high) / 2, int(unit_x * 0.35))]
        if not runs:
            continue
        if len(names) > 1 and len(runs) != len(names):
            MISMATCHES.append(f'줄 {round((boxes[names[0]][1] - board[1]) / unit_y)}: 그림 {len(runs)}개 / 배열 {len(names)}개')
        # 그림의 키캡 수가 템플릿과 같으면 순서대로, 한 개(스페이스)면 가장 넓은 구간, 아니면 겹침으로 짝짓는다
        owners = {}
        if len(names) == 1:
            spans = {names[0]: spacebar_span(pixels, refined, boxes[names[0]], band_rows=(int(middle - unit_y * 0.25), int(middle + unit_y * 0.25)), unit_x=unit_x)}
            owners = {}
        elif len(runs) == len(names):
            owners = {index: [name] for index, name in enumerate(names)}
        else:
            # 색이 다른 포인트 키 때문에 구간이 어긋나면, 줄 전체 범위(첫 구간 시작~끝 구간 끝)를 배열 너비 비율로 나눈다
            row_start = min(a for a, b in runs if b > boxes[names[0]][0] - unit_x * 0.6)
            row_end = max(b for a, b in runs if a < boxes[names[-1]][2] + unit_x * 0.6)
            spans_override = split_run((row_start, row_end), names, boxes)
        if len(names) > 1 and len(runs) != len(names):
            owners = {}
        for name in ([] if owners or len(names) == 1 or len(runs) != len(names) else names):
            left, _, right, _ = boxes[name]
            overlap = [max(0, min(right, b) - max(left, a)) for a, b in runs]
            best = int(np.argmax(overlap))
            if overlap[best] > (right - left) * 0.25:
                owners.setdefault(best, []).append(name)
        if len(names) != 1:
            spans = spans_override if len(runs) != len(names) else {}
        for run_index, owned in owners.items():
            spans.update(split_run(runs[run_index], owned, boxes))
        # 위·아래: 이 줄 키캡들의 가로 범위에서 같은 방식
        columns = np.concatenate([np.arange(int(a), int(b) + 1) for a, b in spans.values()]) if spans else None
        new_top, new_bottom = top, bottom
        if columns is not None and columns.size:
            search_top, search_bottom = max(0, int(top - unit_y * 0.35)), min(height, int(bottom + unit_y * 0.35))
            vertical_profile = distance[search_top:search_bottom][:, columns].mean(axis=1)
            low, high = np.percentile(vertical_profile, 10), np.percentile(vertical_profile, 90)
            vertical_runs = runs_below(vertical_profile, (low + high) / 2, int(unit_y * 0.4))
            if vertical_runs:
                center = middle - search_top
                a, b = min(vertical_runs, key=lambda run: abs((run[0] + run[1]) / 2 - center))
                new_top, new_bottom = search_top + a, search_top + b
        for name in names:
            left, _, right, _ = boxes[name]
            if name in spans:
                left, right = spans[name]
            refined[name] = (left, new_top, right, new_bottom)
    return refined


def legend_tone(image, boxes):
    """키캡 가운데 밝기(중앙값)로 글자를 어둡게/밝게 정한다. 밝은 키캡에 흰 글자가 묻히지 않게."""
    gray = np.asarray(image.convert('L'), dtype=np.float32)
    centers = [gray[int((t + b) / 2), int((l + r) / 2)] for l, t, r, b in boxes.values()]
    return 'dark' if float(np.median(centers)) > 150 else 'light'


def normalize_to_pitch(boxes, template_boxes):
    """찾은 구간은 키캡 윗면만 잡히기 쉬워 실제 키보다 작다. 키 가운데는 찾은 값을 쓰고,
    크기는 그림에서 잰 키 간격(1키 너비·줄 간격)으로 다시 정해 키캡 전체를 덮게 한다."""
    rows = {}
    for name, box in boxes.items():
        rows.setdefault(round(template_boxes[name][1]), []).append(name)
    centers_x = []
    for names in rows.values():
        names.sort(key=lambda name: boxes[name][0])
        singles = [name for name in names if len(name) == 1]
        for first, second in zip(singles, singles[1:]):
            if names.index(second) - names.index(first) == 1:
                centers_x.append(((boxes[second][0] + boxes[second][2]) - (boxes[first][0] + boxes[first][2])) / 2)
    row_centers = sorted((sum(boxes[name][1] + boxes[name][3] for name in names) / (2 * len(names))) for names in rows.values())
    if len(centers_x) < 5 or len(row_centers) < 3:
        return boxes
    pitch_x = float(np.median(centers_x))
    pitch_y = float(np.median(np.diff(row_centers)))
    template_unit = float(np.median([template_boxes[name][2] - template_boxes[name][0] for name in boxes if len(name) == 1]))
    result = {}
    for name, (left, top, right, bottom) in boxes.items():
        center_x, center_y = (left + right) / 2, (top + bottom) / 2
        units = (template_boxes[name][2] - template_boxes[name][0]) / template_unit
        if name == 'Space':
            half_w = (right - left) / 2 + pitch_x * 0.06
        else:
            half_w = (units * pitch_x - pitch_x * 0.08) / 2 if units > 1.05 else pitch_x * 0.46
        half_h = pitch_y * 0.46
        result[name] = (center_x - half_w, center_y - half_h, center_x + half_w, center_y + half_h)
    return result


def light_keys(image, boxes):
    """윗면이 밝은 키(글자를 진하게 써야 할 키) 목록."""
    gray = np.asarray(image.convert('L'), dtype=np.float32)
    result = []
    for name, (l, t, r, b) in boxes.items():
        patch = gray[int(t + (b - t) * 0.3):int(b - (b - t) * 0.3), int(l + (r - l) * 0.3):int(r - (r - l) * 0.3)]
        if patch.size and float(np.median(patch)) > 150:
            result.append(name)
    return sorted(result)


def write_module(entries):
    lines = ['// 자동 생성: scripts/fit-board.py. 정면 일러스트 키보드 스킨의 그림 경로·비율·키 좌표(그림 대비 0~1 [x, y, w, h]).',
             f'export const SKIN_BOARDS = Object.freeze({json.dumps(entries, ensure_ascii=False, indent=2)});', '']
    MODULE_PATH.write_text('\n'.join(lines), encoding='utf-8')


def load_entries():
    if not MODULE_PATH.exists():
        return {}
    text = MODULE_PATH.read_text(encoding='utf-8')
    start, end = text.index('Object.freeze(') + len('Object.freeze('), text.rindex(');')
    return json.loads(text[start:end])


def main(skin_id, image_path, keys_area=None, wide=False):
    image = Image.open(image_path).convert('RGB')
    ratio, keys = board_layout.unit_layout()
    edges = edge_map(image)
    if keys_area:
        # 손으로 잡은 키 영역(x1,y1,x2,y2: 첫 키 왼쪽 위 ~ 스페이스 줄 오른쪽 아래)에서 케이스 테두리만큼 넓힌다
        x1, y1, x2, y2 = keys_area
        unit_x, unit_y = (x2 - x1) / board_layout.UNITS_W, (y2 - y1) / board_layout.UNITS_H
        guess = (x1 - unit_x * board_layout.BEZEL_U, y1 - unit_y * board_layout.BEZEL_U,
                 (x2 - x1) + 2 * unit_x * board_layout.BEZEL_U, (y2 - y1) + 2 * unit_y * board_layout.BEZEL_U)
    else:
        guess = guess_board(edges, ratio)
    board = fit_global(edges, keys, guess)
    # 1순위: 키캡 덩어리를 직접 찾아 배열과 짝짓기. 안 맞으면 템플릿 정렬 방식으로
    import cv2
    detected = detect_keys.match_layout(detect_keys.detect_rows(cv2.cvtColor(np.asarray(image), cv2.COLOR_RGB2BGR)),
                                        [[name for name, _ in row] for row in board_layout.ROWS])
    if detected:
        print('키캡 직접 찾기: 성공')
        boxes = {name: tuple(float(v) for v in box) for name, box in detected.items()}
        left = min(b[0] for b in boxes.values()); right = max(b[2] for b in boxes.values())
        top = min(b[1] for b in boxes.values()); bottom = max(b[3] for b in boxes.values())
        unit_x = (right - left) / board_layout.UNITS_W; unit_y = (bottom - top) / board_layout.UNITS_H
        board = (left - unit_x * board_layout.BEZEL_U, top - unit_y * board_layout.BEZEL_U,
                 right - left + 2 * unit_x * board_layout.BEZEL_U, bottom - top + 2 * unit_y * board_layout.BEZEL_U)
        # 덩어리는 키캡 윗면이라 옆벽까지 덮도록 조금 넓힌다
        boxes = {name: (l - unit_x * 0.05, t - unit_y * 0.05, r + unit_x * 0.05, b + unit_y * 0.08) for name, (l, t, r, b) in boxes.items()}
    else:
        print('키캡 직접 찾기: 실패 → 템플릿 정렬')
        template = key_boxes(board, keys)
        boxes = normalize_to_pitch(refine_keys(image, template, board), template)
    # 그림은 보드보다 살짝 넓게 잘라 케이스 빛·장식이 남게 한다
    # 영웅·전설은 케이스 밖 오라·입자까지 보이게 넓게 자른다
    margin_x, margin_y = (board[2] * 0.07, board[3] * 0.2) if wide else (board[2] * 0.03, board[3] * 0.08)
    crop = (max(0, board[0] - margin_x), max(0, board[1] - margin_y),
            min(image.width, board[0] + board[2] + margin_x), min(image.height, board[1] + board[3] + margin_y))
    crop_w, crop_h = crop[2] - crop[0], crop[3] - crop[1]
    output = ROOT / 'public' / 'skins' / 'board' / f'{skin_id}.webp'
    output.parent.mkdir(parents=True, exist_ok=True)
    cropped = image.crop(tuple(int(round(v)) for v in crop))
    if cropped.width > 1600:
        cropped = cropped.resize((1600, round(1600 * cropped.height / cropped.width)), Image.LANCZOS)
    cropped.save(output, 'WEBP', quality=86)
    normalized = {name: [round((l - crop[0]) / crop_w, 5), round((t - crop[1]) / crop_h, 5), round((r - l) / crop_w, 5), round((b - t) / crop_h, 5)]
                  for name, (l, t, r, b) in boxes.items()}
    entries = load_entries()
    entries[skin_id] = {'image': f'/skins/board/{skin_id}.webp', 'ratio': round(crop_w / crop_h, 5), 'scale': round(crop_w / board[2], 4), 'legend': legend_tone(image, boxes), 'lightKeys': light_keys(image, boxes), 'keys': normalized}
    write_module(entries)
    preview = cropped.copy()
    from PIL import ImageDraw
    draw = ImageDraw.Draw(preview)
    for x, y, w, h in normalized.values():
        draw.rectangle([x * preview.width, y * preview.height, (x + w) * preview.width, (y + h) * preview.height], outline='red', width=2)
    preview.save(f'/tmp/fit-{skin_id}.png')
    print('키 수 불일치: ' + ('; '.join(MISMATCHES) if MISMATCHES else '없음'))
    print(f'{skin_id}: board={tuple(round(v) for v in board)} crop={cropped.size}')


if __name__ == '__main__':
    arguments = [value for value in sys.argv[1:] if value != '--wide']
    if len(arguments) not in (2, 3):
        sys.exit('사용: python3 scripts/fit-board.py <skin-id> <image-path> [x1,y1,x2,y2 키 영역] [--wide]')
    area = tuple(float(v) for v in arguments[2].split(',')) if len(arguments) == 3 else None
    main(arguments[0], arguments[1], area, '--wide' in sys.argv)
