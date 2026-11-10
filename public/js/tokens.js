// 토큰 사전의 공개 창구. 실제 목록은 scripts/generate-tokens.mjs가 highlight.js + tree-sitter 문법 +
// 직접 고른 목록(scripts/token-sources.mjs)을 합쳐 만든 tokens.generated.js에 있다.
import { GENERATED_LANGUAGES, TOKEN_SOURCE_VERSIONS } from './tokens.generated.js';

// 종류별 표시 색. 에디터 문법 강조와 같은 감각으로 '무엇을 치고 있는지'를 함께 익히게 한다.
export const TOKEN_KINDS = Object.freeze({
  keyword:   { label: 'keyword',   color: '#c792ea' },
  type:      { label: 'type',      color: '#7fdbca' },
  builtin:   { label: 'builtin',   color: '#82aaff' },
  operator:  { label: 'operator',  color: '#ffcb6b' },
  literal:   { label: 'literal',   color: '#f78c6c' },
  decorator: { label: 'decorator', color: '#ff79c6' },
  directive: { label: 'directive', color: '#c3e88d' },
  error:     { label: 'error',     color: '#ff6b81' }
});

// 종류별 출제 비율. 언어마다 종류별 토큰 수가 크게 달라도(SQL keyword 159개 vs operator 6개)
// 한 종류만 쏟아지지 않도록, 토큰 수가 아니라 종류 단위로 비율을 고정한다.
export const KIND_WEIGHTS = Object.freeze({
  keyword: 0.34, builtin: 0.22, type: 0.14, operator: 0.12, literal: 0.06, decorator: 0.06, directive: 0.06
});

export const LANGUAGES = GENERATED_LANGUAGES;
export const LANGUAGE_KEYS = Object.freeze(Object.keys(LANGUAGES));
export { TOKEN_SOURCE_VERSIONS };

// 언어의 토큰을 {text, kind, weight} 목록으로 펼친다. 각 종류의 비율을 그 종류의 토큰 수로 나눠
// 토큰 하나의 가중치로 쓰고, 언어에 없는 종류의 몫은 나머지 종류에 비례 배분된다. O(n)
export function getTokenPool(languageKey) {
  const language = LANGUAGES[languageKey];
  if (!language) throw new Error(`unknown language: ${languageKey}`);
  const presentKinds = Object.entries(language.groups).filter(([, texts]) => texts.length > 0);
  const totalWeight = presentKinds.reduce((sum, [kind]) => sum + (KIND_WEIGHTS[kind] ?? 0), 0) || 1;
  return presentKinds.flatMap(([kind, texts]) => {
    const weight = (KIND_WEIGHTS[kind] ?? 0) / totalWeight / texts.length;
    return texts.map(text => ({ text, kind, weight }));
  });
}
