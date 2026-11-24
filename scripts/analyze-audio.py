"""AI 생성 음원(MP3) → 리듬 모드 악보 데이터(public/js/rhythm-songs-audio.js).

사용: python3 scripts/analyze-audio.py
곡 목록은 아래 SONGS. 곡마다:
  1) 박 추적(librosa.beat.beat_track)으로 대략의 템포를 잡고, 고해상도 온셋을 박 간격으로 접어 BPM(0.002 단위)과 첫 박을 맞춘다.
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
    {
        'id': 'compile-rush-b', 'file': 'public/audio/compile-rush-b.mp3', 'url': '/audio/compile-rush-b.mp3',
        'title': 'Compile Rush (Alt Mix)', 'composer': 'FreeMusic AI · 2026', 'bpmHint': 140, 'beatsPerBar': 4,
        'previewAt': 30, 'source': 'https://www.freemusic.ai/', 'license': 'FreeMusic AI 생성곡',
    }
]


FINE_HOP = 64  # 박 격자 맞춤용 온셋 해상도(약 2.9ms)


def fold_score(envelope, frames_per_second, interval):
    """온셋 세기를 박 간격으로 접어(위상 히스토그램) 가장 센 위상과 그 날카로움을 돌려준다. O(프레임 수)"""
    times = np.arange(len(envelope)) / frames_per_second
    bins = 240
    phase = ((times % interval) / interval * bins).astype(int) % bins
    histogram = np.bincount(phase, weights=envelope, minlength=bins)
    histogram = histogram + np.roll(histogram, 1) + np.roll(histogram, -1)
    best = int(np.argmax(histogram))
    return histogram[best] / (histogram.mean() + 1e-9), (best + 0.5) / bins * interval


def refine_grid(beats, envelope, frames_per_second):
    """박 추적 결과(프레임 단위로 양자화돼 BPM이 0.5% 이상 틀릴 수 있다)를 출발점으로,
    BPM을 ±2% 안에서 0.002 BPM 간격으로 훑어 온셋이 가장 한 위상에 몰리는 박 간격과 첫 박을 찾는다.
    곡 전체에 고정 격자를 맞추므로 끝으로 갈수록 박이 밀리는 문제가 없어진다. O(후보 수 × 프레임 수)"""
    indices = np.round((beats - beats[0]) / np.median(np.diff(beats)))
    slope, intercept = np.polyfit(indices, beats, 1)
    center_bpm = 60 / slope
    best = None
    for coarse_step, span in ((0.02, center_bpm * 0.02), (0.002, 0.04)):
        candidates = np.arange(center_bpm - span, center_bpm + span + coarse_step / 2, coarse_step)
        for bpm in candidates:
            score, phase = fold_score(envelope, frames_per_second, 60 / bpm)
            if best is None or score > best[0]:
                best = (score, bpm, phase)
        center_bpm = best[1]
    interval = 60 / best[1]
    first_beat = best[2]
    # 박 추적이 잡은 첫 박과 같은 박(가장 가까운 격자점)부터 센다
    first_beat += round((beats[0] - first_beat) / interval) * interval
    while first_beat - interval > 0:
        first_beat -= interval
    while first_beat < 0:
        first_beat += interval
    return interval, float(first_beat)


def smooth_map(times, half=8):
    """박 번호 → 시각을 국소 선형 회귀(±half박, 이상치 제거)로 매끄럽게: 박 추적의 들쭉날쭉함은 없애고 템포 변화는 따라간다. O(박 수 × half)"""
    count = len(times)
    indices = np.arange(count)
    smoothed = np.empty(count)
    for index in range(count):
        low, high = max(0, index - half), min(count, index + half + 1)
        x, y = indices[low:high], times[low:high]
        for _ in range(3):
            slope, intercept = np.polyfit(x, y, 1)
            residual = y - (slope * x + intercept)
            keep = np.abs(residual) < max(0.03, 2.5 * np.std(residual))
            if keep.all() or keep.sum() < 4:
                break
            x, y = x[keep], y[keep]
        smoothed[index] = slope * index + intercept
    return smoothed


def best_shift(envelope, frames_per_second, times, span=0.12):
    """박 시각들을 얼마나 밀면(초) 고해상도 온셋과 가장 잘 겹치나. O(후보 × 박 수)"""
    best = (-1.0, 0.0)
    for shift in np.arange(-span, span + 1e-9, 0.002):
        frames = np.round((times + shift) * frames_per_second).astype(int)
        frames = frames[(frames >= 0) & (frames < len(envelope))]
        if len(frames):
            score = float(envelope[frames].mean())
            if score > best[0]:
                best = (score, float(shift))
    return best[1]


def segment_shifts(envelope, frames_per_second, beat_times, duration):
    """검증용: 20초 구간마다 박 지도가 온셋에서 몇 ms 어긋나 있는지"""
    shifts = []
    for start in np.arange(0, max(duration - 10, 1), 20):
        inside = beat_times[(beat_times >= start) & (beat_times < start + 20)]
        if len(inside) >= 4:
            shifts.append(best_shift(envelope, frames_per_second, inside, 0.15) * 1000)
    return shifts


def build_tempo_map(strength, rate, hop, fine_strength, fine_fps, bpm, duration):
    """곡 전체의 박 시각 목록(템포 지도). AI 음원은 곡 중간에 템포가 바뀌기도 해서 고정 BPM으로는 뒤로 갈수록 밀린다.
    1) 박 추적(DP, 템포 변화 허용) 2) 국소 회귀로 매끄럽게 3) ±16박 창마다 고해상도 온셋에 맞춰 위상 보정
    4) 음원 처음·끝까지 늘린다(앞뒤 박 간격으로 외삽)"""
    _, beats = librosa.beat.beat_track(onset_envelope=strength, sr=rate, hop_length=hop, start_bpm=bpm, tightness=100, units='time', trim=False)
    if len(beats) < 16:
        raise RuntimeError('박을 충분히 찾지 못함')
    beat_map = smooth_map(np.asarray(beats, dtype=float))
    corrections = np.array([best_shift(fine_strength, fine_fps, beat_map[max(0, index - 16): index + 17]) for index in range(len(beat_map))])
    corrections = np.array([np.median(corrections[max(0, index - 4): index + 5]) for index in range(len(corrections))])
    beat_map = smooth_map(beat_map + corrections)
    first_interval = beat_map[1] - beat_map[0]
    while beat_map[0] - first_interval > 0:
        beat_map = np.insert(beat_map, 0, beat_map[0] - first_interval)
    last_interval = beat_map[-1] - beat_map[-2]
    while beat_map[-1] < duration:
        beat_map = np.append(beat_map, beat_map[-1] + last_interval)
    if np.any(np.diff(beat_map) <= 0.15):
        raise RuntimeError('템포 지도가 뒤집힘')
    return beat_map


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
    hop = 256
    strength = librosa.onset.onset_strength(y=signal, sr=rate, hop_length=hop)
    fine_strength = librosa.onset.onset_strength(y=signal, sr=rate, hop_length=FINE_HOP)
    fine_fps = rate / FINE_HOP
    interval, _ = refine_grid(beats, fine_strength, fine_fps)
    beat_times = build_tempo_map(strength, rate, hop, fine_strength, fine_fps, 60 / interval, duration)
    first_beat = float(beat_times[0])
    bpm = round(60 / float(np.median(np.diff(beat_times))), 2)
    strength = strength / (np.percentile(strength, 99) + 1e-9)
    chroma = librosa.feature.chroma_cqt(y=signal, sr=rate, hop_length=hop)
    frames_per_second = rate / hop
    total_steps = (len(beat_times) - 1) * STEPS

    def time_of_step(step):
        beat, part = divmod(step, STEPS)
        if part == 0:
            return beat_times[beat]
        return beat_times[beat] + (beat_times[beat + 1] - beat_times[beat]) * part / STEPS

    fine_peak = fine_strength / (np.percentile(fine_strength, 99) + 1e-9)

    # 격자 자리 ±반 칸 안에서 가장 센 온셋: 세기, 크로마 프레임, 실제 소리 시각(고해상도 피크).
    # 박 지도가 조금 어긋난 구간에서도 글자는 실제로 들리는 소리 위에 놓인다(nudge = 소리 시각 - 격자 시각)
    def onset_at(step):
        center = time_of_step(step)
        half = (time_of_step(step + 1) - center) / 2 if step + 1 <= total_steps else 0.05
        low = int(np.ceil((center - half) * frames_per_second))
        high = int(np.floor((center + half) * frames_per_second - 1e-9)) + 1
        window = strength[max(0, low): max(0, high)]
        if not len(window):
            return 0.0, int(round(center * frames_per_second)), center
        frame = max(0, low) + int(np.argmax(window))
        fine_low = int((frame / frames_per_second - 0.015) * fine_fps)
        fine_window = fine_peak[max(0, fine_low): fine_low + int(0.03 * fine_fps) + 1]
        peak_time = (max(0, fine_low) + int(np.argmax(fine_window))) / fine_fps if len(fine_window) else frame / frames_per_second
        peak_time = min(max(peak_time, center - half), center + half)
        return float(window.max()), frame, peak_time

    events = []
    for step in range(total_steps):
        value, frame, peak_time = onset_at(step)
        position = step % STEPS
        # 정박은 낮은 문턱, 엇박·1/4박은 높은 문턱(센 소리만)
        threshold = 0.28 if position == 0 else 0.45 if position == 2 else 0.62
        if value < threshold:
            continue
        frame = min(frame, chroma.shape[1] - 1)
        pitch_class = int(np.argmax(chroma[:, frame]))
        events.append({'step': step, 'midi': 72 + pitch_class if pitch_class < 7 else 60 + pitch_class,
                       'nudge': int(round((peak_time - time_of_step(step)) * 1000))})
    melody = []
    for index, event in enumerate(events):
        next_step = events[index + 1]['step'] if index + 1 < len(events) else event['step'] + STEPS
        melody += [event['step'] - (events[index - 1]['step'] if index else 0), max(1, next_step - event['step']), event['midi']]
    nudges = [event['nudge'] for event in events]
    total_beats = len(beat_times) - 1
    drift = segment_shifts(fine_strength, fine_fps, beat_times, duration)
    spread = 60 / np.diff(beat_times)
    print(f"{song['id']}: {duration:.1f}s bpm {bpm} ({spread.min():.1f}~{spread.max():.1f}) firstBeat {first_beat:.3f}s events {len(events)} "
          f"20초 구간별 어긋남(ms) {' '.join(f'{value:+.0f}' for value in drift)} · 글자 보정 |nudge| 중앙 {np.median(np.abs(nudges)):.0f}ms 최대 {np.max(np.abs(nudges))}ms")
    meta = {key: value for key, value in song.items() if key not in ('file', 'bpmHint')}
    return {**meta, 'bpm': bpm, 'firstBeat': round(first_beat, 4), 'steps': STEPS, 'beats': total_beats, 'audioSeconds': round(duration, 2),
            'beatTimes': [round(float(time), 4) for time in beat_times], 'melody': melody, 'nudges': nudges}


songs = [result for result in (analyze(song) for song in SONGS) if result]
header = ('// 자동 생성 파일: python3 scripts/analyze-audio.py\n'
          '// AI 생성 음원의 박·온셋 분석 결과. melody = [앞 음과의 간격, 길이, 키 사운드 음높이] 반복, 단위 1/%d박\n'
          '// beatTimes = 박마다 음원 시각(초, 템포 지도) · nudges = 음마다 실제 소리 시각 - 격자 시각(ms)\n' % STEPS)
OUTPUT.write_text(header + 'export const AUDIO_SONG_DATA = ' + json.dumps(songs, ensure_ascii=False) + ';\n', encoding='utf-8')
print(f'wrote {OUTPUT} ({len(songs)} songs)')
