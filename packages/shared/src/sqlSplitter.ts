/**
 * SQL 텍스트를 개별 스테이트먼트 배열로 분리한다.
 *
 * 처리하는 케이스:
 * - 문자열 리터럴 내부의 ; 무시 ('...' / "...")
 * - -- 라인 코멘트 내부의 ; 무시
 * - /* 블록 코멘트 *\/ 내부의 ; 무시
 * - PostgreSQL $$ 달러 쿼트 내부의 ; 무시
 * - 빈 스테이트먼트 필터링
 */
export function splitSqlStatements(sql: string): string[] {
  const statements: string[] = [];
  let current = '';
  let i = 0;

  while (i < sql.length) {
    const ch = sql[i]!;

    // -- 라인 코멘트
    if (ch === '-' && sql[i + 1] === '-') {
      const end = sql.indexOf('\n', i);
      if (end === -1) {
        current += sql.slice(i);
        i = sql.length;
      } else {
        current += sql.slice(i, end + 1);
        i = end + 1;
      }
      continue;
    }

    // /* 블록 코멘트 */
    if (ch === '/' && sql[i + 1] === '*') {
      const end = sql.indexOf('*/', i + 2);
      if (end === -1) {
        current += sql.slice(i);
        i = sql.length;
      } else {
        current += sql.slice(i, end + 2);
        i = end + 2;
      }
      continue;
    }

    // PostgreSQL $$ 달러 쿼트 ($$...$$, $tag$...$tag$)
    // 태그는 반드시 $[A-Za-z_][A-Za-z0-9_]*$ 또는 $$ 형식이어야 한다
    if (ch === '$') {
      const tagEnd = sql.indexOf('$', i + 1);
      if (tagEnd !== -1) {
        const tagBody = sql.slice(i + 1, tagEnd);
        const isValidTag = tagBody === '' || /^[A-Za-z_][A-Za-z0-9_]*$/.test(tagBody);
        if (isValidTag) {
          const tag = sql.slice(i, tagEnd + 1); // e.g. "$$" or "$body$"
          const closeIdx = sql.indexOf(tag, tagEnd + 1);
          if (closeIdx !== -1) {
            current += sql.slice(i, closeIdx + tag.length);
            i = closeIdx + tag.length;
            continue;
          }
        }
      }
    }

    // 문자열 리터럴 '...' (이스케이프: '' 또는 \')
    if (ch === "'") {
      let j = i + 1;
      while (j < sql.length) {
        if (sql[j] === '\\') {
          j += 2;
        } else if (sql[j] === "'" && sql[j + 1] === "'") {
          j += 2;
        } else if (sql[j] === "'") {
          j++;
          break;
        } else {
          j++;
        }
      }
      current += sql.slice(i, j);
      i = j;
      continue;
    }

    // 문자열 리터럴 "..." (MySQL 식별자 또는 문자열)
    if (ch === '"') {
      let j = i + 1;
      while (j < sql.length) {
        if (sql[j] === '\\') {
          j += 2;
        } else if (sql[j] === '"' && sql[j + 1] === '"') {
          j += 2;
        } else if (sql[j] === '"') {
          j++;
          break;
        } else {
          j++;
        }
      }
      current += sql.slice(i, j);
      i = j;
      continue;
    }

    // 스테이트먼트 종료
    if (ch === ';') {
      const trimmed = current.trim();
      if (trimmed && isNonEmptyStatement(trimmed)) {
        statements.push(trimmed);
      }
      current = '';
      i++;
      continue;
    }

    current += ch;
    i++;
  }

  // 마지막 ; 없는 스테이트먼트 처리
  const remaining = current.trim();
  if (remaining && isNonEmptyStatement(remaining)) {
    statements.push(remaining);
  }

  return statements;
}

/**
 * 코멘트와 공백을 제거한 후 실제 SQL 내용이 있는지 확인한다.
 * 코멘트만으로 이루어진 스테이트먼트는 DB에 전달하지 않는다.
 */
function isNonEmptyStatement(s: string): boolean {
  // 라인 코멘트 제거
  let cleaned = s.replace(/--[^\n]*/g, '');
  // 블록 코멘트 제거
  cleaned = cleaned.replace(/\/\*[\s\S]*?\*\//g, '');
  return cleaned.trim().length > 0;
}
