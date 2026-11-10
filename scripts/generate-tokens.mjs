// highlight.js + tree-sitter 문법 + 직접 고른 목록을 합쳐 public/js/tokens.generated.js를 만든다.
// 사용: npm run grammars (최초 1회) → npm run tokens
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { LANGUAGE_SOURCES } from './token-sources.mjs';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const GRAMMAR_DIR = path.join(SCRIPT_DIR, 'grammars');
export const OUTPUT_PATH = path.join(SCRIPT_DIR, '..', 'public', 'js', 'tokens.generated.js');

const TYPEABLE = /^[\x21-\x7e](?:[\x20-\x7e]*[\x21-\x7e])?$/;
const WORD = /^[A-Za-z_][A-Za-z0-9_]*$/;
const MIN_LENGTH = 2;
const MAX_LENGTH = 28;
const MIN_TREE_SITTER_WORDS = 10;
const KIND_ORDER = ['keyword', 'type', 'builtin', 'operator', 'literal', 'decorator', 'directive'];

export function grammarsInstalled() {
  return existsSync(path.join(GRAMMAR_DIR, 'node_modules', 'highlight.js'));
}

function loadDependencies() {
  if (!grammarsInstalled()) throw new Error('문법 소스가 없습니다. 먼저 `npm run grammars`를 실행하세요.');
  const requireFromGrammars = createRequire(path.join(GRAMMAR_DIR, 'package.json'));
  const versionOf = name => requireFromGrammars(`${name}/package.json`).version;
  return { hljs: requireFromGrammars('highlight.js'), requireFromGrammars, versionOf };
}

// highlight.js 키워드 값은 배열 또는 공백 구분 문자열이고, 'as|0'처럼 가중치 접미사가 붙을 수 있다.
function readHljsKeywords(hljs, languageName) {
  const language = hljs.getLanguage(languageName);
  if (!language) throw new Error(`highlight.js에 ${languageName} 문법이 없습니다`);
  const keywords = typeof language.keywords === 'object' && language.keywords ? language.keywords : {};
  const result = {};
  for (const [kind, value] of Object.entries(keywords)) {
    if (kind.startsWith('$')) continue;
    const list = Array.isArray(value) ? value : String(value).split(/\s+/);
    result[kind] = list.map(item => String(item).replace(/\|\d+$/, '').trim()).filter(Boolean);
  }
  return result;
}

// tree-sitter node-types.json: 이름 없는 노드 = 문법이 실제로 쓰는 키워드·기호.
// SQL 문법은 키워드를 'keyword_select' 같은 이름 있는 노드로 두므로 접두사를 떼서 함께 모은다.
function readTreeSitterTokens(nodeTypes) {
  const words = new Set();
  const originalWords = new Set();
  const symbols = new Set();
  for (const node of nodeTypes) {
    if (node.named) {
      if (node.type.startsWith('keyword_')) words.add(node.type.slice('keyword_'.length).toLowerCase());
      continue;
    }
    if (WORD.test(node.type)) {
      words.add(node.type.toLowerCase());
      originalWords.add(node.type);
    } else if (TYPEABLE.test(node.type) && node.type.length >= MIN_LENGTH && !/[A-Za-z0-9_]/.test(node.type)) {
      symbols.add(node.type);
    }
  }
  return { words, originalWords, symbols };
}

function matchesAny(text, patterns = []) {
  return patterns.some(pattern => (pattern instanceof RegExp ? pattern.test(text) : pattern === text));
}

