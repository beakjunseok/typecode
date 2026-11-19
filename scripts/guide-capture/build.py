# 캡처 결과(/tmp/guide/<mode>.json + png)를 public/art/guide/*.webp 와 public/js/guide-shots.js 로 만든다.
# 순서: (public에서) python3 -m http.server 8770 → node scripts/guide-capture/<mode>.mjs (5개) → python3 scripts/guide-capture/build.py
import json, os
from PIL import Image
ROOT = os.path.join(os.path.dirname(__file__), '..', '..')
out = {}

# 상자가 이미지 밖으로 나가지 않게 0.4% ~ 99.6% 안으로 자른다
def clamp(mark):
    left, top = max(0.4, mark['x']), max(0.4, mark['y'])
    right, bottom = min(99.6, mark['x'] + mark['w']), min(99.6, mark['y'] + mark['h'])
    return {**mark, 'x': round(left, 2), 'y': round(top, 2), 'w': round(right - left, 2), 'h': round(bottom - top, 2)}
for mode in ['practice', 'throw', 'battery', 'rhythm', 'defense']:
    data = json.load(open(f'/tmp/guide/{mode}.json'))
    for shot_id, shot in data.items():
        if shot_id == 'battery-steal':
            continue
        image = Image.open(f'/tmp/guide/{shot_id}.png').convert('RGB')
        image.save(os.path.join(ROOT, 'public/art/guide', f'{shot_id}.webp'), 'WEBP', quality=80, method=6)
        out[shot_id] = {'width': image.size[0], 'height': image.size[1], 'marks': [clamp(mark) for mark in shot['marks']]}
lines = ['// 게임 방법 창의 화면 캡처와 표시 상자(%) — scripts/guide-capture 스크립트로 실제 게임 화면에서 뽑았다.',
         '// marks: { x, y, w, h(이미지 대비 %), label }. label이 빈 상자는 번호 없이 테두리만 그린다',
         'export const GUIDE_SHOTS = Object.freeze(' + json.dumps(out, ensure_ascii=False, indent=1) + ');', '']
open(os.path.join(ROOT, 'public/js/guide-shots.js'), 'w').write('\n'.join(lines))
print(len(out), 'shots')
