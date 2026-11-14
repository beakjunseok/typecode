"""정면 키보드 그림에서 키캡을 '덩어리'로 직접 찾는다(색이 다른 포인트 키·빛 번짐에도 강함).
흐린 뒤 기울기가 낮은(평평한) 영역을 이어 붙이고, 키캡 크기·모양인 덩어리만 남겨 줄별로 묶는다.
반환: [[(x1,y1,x2,y2), ...] 위에서부터 줄별, 왼쪽부터]. 시간 O(픽셀)."""
import sys

import cv2
import numpy as np


def detect_rows(image_bgr):
    height, width = image_bgr.shape[:2]
    blurred = cv2.GaussianBlur(image_bgr, (0, 0), 2.2)
    lab = cv2.cvtColor(blurred, cv2.COLOR_BGR2LAB).astype(np.float32)
    gradient = np.zeros((height, width), np.float32)
    for channel in range(3):
        gx = cv2.Sobel(lab[:, :, channel], cv2.CV_32F, 1, 0, ksize=3)
        gy = cv2.Sobel(lab[:, :, channel], cv2.CV_32F, 0, 1, ksize=3)
        gradient = np.maximum(gradient, np.hypot(gx, gy))
    best = None
    for percentile in (55, 62, 70, 78):
        flat = (gradient < np.percentile(gradient, percentile)).astype(np.uint8)
        flat = cv2.morphologyEx(flat, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
        count, labels, stats, _ = cv2.connectedComponentsWithStats(flat, connectivity=4)
        boxes = []
        for index in range(1, count):
            x, y, w, h, area = stats[index]
            if w < width * 0.025 or h < height * 0.04 or w > width * 0.6 or h > height * 0.2:
                continue
            if area < w * h * 0.55:
                continue
            boxes.append((x, y, x + w, y + h))
        rows = group_rows(boxes)
        score = sum(len(row) for row in rows[:5]) if len(rows) >= 5 else 0
        if best is None or score > best[0]:
            best = (score, rows)
    return best[1] if best else []


def group_rows(boxes):
    """세로 가운데가 비슷한 키캡끼리 한 줄. 키 높이 중앙값의 절반 안이면 같은 줄."""
    if not boxes:
        return []
    median_h = float(np.median([b[3] - b[1] for b in boxes]))
    boxes = sorted(boxes, key=lambda b: (b[1] + b[3]) / 2)
    rows, current = [], [boxes[0]]
    for box in boxes[1:]:
        if abs((box[1] + box[3]) / 2 - (current[-1][1] + current[-1][3]) / 2) < median_h * 0.5:
            current.append(box)
        else:
            rows.append(current)
            current = [box]
    rows.append(current)
    # 키캡 덩어리가 많은 줄 5개(키보드 줄)를 위에서부터
    rows = [sorted(row, key=lambda b: b[0]) for row in rows if len(row) >= 1]
    top5 = sorted(sorted(rows, key=len, reverse=True)[:5], key=lambda row: row[0][1])
    return top5


def fill_gaps(row, pitch):
    """줄 안에서 키 하나만큼 빈 틈(못 찾은 키)을 이웃 키 크기로 채운다."""
    filled = [row[0]]
    for box in row[1:]:
        previous = filled[-1]
        gap = box[0] - previous[2]
        key_w = min(previous[2] - previous[0], box[2] - box[0], pitch * 0.92)
        # 이웃한 두 키 사이 틈은 (간격 - 키 너비). 그보다 남는 만큼이 빠진 키 수
        missing = max(0, int(round((gap - (pitch - key_w)) / pitch)))
        for step in range(missing):
            spacing = (gap - missing * key_w) / (missing + 1)
            left = previous[2] + spacing * (step + 1) + key_w * step
            filled.append((left, previous[1], left + key_w, previous[3]))
        filled.append(box)
    return filled


def complete_rows(rows, layout_rows):
    """위 4줄을 다듬는다: 빠진 칸 채우기, 빛 번짐 조각 빼기, 줄 양 끝(색이 다른 기능키) 못 찾은 것 채우기.
    반환: (줄 4개, 키 간격, 키 사이 틈). 줄 키 수가 배열보다 적을 수 있다(그림에 키가 빠진 경우)."""
    pitch = float(np.median([row[i + 1][0] - row[i][0] for row in rows[:4] for i in range(len(row) - 1)]))
    rows4 = [fill_gaps(row, pitch) for row in rows[:4]]
    # 키보드 좌우 끝: 위 4줄과 맨 아랫줄(Ctrl·Alt 등) 중 가장 바깥
    outer = rows4 + ([sorted(rows[4], key=lambda b: b[0])] if len(rows) > 4 and rows[4] else [])
    edge_left = min(row[0][0] for row in outer)
    edge_right = max(row[-1][2] for row in outer)
    gap = max(2.0, pitch - float(np.median([b[2] - b[0] for row in rows4 for b in row if b[2] - b[0] < pitch])))
    completed = []
    for row, names in zip(rows4, layout_rows[:4]):
        row = list(row)
        single = float(np.median([b[2] - b[0] for b in row]))
        while len(row) > len(names):
            smallest = min(row, key=lambda b: (b[2] - b[0]) * (b[3] - b[1]))
            if smallest[2] - smallest[0] > single * 0.75:
                break
            row.remove(smallest)
        if len(row) < len(names) and row[0][0] - edge_left > pitch * 0.5:
            row.insert(0, (edge_left, row[0][1], row[0][0] - gap, row[0][3]))
        if len(row) < len(names) and edge_right - row[-1][2] > pitch * 0.5:
            row.append((row[-1][2] + gap, row[-1][1], edge_right, row[-1][3]))
        completed.append(row)
    return completed, pitch, gap


def match_layout(rows, layout_rows):
    """찾은 줄을 배열(키 이름 줄 목록)에 짝짓는다. 줄마다 키 수가 맞아야 하고, 마지막 줄은 가장 넓은 덩어리를 스페이스로.
    맞으면 {키: (x1,y1,x2,y2)}, 아니면 None."""
    if len(rows) < 5:
        return None
    rows4, pitch, gap = complete_rows(rows, layout_rows)
    result = {}
    for row, names in zip(rows4, layout_rows[:4]):
        if len(row) != len(names):
            return None
        result.update(dict(zip(names, row)))
    bottom = sorted(rows[4], key=lambda b: b[0])
    space = max(bottom, key=lambda b: b[2] - b[0])
    if space[2] - space[0] < pitch * 3:
        return None
    # 스페이스바가 조각으로 잡히면 양옆 키 바로 앞까지 넓힌다
    position = bottom.index(space)
    left = bottom[position - 1][2] + gap if position > 0 else space[0]
    right = bottom[position + 1][0] - gap if position + 1 < len(bottom) else space[2]
    space = (min(space[0], left), space[1], max(space[2], right), space[3])
    result[layout_rows[4][0]] = space
    return result


def stretch_strip(strip, width):
    """가로 3분할 크기 바꾸기: 양 끝(둥근 모서리)은 그대로 두고 가운데만 늘이거나 줄인다."""
    height, current = strip.shape[:2]
    edge = max(2, min(int(current * 0.3), int(width * 0.45)))
    middle = max(1, width - 2 * edge)
    center = cv2.resize(strip[:, edge:current - edge], (middle, height), interpolation=cv2.INTER_AREA)
    return np.concatenate([strip[:, :edge], center, strip[:, current - edge:]], axis=1)[:, :width]


def repair_rows(image, rows, layout_rows):
    """AI가 줄마다 글자 키를 한두 개 덜 그린 그림을 고친다: 줄의 마지막 글자 키를 빠진 수만큼 복사해 끼우고,
    오른쪽 끝 기능키(Backspace·\\·Enter·Shift)를 그만큼 줄여 줄 길이를 맞춘다. 고칠 게 없거나 못 고치면 None."""
    if len(rows) < 5:
        return None
    rows4, pitch, _ = complete_rows(rows, layout_rows)
    repaired, changed = image.copy(), False
    centers = [(row[0][1] + row[0][3]) / 2 for row in rows[:5]]
    for index, (row, names) in enumerate(zip(rows4, layout_rows[:4])):
        missing = len(names) - len(row)
        if missing == 0:
            continue
        if missing not in (1, 2) or len(row) < 4:
            return None
        half_gap = (row[-1][0] - row[-2][2]) / 2
        row_gap = (centers[1] - centers[0]) / 2
        top = int(max(0, centers[index] - row_gap))
        bottom = int(min(image.shape[0], centers[index] + row_gap))
        row_left, row_right = int(row[0][0] - half_gap), int(row[-1][2] + half_gap)
        cell_left, cell_right = int(row[-2][0] - half_gap), int(row[-2][2] + half_gap)
        band = image[top:bottom]
        # 마지막 글자 키 칸을 하나 더 끼운 줄을 원래 줄 길이로 고르게 줄인다(약 7%)
        widened = np.concatenate([band[:, row_left:cell_right]] + [band[:, cell_left:cell_right]] * missing + [band[:, cell_right:row_right]], axis=1)
        repaired[top:bottom, row_left:row_right] = cv2.resize(widened, (row_right - row_left, bottom - top), interpolation=cv2.INTER_AREA)
        changed = True
    return repaired if changed else None


if __name__ == '__main__':
    image = cv2.imread(sys.argv[1])
    rows = detect_rows(image)
    print([len(row) for row in rows])
    for row in rows:
        for x1, y1, x2, y2 in row:
            cv2.rectangle(image, (int(x1), int(y1)), (int(x2), int(y2)), (0, 0, 255), 2)
    cv2.imwrite('/tmp/detect.png', image)
