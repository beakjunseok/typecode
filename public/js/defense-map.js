// 컴퓨터 디펜스 길(맵): 점 목록 → 길 객체(위치 계산·길 위 판정·추천 자리), 그리고 판마다 다른 길을 만드는 생성기.
// 좌표는 들판을 0~1로 본 값. 길 끝은 항상 컴퓨터 바로 위(PATH_END)라 그림·가디언 위치가 그대로 맞는다

export const PATH_END = Object.freeze({ x: 0.5, y: 0.58 });

// 생성 규칙: 가로로 훑는 줄 수, 줄 사이 최소 간격(타워 놓을 틈 — 휴대폰 세로 화면에서도 타워 한 줄이 들어가게), 좌우 끝 범위, 전체 길이 범위
export const MAP_RULES = Object.freeze({
  rows: Object.freeze([2, 3]),
  firstRowY: Object.freeze([0.1, 0.2]),
  rowGap: 0.17,
  left: Object.freeze([0.07, 0.3]),
  right: Object.freeze([0.7, 0.93]),
  slantChance: 0.35,
  slant: 0.09,
  length: Object.freeze([1.7, 3.2]),
  attempts: 40
});

const MAP_NAMES = Object.freeze(['구불 회선', '우회 라우팅', '지그재그 버스', '역방향 프록시', '갈지자 케이블', '미로 서브넷', '나선 패킷로', '굽은 파이프라인', '꺾인 백본', '샛길 포트']);

// 타원 반지름으로 늘린 공간에서 점~선분 거리(1 미만이면 그 반지름 안). O(1)
function ellipseDistanceToSegment(point, from, to, radii) {
  const px = point.x / radii.x, py = point.y / radii.y;
  const ax = from.x / radii.x, ay = from.y / radii.y, bx = to.x / radii.x, by = to.y / radii.y;
  const dx = bx - ax, dy = by - ay;
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSquared)) : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

// 점 목록으로 길 객체를 만든다. clear = 길 판정 반지름, blocked(point) = 추천 자리에서 뺄 곳(컴퓨터 둘레 등).
// 구간 길이·표본·추천 후보를 한 번만 계산해 둔다. O(구간 + 격자 × 표본)
export function createDefensePath(points, { clear, blocked = () => false, name = '기본 회선', seed = null } = {}) {
  if (!Array.isArray(points) || points.length < 2) throw new Error('길은 점이 2개 이상 있어야 해요');
  const frozenPoints = Object.freeze(points.map(point => Object.freeze({ x: Number(point.x), y: Number(point.y) })));
  const segments = frozenPoints.slice(1).map((point, index) => {
    const from = frozenPoints[index];
    return { from, to: point, length: Math.hypot(point.x - from.x, point.y - from.y) };
  });
  const length = segments.reduce((sum, segment) => sum + segment.length, 0);

  // 길 위 비율(0~1) → 좌표. O(구간 수)
  const pointAt = progress => {
    let remaining = Math.max(0, Math.min(1, Number(progress) || 0)) * length;
    for (const segment of segments) {
      if (remaining <= segment.length) {
        const ratio = segment.length ? remaining / segment.length : 0;
        return { x: segment.from.x + (segment.to.x - segment.from.x) * ratio, y: segment.from.y + (segment.to.y - segment.from.y) * ratio };
      }
      remaining -= segment.length;
    }
    return { ...frozenPoints.at(-1) };
  };
  // 길 위(또는 길에 너무 가까운) 점인가. O(구간 수)
  const isOn = point => segments.some(segment => ellipseDistanceToSegment(point, segment.from, segment.to, clear) < 1);

  const samples = Array.from({ length: 80 }, (_, index) => pointAt(index / 79));
  // 키보드 추천 자리 후보: 0.07 간격 격자 중 길·막힌 곳을 피한 곳, 사거리(0.26) 안 길 표본이 많은 순
  const candidates = [];
  for (let y = 0.06; y <= 0.95; y += 0.07) {
    for (let x = 0.06; x <= 0.95; x += 0.07) {
      const point = { x: Math.round(x * 1000) / 1000, y: Math.round(y * 1000) / 1000 };
      if (isOn(point) || blocked(point)) continue;
      const coverage = samples.filter(sample => Math.hypot(sample.x - point.x, sample.y - point.y) <= 0.26).length;
      candidates.push({ ...point, coverage });
    }
  }
  candidates.sort((first, second) => second.coverage - first.coverage);
  return Object.freeze({ points: frozenPoints, segments, length, pointAt, isOn, samples, candidates: Object.freeze(candidates), name, seed });
}

