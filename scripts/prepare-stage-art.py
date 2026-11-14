"""Gemini 배경·결과 그림을 게임용 webp로 다듬는다.

- 별 모양 워터마크를 OpenCV inpaint로 지운다.
- 서버실 그림은 아래 검은 띠를 잘라 낸다.
- 바다 그림은 하늘 부분의 어두운 양옆 띠를 가운데 밝기에 맞춘다.
사용: python3 scripts/prepare-stage-art.py <throw> <battery> <practice> <win> <lose>
"""
import sys
from pathlib import Path

import cv2
import numpy as np

OUT = Path(__file__).resolve().parent.parent / 'public' / 'art'


def remove_star(image, center, radius):
    """워터마크 별 자리를 주변 색으로 채운다."""
    mask = np.zeros(image.shape[:2], np.uint8)
    cv2.circle(mask, center, radius, 255, -1)
    return cv2.inpaint(image, mask, 7, cv2.INPAINT_TELEA)


def even_side_bands(image, left, right, sky_bottom, feather=40):
    """양옆 띠를 줄마다 띠 경계 안쪽 색에 맞춰 밝힌다. 아래쪽은 서서히 원본으로 돌아간다."""
    result = image.astype(np.float32)
    rows = min(sky_bottom + feather, image.shape[0])
    for band, inside, outside in ((slice(0, left), slice(left + 3, left + 30), slice(left - 30, left - 3)),
                                  (slice(right, None), slice(right - 30, right - 3), slice(right + 3, right + 30))):
        # 별·건물에 흔들리지 않도록 중앙값을 쓰고, 줄 방향으로 부드럽게 편다.
        ratio = (np.median(result[:rows, inside], axis=1) + 1) / (np.median(result[:rows, outside], axis=1) + 1)
        ratio = cv2.GaussianBlur(np.clip(ratio, 0.5, 3).reshape(rows, 1, 3), (1, 61), 0).reshape(rows, 3)
        for y in range(rows):
            weight = 1.0 if y < sky_bottom else 1 - (y - sky_bottom) / feather
            result[y, band] *= 1 + (ratio[min(y, sky_bottom - 1)] - 1) * weight
    result = np.clip(result, 0, 255).astype(np.uint8)
    seam = np.zeros(image.shape[:2], np.uint8)
    seam[:sky_bottom + feather, left - 3:left + 3] = 255
    seam[:sky_bottom + feather, right - 3:right + 3] = 255
    return cv2.inpaint(result, seam, 5, cv2.INPAINT_TELEA)


def save(image, name, width=None):
    """필요하면 줄이고 webp로 저장한다."""
    if width and image.shape[1] > width:
        height = round(image.shape[0] * width / image.shape[1])
        image = cv2.resize(image, (width, height), interpolation=cv2.INTER_AREA)
    path = OUT / f'{name}.webp'
    if not cv2.imwrite(str(path), image, [cv2.IMWRITE_WEBP_QUALITY, 84]):
        raise RuntimeError(f'저장 실패: {path}')
    print(path.name, image.shape[1], 'x', image.shape[0], path.stat().st_size // 1024, 'KB')


def load(path):
    image = cv2.imread(path, cv2.IMREAD_COLOR)
    if image is None:
        raise FileNotFoundError(path)
    return image


def main(paths):
    if len(paths) != 5:
        raise SystemExit(__doc__)
    OUT.mkdir(parents=True, exist_ok=True)
    throw, battery, practice, win, lose = map(load, paths)

    save(throw[:456], 'throw-stage')
    battery = remove_star(battery, (935, 482), 22)
    save(even_side_bands(battery, 222, 801, 325), 'battery-stage')
    save(remove_star(practice, (935, 482), 22), 'practice-stage')
    save(remove_star(win, (904, 902), 30), 'result-win', 640)
    save(remove_star(lose, (904, 902), 30), 'result-lose', 640)


if __name__ == '__main__':
    main(sys.argv[1:])
