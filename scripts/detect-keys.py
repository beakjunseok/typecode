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


def match_layout(rows, layout_rows):
    """찾은 줄을 배열(키 이름 줄 목록)에 짝짓는다. 줄마다 키 수가 맞아야 하고, 마지막 줄은 가장 넓은 덩어리를 스페이스로.
    맞으면 {키: (x1,y1,x2,y2)}, 아니면 None."""
    if len(rows) < 5:
        return None
    singles = [b[2] - b[0] for row in rows[:4] for b in row]
    pitch = float(np.median([row[i + 1][0] - row[i][0] for row in rows[:4] for i in range(len(row) - 1)])) if singles else 0
    result = {}
    for row, names in zip(rows[:4], layout_rows[:4]):
        row = fill_gaps(row, pitch)
        if len(row) != len(names):
            return None
        result.update(dict(zip(names, row)))
    space = max(rows[4], key=lambda b: b[2] - b[0])
    if space[2] - space[0] < pitch * 3:
        return None
    result[layout_rows[4][0]] = space
    return result


if __name__ == '__main__':
    image = cv2.imread(sys.argv[1])
    rows = detect_rows(image)
    print([len(row) for row in rows])
    for row in rows:
        for x1, y1, x2, y2 in row:
            cv2.rectangle(image, (int(x1), int(y1)), (int(x2), int(y2)), (0, 0, 255), 2)
    cv2.imwrite('/tmp/detect.png', image)
