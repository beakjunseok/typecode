// 토큰 추출 설정: 언어마다 어떤 문법 소스를 쓰고, 무엇을 빼고, 무엇을 직접 보탤지 정의한다.
// highlight.js  → keyword · type · builtin · literal
// tree-sitter   → keyword 검증(실제 문법에 있는 것만 남김) + operator
// curated       → 소스에 없는 관용구·데코레이터·지시문·여러 단어 토큰

const C_LIKE_COMMENTS = ['//', '/*', '*/'];

export const LANGUAGE_SOURCES = [
  {
    key: 'javascript', label: 'JavaScript', file: 'main.js',
    hljs: 'javascript', treeSitter: 'tree-sitter-javascript/src/node-types.json',
    excludeWords: ['meta', 'target'],
    hljsKinds: { keyword: 'keyword', built_in: 'builtin', literal: 'literal', 'variable.language': 'keyword' },
    excludeOperators: ['</', '/>'],
    curated: {
      builtin: ['console.log()', 'Promise.all()', 'JSON.parse()', 'JSON.stringify()', 'Array.from()', 'Object.keys()',
        'addEventListener()', 'querySelector()', '.map()', '.filter()', '.reduce()', '.forEach()', 'fetch()'],
      operator: ['?.']
    }
  },
  {
    key: 'typescript', label: 'TypeScript', file: 'main.ts',
    hljs: 'typescript', treeSitter: 'tree-sitter-typescript/typescript/src/node-types.json',
    excludeWords: ['meta', 'target'],
    hljsKinds: { keyword: 'keyword', built_in: 'builtin', literal: 'literal', 'variable.language': 'keyword' },
    excludeOperators: ['+?:', '-?:', '{|', '|}'],
    curated: {
      type: ['Record<string, number>', 'Partial<T>', 'Promise<void>', 'string[]', 'Readonly<T>', 'unknown', 'never'],
      builtin: ['console.log()', 'Array.isArray()', 'Object.entries()', 'as const'],
      decorator: ['@Injectable()', '@Component()']
    }
  },
  {
    key: 'python', label: 'Python', file: 'main.py',
    hljs: 'python', treeSitter: 'tree-sitter-python/src/node-types.json',
    hljsKinds: { keyword: 'keyword', built_in: 'builtin', literal: 'literal', type: 'type' },
    commentOperators: [],
    curated: {
      builtin: ['__init__', '__name__', 'self', "''.join()", 'dict.get()', 'print()', 'len()', 'range()', 'enumerate()'],
      literal: ['"__main__"', 'f"{name}"'],
      operator: ['**kwargs', '*args'],
      type: ['list[int]', 'dict[str, int]'],
      decorator: ['@property', '@staticmethod', '@dataclass', '@classmethod']
    }
  },
  {
    key: 'java', label: 'Java', file: 'Main.java',
    hljs: 'java', treeSitter: 'tree-sitter-java/src/node-types.json',
    // 미사용 예약어 + module-info.java 전용 단어
    excludeWords: ['const', 'goto', 'strictfp', 'open', 'opens', 'provides', 'to', 'transitive', 'uses', 'with'],
    hljsKinds: { keyword: 'keyword', type: 'type', literal: 'literal', built_in: 'keyword' },
    curated: {
      type: ['String', 'List<String>', 'Map<String, Integer>', 'Optional<T>'],
      builtin: ['System.out.println()', 'new ArrayList<>()', 'new HashMap<>()', '.stream()', '.collect()', 'Objects.equals()'],
      decorator: ['@Override', '@FunctionalInterface', '@Deprecated']
    }
  },
  {
    key: 'c', label: 'C', file: 'main.c',
    // C의 built_in 목록은 C++ 표준 라이브러리 이름이 섞여 있어 쓰지 않는다.
    hljs: 'c', treeSitter: 'tree-sitter-c/src/node-types.json',
    excludeWords: ['fortran'],
    hljsKinds: { keyword: 'keyword', type: 'type', literal: 'literal' },
    excludeOperators: ['::', '[[', ']]'],
    curated: {
      type: ['size_t', 'int *', 'char **', 'FILE *', 'uint8_t'],
      directive: ['#include', '#define', '#ifndef', '#endif', '<stdio.h>', '<stdlib.h>'],
      builtin: ['malloc()', 'free()', 'printf()', 'scanf()', 'strlen()', 'memcpy()', 'fopen()', 'int main(void)']
    }
  },
  {
    key: 'cpp', label: 'C++', file: 'main.cpp',
    hljs: 'cpp', treeSitter: 'tree-sitter-cpp/src/node-types.json',
    hljsKinds: { keyword: 'keyword', type: 'type', literal: 'literal' },
    excludeWords: [/^atomic_/, /^transaction_safe/, 'synchronized', 'reflexpr'],
    excludeOperators: ['[[', ']]'],
    curated: {
      builtin: ['std::vector<int>', 'std::string', 'std::cout', 'std::move()', 'std::make_unique<T>()', '.push_back()',
        'std::sort()', 'std::endl'],
      directive: ['#include <vector>', '#include <iostream>', '#pragma once', 'using namespace std;']
    }
  },
  {
    key: 'csharp', label: 'C#', file: 'Program.cs',
    hljs: 'csharp', treeSitter: 'tree-sitter-c-sharp/src/node-types.json',
    // #pragma/#nullable 옵션, 호출 규약, 특성 대상 이름
    excludeWords: ['Cdecl', 'Fastcall', 'Stdcall', 'Thiscall', 'annotations', 'assembly', 'checksum', 'disable', 'enable',
      'hidden', 'restore', 'warning', 'warnings', 'typevar', 'field', 'method', 'param', 'property', 'type', 'module', 'managed'],
    hljsKinds: { keyword: 'keyword', built_in: 'type', literal: 'literal' },
    curated: {
      builtin: ['Console.WriteLine()', 'string.IsNullOrEmpty()', '.Where()', '.Select()', '.ToList()', 'async Task'],
      type: ['List<int>', 'Dictionary<string, int>', 'Task<T>'],
      decorator: ['[HttpGet]', '[Serializable]', '[Fact]']
    }
  },
  {
    key: 'go', label: 'Go', file: 'main.go',
    hljs: 'go', treeSitter: 'tree-sitter-go/src/node-types.json',
    hljsKinds: { keyword: 'keyword', type: 'type', literal: 'literal', built_in: 'builtin' },
    curated: {
      builtin: ['fmt.Println()', 'err != nil', 'func main()', 'package main', 'context.Context', 'sync.WaitGroup'],
      type: ['[]byte', 'map[string]int', 'any']
    }
  },
  {
    key: 'rust', label: 'Rust', file: 'main.rs',
    hljs: 'rust', treeSitter: 'tree-sitter-rust/src/node-types.json',
    // 미사용 예약어 + macro_rules! 조각 지정자
    excludeWords: ['abstract', 'become', 'box', 'do', 'final', 'macro', 'override', 'priv', 'typeof', 'unsized', 'virtual',
      'try', 'yield', 'gen', 'block', 'expr', 'expr_2021', 'ident', 'item', 'lifetime', 'literal', 'meta', 'pat', 'pat_param',
      'path', 'stmt', 'tt', 'ty', 'vis'],
    hljsKinds: { keyword: 'keyword', type: 'type', literal: 'literal', built_in: 'builtin' },
    curated: {
      type: ['Option<T>', 'Result<T, E>', 'Vec<i32>', '&str', '&mut'],
      builtin: ['String::new()', 'println!()', 'vec![]', '.unwrap()', '.iter()', '.collect()'],
      operator: ['?'],
      decorator: ['#[derive(Debug)]', '#[test]']
    }
  },
  {
    key: 'kotlin', label: 'Kotlin', file: 'Main.kt',
    hljs: 'kotlin', treeSitter: 'tree-sitter-kotlin/src/node-types.json',
    // 어노테이션 사용 지점 대상 이름
    excludeWords: ['delegate', 'field', 'file', 'param', 'property', 'receiver', 'setparam', 'value'],
    hljsKinds: { keyword: 'keyword', built_in: 'type', literal: 'literal' },
    excludeOperators: ['#!'],
    curated: {
      builtin: ['println()', 'listOf()', 'mapOf()', 'mutableListOf()', '.let { }', '?.let', 'fun main()'],
      decorator: ['@JvmStatic', '@Composable']
    }
  },
  {
    key: 'swift', label: 'Swift', file: 'main.swift',
    hljs: 'swift', treeSitter: 'tree-sitter-swift/src/node-types.json',
    // #if 컴파일 조건·리터럴 지시자 이름
    excludeWords: ['Protocol', 'Type', 'arch', 'available', 'canImport', 'colorLiteral', 'column', 'compiler', 'delegate',
      'dsohandle', 'externalMacro', 'file', 'fileID', 'fileLiteral', 'filePath', 'function', 'imageLiteral', 'keyPath', 'line',
      'os', 'param', 'property', 'receiver', 'selector', 'setparam', 'swift', 'targetEnvironment', 'unavailable',
      /^#(colorLiteral|column|dsohandle|file|fileID|fileLiteral|filePath|function|imageLiteral|keyPath|line|selector|sourceLocation)$/],
    hljsKinds: { keyword: 'keyword', literal: 'literal' },
    curated: {
      builtin: ['print()', 'guard let', 'if let', 'DispatchQueue.main.async', '.map { }'],
      type: ['String', 'Int', 'Bool', '[String: Int]', 'String?'],
      decorator: ['@State', '@MainActor', '@escaping', '@Published']
    }
  },
  {
    key: 'sql', label: 'SQL', file: 'query.sql',
    // hljs SQL 키워드는 289개라 tree-sitter 문법에 있는 것만 남기고, 관례대로 대문자로 쓴다.
    hljs: 'sql', treeSitter: '@derekstride/tree-sitter-sql/src/node-types.json',
    hljsKinds: { keyword: 'keyword', type: 'type', built_in: 'builtin' },
    keywordStrategy: 'intersect',
    transform: 'upper',
    commentOperators: [],
    curated: {
      keyword: ['LEFT JOIN', 'INNER JOIN', 'GROUP BY', 'ORDER BY', 'INSERT INTO', 'DELETE FROM', 'UNION ALL', 'IS NULL', 'NOT NULL'],
      directive: ['CREATE TABLE', 'ALTER TABLE', 'DROP TABLE', 'CREATE INDEX', 'PRIMARY KEY', 'FOREIGN KEY', 'REFERENCES'],
      builtin: ['COUNT(*)', 'SUM()', 'AVG()', 'MAX()', 'MIN()', 'COALESCE()', 'NOW()'],
      literal: ['NULL', 'TRUE', 'FALSE']
    }
  }
];
