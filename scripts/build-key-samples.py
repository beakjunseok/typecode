"""적축(linear) 키 샘플을 스프라이트 WAV 하나 + 오프셋 JS 모듈로 묶는다.

원본: gabrimatic/switchtone Resources/Sounds/linear (MIT) ← Sony Keyboard Sound Dataset (MIT).
사용: python3 scripts/build-key-samples.py <switchtone/Resources/Sounds/linear 경로>
요구: ffmpeg (리샘플·변환). 출력: public/sounds/linear.wav, public/js/key-samples.js
"""
import array
import json
import subprocess
import sys
import wave
from pathlib import Path

SAMPLE_RATE = 32000          # 16 kHz 위 에너지가 0.8%뿐이라 32 kHz로 충분, 용량 약 1/1.4
GAP_SECONDS = 0.008          # 클립 사이 무음(재생 시 이웃 클립이 새어 들어오지 않게, 재생은 길이로 잘라서 함)
TAIL_PAD_SECONDS = 0.01      # 소리 끝(피크 1% 지점) 뒤 여유
FADE_SECONDS = 0.006         # 끝부분 페이드 아웃(클릭 노이즈 방지)
GROUPS = {
    'down': [f'key-down-{n}' for n in range(1, 13)],
    'up': [f'key-up-{n}' for n in range(1, 13)],
    'eraseDown': [f'backspace-down-{n}' for n in range(1, 4)],
    'eraseUp': [f'backspace-up-{n}' for n in range(1, 4)],
}
ROOT = Path(__file__).resolve().parent.parent


def load_clip(source_dir, name):
    """원본 WAV를 32 kHz/16-bit stereo로 변환해 int16 배열로 읽는다."""
    result = subprocess.run(
        ['ffmpeg', '-loglevel', 'error', '-i', str(source_dir / f'{name}.wav'),
         '-ar', str(SAMPLE_RATE), '-ac', '2', '-f', 's16le', '-'],
        check=True, capture_output=True)
    return array.array('h', result.stdout)


def trim_and_fade(samples):
    """피크 1% 아래로 떨어진 뒤 여유만 남기고 자른 다음 끝을 선형 페이드. 길이 n에 대해 O(n)."""
    frames = len(samples) // 2
    peak = max(abs(value) for value in samples) or 1
    threshold = peak * 0.01
    last = max((index for index in range(frames)
                if max(abs(samples[2 * index]), abs(samples[2 * index + 1])) > threshold), default=frames - 1)
    end = min(frames, last + int(TAIL_PAD_SECONDS * SAMPLE_RATE))
    trimmed = samples[:end * 2]
    fade = min(end, int(FADE_SECONDS * SAMPLE_RATE))
    for offset in range(fade):
        factor = (fade - offset) / fade
        index = end - fade + offset
        trimmed[2 * index] = int(trimmed[2 * index] * factor)
        trimmed[2 * index + 1] = int(trimmed[2 * index + 1] * factor)
    return trimmed


def build(source_dir):
    sprite = array.array('h')
    gap = array.array('h', [0] * int(GAP_SECONDS * SAMPLE_RATE) * 2)
    offsets = {}
    for group, names in GROUPS.items():
        offsets[group] = []
        for name in names:
            clip = trim_and_fade(load_clip(source_dir, name))
            start = len(sprite) // 2
            sprite.extend(clip)
            offsets[group].append([round(start / SAMPLE_RATE, 5), round(len(clip) // 2 / SAMPLE_RATE, 5)])
            sprite.extend(gap)
    output = ROOT / 'public' / 'sounds' / 'linear.wav'
    output.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(output), 'wb') as writer:
        writer.setnchannels(2)
        writer.setsampwidth(2)
        writer.setframerate(SAMPLE_RATE)
        writer.writeframes(sprite.tobytes())
    module = ROOT / 'public' / 'js' / 'key-samples.js'
    module.write_text(
        '// scripts/build-key-samples.py가 생성 — 직접 고치지 말 것.\n'
        '// 적축(linear) 실제 녹음 스프라이트의 [시작초, 길이초]. 출처·라이선스: /sounds/LICENSES.txt\n'
        "export const LINEAR_SPRITE_URL = '/sounds/linear.wav';\n"
        f'export const LINEAR_SPRITE = Object.freeze({json.dumps(offsets)});\n', encoding='utf-8')
    seconds = len(sprite) / 2 / SAMPLE_RATE
    print(f'{output} {seconds:.2f}s {output.stat().st_size // 1024} KB, clips {sum(len(v) for v in offsets.values())}')


if __name__ == '__main__':
    if len(sys.argv) != 2:
        sys.exit('usage: build-key-samples.py <path to switchtone/Resources/Sounds/linear>')
    build(Path(sys.argv[1]))
