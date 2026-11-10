// '에러 구조 SOS' 모드 전용: 언어별로 자주 만나는 에러·예외 이름. 구조 대상의 절반이 이 이름을 달고 나온다.
import { getTokenPool } from './tokens.js';

export const ERROR_TOKENS = Object.freeze({
  javascript: ['TypeError', 'ReferenceError', 'SyntaxError', 'RangeError', 'URIError', 'AggregateError', 'ECONNREFUSED',
    'ETIMEDOUT', 'ENOENT', 'CORS error', 'NaN', 'Unhandled rejection'],
  typescript: ['TS2322', 'TS2339', 'TS7006', 'TS2345', 'TS18048', 'TypeError', 'strictNullChecks', 'implicit any',
    'never', 'Type is not assignable'],
  python: ['KeyError', 'ValueError', 'IndexError', 'TypeError', 'NameError', 'AttributeError', 'ImportError',
    'ZeroDivisionError', 'RecursionError', 'StopIteration', 'IndentationError', 'ModuleNotFoundError'],
  java: ['NullPointerException', 'ClassCastException', 'OutOfMemoryError', 'StackOverflowError', 'IOException',
    'IllegalStateException', 'ArithmeticException', 'NumberFormatException'],
  c: ['segfault', 'Segmentation fault', 'SIGSEGV', 'SIGABRT', 'double free', 'buffer overflow', 'stack smashing',
    'core dumped', 'errno', 'memory leak'],
  cpp: ['std::bad_alloc', 'std::out_of_range', 'undefined reference', 'dangling pointer', 'SIGSEGV', 'use after free',
    'std::runtime_error', 'pure virtual call'],
  csharp: ['NullReferenceException', 'InvalidCastException', 'ArgumentException', 'FormatException', 'TimeoutException',
    'KeyNotFoundException', 'StackOverflowException'],
  go: ['panic:', 'nil pointer', 'deadlock!', 'index out of range', 'context canceled', 'data race', 'all goroutines asleep'],
  rust: ['panicked at', 'borrow checker', 'E0382', 'E0499', 'E0502', 'E0308', 'unwrap on None', 'lifetime mismatch'],
  kotlin: ['NullPointerException', 'ClassCastException', 'NoSuchElementException', 'lateinit', 'IllegalStateException',
    'ConcurrentModification'],
  swift: ['Fatal error', 'EXC_BAD_ACCESS', 'unexpectedly nil', 'Index out of range', 'SIGABRT', 'retain cycle',
    'force unwrap'],
  sql: ['deadlock detected', 'ORA-00942', 'ERROR 1064', 'syntax error', 'duplicate key', 'lock timeout',
    'SQLSTATE 23505', 'division by zero']
});

const ERROR_SHARE = 0.5;

// 문법 토큰 풀(가중치 합 1)에 에러 이름을 같은 비중으로 섞는다. 에러 이름 1개 = ERROR_SHARE / 개수.
export function getRescueTokenPool(languageKey) {
  const base = getTokenPool(languageKey);
  const errors = ERROR_TOKENS[languageKey] ?? [];
  if (!errors.length) return base;
  const baseTexts = new Set(base.map(token => token.text));
  const uniqueErrors = errors.filter(text => !baseTexts.has(text));
  return [
    ...base.map(token => ({ ...token, weight: token.weight * (1 - ERROR_SHARE) })),
    ...uniqueErrors.map(text => ({ text, kind: 'error', weight: ERROR_SHARE / uniqueErrors.length }))
  ];
}