const between = (random, [low, high]) => low + (high - low) * random();
const round3 = value => Math.round(value * 1000) / 1000;

// 줄 높이들: 첫 줄은 firstRowY 범위, 그 뒤는 최소 rowGap씩 띄우며 마지막 줄(PATH_END.y) 위에 들어가게. 안 되면 null
function rowHeights(random, count) {
  const last = PATH_END.y;
  const top = between(random, MAP_RULES.firstRowY);
  const room = last - top - MAP_RULES.rowGap * (count - 1);
  if (room < 0) return null;
  // 남는 여유를 무작위로 나눠 줄 사이에 더한다
  const shares = Array.from({ length: count - 1 }, () => random() + 0.2);
  const total = shares.reduce((sum, share) => sum + share, 0) || 1;
  const heights = [top];
  for (let index = 0; index < count - 2; index++) heights.push(heights.at(-1) + MAP_RULES.rowGap + room * shares[index] / total);
  heights.push(last);
  return heights;
}

// 판마다 다른 길: 위에서 들어와 좌우로 rows번 훑으며 내려가 PATH_END에서 끝난다.
// 줄끼리는 rowGap 이상 떨어지고, 줄 사이 연결은 가끔 비스듬하다. 한 줄은 다른 줄과 겹치지 않으니 길이 스스로 교차하지 않는다.
// 길이가 범위를 벗어나면 다시 뽑고, 끝내 안 되면 null(호출 쪽이 기본 길을 쓴다). O(attempts × rows)
export function generatePathPoints(random = Math.random) {
  for (let attempt = 0; attempt < MAP_RULES.attempts; attempt++) {
    const [minRows, maxRows] = MAP_RULES.rows;
    const rows = minRows + Math.floor(random() * (maxRows - minRows + 1));
    const heights = rowHeights(random, rows);
    if (!heights) continue;
    let x = round3(between(random, random() < 0.5 ? MAP_RULES.left : MAP_RULES.right));
    const points = [{ x, y: 0 }];
    for (let row = 0; row < rows - 1; row++) {
      const slanted = row > 0 && random() < MAP_RULES.slantChance;
      const entryX = slanted ? round3(Math.max(0.05, Math.min(0.95, x + (random() * 2 - 1) * MAP_RULES.slant))) : x;
      points.push({ x: entryX, y: round3(heights[row]) });
      x = round3(between(random, entryX < 0.5 ? MAP_RULES.right : MAP_RULES.left));
      points.push({ x, y: round3(heights[row]) });
    }
    points.push({ x, y: PATH_END.y }, { ...PATH_END });
    // 마지막 줄이 너무 짧으면(끝점 바로 위에서 내려오면) 굽이가 없어 밋밋하다
    if (Math.abs(x - PATH_END.x) < 0.15) continue;
    const length = points.slice(1).reduce((sum, point, index) => sum + Math.hypot(point.x - points[index].x, point.y - points[index].y), 0);
    if (length < MAP_RULES.length[0] || length > MAP_RULES.length[1]) continue;
    return points;
  }
  return null;
}

// 맵 이름(이름 목록 + 굽이 수). 같은 길이면 같은 이름
export function mapName(points, random = Math.random) {
  const turns = Math.max(1, points.length - 2);
  return `${MAP_NAMES[Math.floor(random() * MAP_NAMES.length)]} · ${turns}굽이`;
}
