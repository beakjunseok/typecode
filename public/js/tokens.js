// 토큰 종류별 표시 색. 에디터 문법 강조와 같은 감각으로 '무엇을 치고 있는지'를 함께 익히게 한다.
export const TOKEN_KINDS = Object.freeze({
  keyword:   { label: 'keyword',   color: '#c792ea' },
  type:      { label: 'type',      color: '#7fdbca' },
  builtin:   { label: 'builtin',   color: '#82aaff' },
  operator:  { label: 'operator',  color: '#ffcb6b' },
  literal:   { label: 'literal',   color: '#f78c6c' },
  decorator: { label: 'decorator', color: '#ff79c6' },
  directive: { label: 'directive', color: '#c3e88d' }
});

export const LANGUAGES = Object.freeze({
  javascript: { label: 'JavaScript', file: 'main.js', groups: {
    keyword: ['const', 'let', 'var', 'function', 'return', 'async', 'await', 'class', 'extends', 'import', 'export',
      'default', 'from', 'new', 'this', 'typeof', 'instanceof', 'try', 'catch', 'finally', 'throw', 'switch', 'case',
      'break', 'continue', 'yield', 'delete'],
    literal: ['undefined', 'null', 'true', 'false'],
    operator: ['=>', '===', '!==', '?.', '??', '...', '&&', '||', '**'],
    builtin: ['console.log()', 'Promise.all()', 'JSON.parse()', 'JSON.stringify()', 'Array.from()', 'Object.keys()',
      'setTimeout()', 'addEventListener()', 'querySelector()', '.map()', '.filter()', '.reduce()', '.forEach()'],
    type: ['Symbol', 'Map', 'Set', 'Promise', 'Error']
  }},
  python: { label: 'Python', file: 'main.py', groups: {
    keyword: ['def', 'return', 'lambda', 'yield', 'import', 'from', 'as', 'class', 'if', 'elif', 'else', 'while', 'for',
      'in', 'not', 'and', 'or', 'is', 'with', 'try', 'except', 'finally', 'raise', 'pass', 'global', 'nonlocal', 'async', 'await'],
    literal: ['None', 'True', 'False', '"__main__"', 'f"{name}"'],
    operator: ['**', '//', '->', ':=', '**kwargs', '*args'],
    builtin: ['print()', 'len()', 'range()', 'enumerate()', 'zip()', 'isinstance()', 'sorted()', 'open()', 'dict.get()',
      "''.join()", '__init__', '__name__', 'self'],
    type: ['list[int]', 'dict[str, int]', 'tuple', 'Optional[str]'],
    decorator: ['@property', '@staticmethod', '@dataclass']
  }},
  java: { label: 'Java', file: 'Main.java', groups: {
    keyword: ['public', 'private', 'protected', 'static', 'final', 'void', 'class', 'interface', 'extends', 'implements',
      'new', 'return', 'this', 'super', 'try', 'catch', 'finally', 'throw', 'throws', 'instanceof', 'synchronized',
      'record', 'var', 'enum', 'switch', 'case', 'default', 'abstract', 'package', 'import'],
    type: ['int', 'long', 'double', 'boolean', 'String', 'List<String>', 'Map<String, Integer>', 'Optional<T>'],
    literal: ['null', 'true', 'false'],
    builtin: ['System.out.println()', 'new ArrayList<>()', 'new HashMap<>()', '.stream()', '.collect()', 'Objects.equals()'],
    decorator: ['@Override', '@FunctionalInterface'],
    operator: ['->', '::', '!=', '==', '&&']
  }},
  c: { label: 'C', file: 'main.c', groups: {
    keyword: ['const', 'static', 'struct', 'typedef', 'enum', 'union', 'sizeof', 'return', 'if', 'else', 'while', 'for',
      'do', 'break', 'continue', 'switch', 'case', 'default', 'extern', 'volatile'],
    type: ['int', 'char', 'float', 'double', 'void', 'long', 'unsigned', 'size_t', 'int *', 'char **', 'FILE *'],
    directive: ['#include', '#define', '#ifndef', '<stdio.h>', '<stdlib.h>'],
    builtin: ['malloc()', 'free()', 'printf()', 'scanf()', 'strlen()', 'memcpy()', 'fopen()', 'int main(void)'],
    operator: ['->', '&&', '||', '!=', '==', '++', '--', '<<'],
    literal: ['NULL', 'EOF']
  }},
  go: { label: 'Go', file: 'main.go', groups: {
    keyword: ['func', 'package', 'import', 'var', 'const', 'type', 'struct', 'interface', 'map', 'chan', 'go', 'defer',
      'select', 'range', 'return', 'if', 'else', 'for', 'switch', 'case', 'default', 'break', 'continue', 'fallthrough', 'goto'],
    literal: ['nil', 'true', 'false'],
    operator: [':=', '<-', '...', '!=', '&&'],
    builtin: ['make()', 'append()', 'len()', 'cap()', 'new()', 'fmt.Println()', 'err != nil', 'func main()', 'package main'],
    type: ['[]byte', 'error', 'string', 'int64', 'any', 'context.Context', 'sync.WaitGroup']
  }},
  rust: { label: 'Rust', file: 'main.rs', groups: {
    keyword: ['fn', 'let', 'mut', 'const', 'static', 'struct', 'enum', 'impl', 'trait', 'pub', 'use', 'mod', 'crate',
      'self', 'Self', 'super', 'match', 'if', 'else', 'loop', 'while', 'for', 'in', 'return', 'break', 'continue', 'move',
      'ref', 'async', 'await', 'dyn', 'where', 'unsafe'],
    type: ['Option<T>', 'Result<T, E>', 'Vec<i32>', '&str', 'String', 'i32', 'u64', '&mut'],
    literal: ['None', 'Some()', 'Ok()', 'Err()'],
    builtin: ['String::new()', 'println!()', 'vec![]', '.unwrap()', '.iter()', '.collect()'],
    operator: ['?', '->', '=>', '::', '..='],
    decorator: ['#[derive(Debug)]', '#[test]']
  }},
  sql: { label: 'SQL', file: 'query.sql', groups: {
    keyword: ['SELECT', 'FROM', 'WHERE', 'LEFT JOIN', 'INNER JOIN', 'ON', 'GROUP BY', 'ORDER BY', 'HAVING', 'LIMIT',
      'OFFSET', 'INSERT INTO', 'VALUES', 'UPDATE', 'SET', 'DELETE FROM', 'WITH', 'CASE', 'WHEN', 'THEN', 'END',
      'DISTINCT', 'UNION ALL', 'AS', 'DESC', 'ASC', 'BEGIN', 'COMMIT', 'ROLLBACK'],
    directive: ['CREATE TABLE', 'ALTER TABLE', 'DROP TABLE', 'CREATE INDEX', 'PRIMARY KEY', 'FOREIGN KEY', 'REFERENCES',
      'NOT NULL', 'DEFAULT', 'UNIQUE'],
    builtin: ['COUNT(*)', 'SUM()', 'AVG()', 'MAX()', 'MIN()', 'COALESCE()', 'NOW()'],
    operator: ['AND', 'OR', 'IN', 'BETWEEN', 'LIKE', 'IS NULL', '<>']
  }}
});

export const LANGUAGE_KEYS = Object.freeze(Object.keys(LANGUAGES));

// 언어의 분류별 토큰을 {text, kind} 목록으로 펼친다. 토큰 수 n에 대해 O(n)
export function getTokenPool(languageKey) {
  const language = LANGUAGES[languageKey];
  if (!language) throw new Error(`unknown language: ${languageKey}`);
  return Object.entries(language.groups).flatMap(([kind, texts]) => texts.map(text => ({ text, kind })));
}