// 연산자 후보에서 주석·문자열·괄호 구분자를 뺀다.
function isUsableOperator(symbol, source) {
  if (/["'`\\]/.test(symbol)) return false;
  if (/[[\]{}()]/.test(symbol)) return false;
  if ((source.commentOperators ?? ['//', '/*', '*/']).includes(symbol)) return false;
  if (['/*', '*/'].includes(symbol)) return false;
  return !matchesAny(symbol, source.excludeOperators);
}

function isUsableWord(text, source) {
  return TYPEABLE.test(text) && text.length >= MIN_LENGTH && text.length <= MAX_LENGTH
    && !text.startsWith('_') && !matchesAny(text, source.excludeWords);
}

// 한 언어의 종류별 토큰 목록을 만든다. 같은 글자는 먼저 들어간 종류만 남긴다. O(n log n)
export function buildLanguage(source, { hljs, requireFromGrammars }) {
  const hljsKeywords = readHljsKeywords(hljs, source.hljs);
  const treeSitter = readTreeSitterTokens(JSON.parse(readFileSync(requireFromGrammars.resolve(source.treeSitter), 'utf8')));
  const canValidate = treeSitter.words.size >= MIN_TREE_SITTER_WORDS;
  const transform = text => (source.transform === 'upper' ? text.toUpperCase() : text);

  const groups = Object.fromEntries(KIND_ORDER.map(kind => [kind, new Set()]));
  const seen = new Set();
  const stats = { hljs: 0, treeSitter: 0, curated: 0, droppedByTreeSitter: [], addedByTreeSitter: [] };
  const intersect = source.keywordStrategy === 'intersect' && canValidate;
  const add = (kind, text, origin) => {
    if (seen.has(text)) return false;
    seen.add(text);
    groups[kind].add(text);
    stats[origin]++;
    return true;
  };

  for (const [hljsKind, kind] of Object.entries(source.hljsKinds)) {
    for (const raw of hljsKeywords[hljsKind] ?? []) {
      const text = transform(raw);
      if (!isUsableWord(text, source)) continue;
      if (intersect && kind === 'keyword' && hljsKind === 'keyword' && !treeSitter.words.has(raw.toLowerCase())) {
        stats.droppedByTreeSitter.push(text);
        continue;
      }
      add(kind, text, 'hljs');
    }
  }
  // 합집합 전략: hljs에 없고 tree-sitter 문법에만 있는 키워드를 보탠다(대소문자는 문법 원문 그대로).
  if (!intersect && source.addTreeSitterKeywords !== false) {
    for (const word of treeSitter.originalWords) {
      const text = transform(word);
      if (isUsableWord(text, source) && add('keyword', text, 'treeSitter')) stats.addedByTreeSitter.push(text);
    }
  }
  for (const symbol of treeSitter.symbols) {
    if (isUsableOperator(symbol, source)) add('operator', symbol, 'treeSitter');
  }
  for (const [kind, texts] of Object.entries(source.curated ?? {})) {
    if (!groups[kind]) throw new Error(`${source.key}: 알 수 없는 종류 ${kind}`);
    for (const text of texts) {
      if (!TYPEABLE.test(text)) throw new Error(`${source.key}: 입력할 수 없는 토큰 '${text}'`);
      add(kind, text, 'curated');
    }
  }

  const sortedGroups = {};
  for (const kind of KIND_ORDER) {
    if (groups[kind].size) sortedGroups[kind] = [...groups[kind]].sort((first, second) => first.localeCompare(second, 'en'));
  }
  return { language: { label: source.label, file: source.file, groups: sortedGroups }, stats };
}

export function buildAll() {
  const dependencies = loadDependencies();
  const languages = {};
  const report = {};
  const versions = { 'highlight.js': dependencies.versionOf('highlight.js') };
  for (const source of LANGUAGE_SOURCES) {
    const packageName = source.treeSitter.startsWith('@') ? source.treeSitter.split('/').slice(0, 2).join('/') : source.treeSitter.split('/')[0];
    versions[packageName] = dependencies.versionOf(packageName);
    const { language, stats } = buildLanguage(source, dependencies);
    languages[source.key] = language;
    report[source.key] = stats;
  }
  return { languages, versions, report };
}

export function renderModule({ languages, versions }) {
  const sourceLine = Object.entries(versions).map(([name, version]) => `${name}@${version}`).join(', ');
  return [
    '// 자동 생성 파일 — 직접 수정하지 말 것. scripts/token-sources.mjs를 고친 뒤 `npm run tokens`로 다시 만든다.',
    `// sources: ${sourceLine}`,
    `export const TOKEN_SOURCE_VERSIONS = ${JSON.stringify(versions, null, 2)};`,
    '',
    `export const GENERATED_LANGUAGES = ${JSON.stringify(languages, null, 2)};`,
    ''
  ].join('\n');
}

function main() {
  const result = buildAll();
  writeFileSync(OUTPUT_PATH, renderModule(result));
  for (const [key, stats] of Object.entries(result.report)) {
    const counts = Object.entries(result.languages[key].groups).map(([kind, list]) => `${kind} ${list.length}`).join(' · ');
    console.log(`${key.padEnd(11)} ${counts}`);
    console.log(`${''.padEnd(11)} 출처: hljs ${stats.hljs} · tree-sitter ${stats.treeSitter} · 직접 ${stats.curated}`);
    if (stats.addedByTreeSitter.length) console.log(`${''.padEnd(11)} tree-sitter가 보탠 키워드: ${stats.addedByTreeSitter.join(' ')}`);
    if (stats.droppedByTreeSitter.length) console.log(`${''.padEnd(11)} tree-sitter 문법에 없어 제외: ${stats.droppedByTreeSitter.length}개`);
  }
  console.log(`\n→ ${path.relative(process.cwd(), OUTPUT_PATH)}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  try {
    main();
  } catch (error) {
    console.error(`토큰 생성 실패: ${error.message}`);
    process.exitCode = 1;
  }
}
