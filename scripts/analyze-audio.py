"""AI 생성 음원(MP3) → 리듬 모드 악보 데이터(public/js/rhythm-songs-audio.js).

사용: python3 scripts/analyze-audio.py
곡 목록은 아래 SONGS. 곡마다:
  1) 박 추적(librosa.beat.beat_track)으로 템포와 첫 박 시각을 잡고, 박 간격의 중앙값으로 BPM을 고정한다.
  2) 온셋(소리 시작) 세기를 1/4박 격자 위에서 재서, 박 단위로 '칠 만한 자리'를 고른다(정박 > 반박 > 1/4박 우선).
  3) 각 자리의 크로마로 가장 센 음이름을 골라 키 사운드 음높이(5옥타브)로 쓴다.
엔진은 이 '선율' 위에 난이도 격자·최소 간격으로 글자를 얹는다(rhythm-engine.js buildChart).
"""
import json
import pathlib

import librosa
import numpy as np

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUTPUT = ROOT / 'public' / 'js' / 'rhythm-songs-audio.js'
STEPS = 4  # 1/4박 격자

SONGS = [
    {
        'id': 'compile-rush', 'file': 'public/audio/compile-rush.mp3', 'url': '/audio/compile-rush.mp3',
        'title': 'Compile Rush', 'composer': 'FreeMusic AI · 2026', 'bpmHint': 140, 'beatsPerBar': 4,
        'previewAt': 30, 'source': 'https://www.freemusic.ai/', 'license': 'FreeMusic AI 생성곡',
    },
]


def analyze(song):
    path = ROOT / song['file']
    if not path.exists():
        print(f"skip {song['id']}: {path} 없음")
        return None
    signal, rate = librosa.load(path, sr=22050, mono=True)
    duration = len(signal) / rate
    tempo, beats = librosa.beat.beat_track(y=signal, sr=rate, start_bpm=song['bpmHint'], units='time', tightness=200)
    if len(beats) < 16:
        raise RuntimeError(f"{song['id']}: 박을 충분히 찾지 못함")
    interval = float(np.median(np.diff(beats)))
    bpm = round(60 / interval, 2)
    # 첫 박: 박 추적 결과를 고정 간격 격자에 최소제곱으로 맞춘 위상
    indices = np.round((beats - beats[0]) / interval)
    first_beat = float(np.mean(beats - indices * interval))
    while first_beat - interval > 0:
        first_beat -= interval
    hop = 256
    strength = librosa.onset.onset_strength(y=signal, sr=rate, hop_length=hop)
    strength = strength / (np.percentile(strength, 99) + 1e-9)
    chroma = librosa.feature.chroma_cqt(y=signal, sr=rate, hop_length=hop)
    frames_per_second = rate / hop
    total_steps = int((duration - first_beat) / interval * STEPS)

    def onset_at(step):
        time = first_beat + step * interval / STEPS
        frame = int(round(time * frames_per_second))
        window = strength[max(0, frame - 2): frame + 3]
        return float(window.max()) if len(window) else 0.0, frame

    events = []
    for step in range(total_steps):
        value, frame = onset_at(step)
        position = step % STEPS
        # 정박은 낮은 문턱, 엇박·1/4박은 높은 문턱(센 소리만)
        threshold = 0.28 if position == 0 else 0.45 if position == 2 else 0.62
        if value < threshold:
            continue
        frame = min(frame, chroma.shape[1] - 1)
        pitch_class = int(np.argmax(chroma[:, frame]))
        events.append({'step': step, 'midi': 72 + pitch_class if pitch_class < 7 else 60 + pitch_class})
    melody = []
    for index, event in enumerate(events):
        next_step = events[index + 1]['step'] if index + 1 < len(events) else event['step'] + STEPS
        melody += [event['step'] - (events[index - 1]['step'] if index else 0), max(1, next_step - event['step']), event['midi']]
    total_beats = int((duration - first_beat) / interval)
    print(f"{song['id']}: {duration:.1f}s bpm {bpm} (librosa {float(np.atleast_1d(tempo)[0]):.1f}) firstBeat {first_beat:.3f}s events {len(events)}")
    meta = {key: value for key, value in song.items() if key not in ('file', 'bpmHint')}
    return {**meta, 'bpm': bpm, 'firstBeat': round(first_beat, 4), 'steps': STEPS, 'beats': total_beats, 'audioSeconds': round(duration, 2), 'melody': melody}


songs = [result for result in (analyze(song) for song in SONGS) if result]
header = ('// 자동 생성 파일: python3 scripts/analyze-audio.py\n'
          '// AI 생성 음원의 박·온셋 분석 결과. melody = [앞 음과의 간격, 길이, 키 사운드 음높이] 반복, 단위 1/%d박\n' % STEPS)
OUTPUT.write_text(header + 'export const AUDIO_SONG_DATA = ' + json.dumps(songs, ensure_ascii=False) + ';\n', encoding='utf-8')
print(f'wrote {OUTPUT} ({len(songs)} songs)')
