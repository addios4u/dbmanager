import { describe, it, expect } from 'vitest';
import { splitSqlStatements } from '@dbmanager/shared';

describe('splitSqlStatements', () => {
  // --- 기본 케이스 ---
  it('빈 문자열은 빈 배열을 반환한다', () => {
    expect(splitSqlStatements('')).toEqual([]);
  });

  it('공백/줄바꿈만 있으면 빈 배열을 반환한다', () => {
    expect(splitSqlStatements('   \n\t  ')).toEqual([]);
  });

  it('세미콜론 없는 단일 스테이트먼트를 반환한다', () => {
    expect(splitSqlStatements('SELECT 1')).toEqual(['SELECT 1']);
  });

  it('세미콜론 있는 단일 스테이트먼트를 반환한다', () => {
    expect(splitSqlStatements('SELECT 1;')).toEqual(['SELECT 1']);
  });

  it('복수 스테이트먼트를 분리한다', () => {
    expect(splitSqlStatements('SELECT 1; SELECT 2; SELECT 3')).toEqual([
      'SELECT 1',
      'SELECT 2',
      'SELECT 3',
    ]);
  });

  it('연속된 세미콜론은 빈 스테이트먼트를 생성하지 않는다', () => {
    expect(splitSqlStatements('SELECT 1;; SELECT 2')).toEqual(['SELECT 1', 'SELECT 2']);
  });

  it('마지막 세미콜론 이후 공백을 무시한다', () => {
    expect(splitSqlStatements('SELECT 1;   ')).toEqual(['SELECT 1']);
  });

  // --- 문자열 리터럴 ---
  it("작은따옴표 내부의 세미콜론을 무시한다", () => {
    expect(splitSqlStatements("SELECT 'hello; world'; SELECT 2")).toEqual([
      "SELECT 'hello; world'",
      'SELECT 2',
    ]);
  });

  it('큰따옴표 내부의 세미콜론을 무시한다 (MySQL 식별자)', () => {
    expect(splitSqlStatements('SELECT "col;name" FROM t; SELECT 2')).toEqual([
      'SELECT "col;name" FROM t',
      'SELECT 2',
    ]);
  });

  it("작은따옴표 이스케이프 '' 를 올바르게 처리한다", () => {
    expect(splitSqlStatements("SELECT 'it''s a test; here'; SELECT 2")).toEqual([
      "SELECT 'it''s a test; here'",
      'SELECT 2',
    ]);
  });

  // --- 코멘트 ---
  it('-- 라인 코멘트 내부의 세미콜론을 무시한다', () => {
    // 세미콜론이 코멘트 안에만 있으므로 전체가 하나의 스테이트먼트
    expect(splitSqlStatements('SELECT 1 -- this; is a comment\nSELECT 2')).toEqual([
      'SELECT 1 -- this; is a comment\nSELECT 2',
    ]);
  });

  it('-- 라인 코멘트 뒤 세미콜론으로 스테이트먼트를 분리한다', () => {
    expect(splitSqlStatements('SELECT 1; -- comment\nSELECT 2')).toEqual([
      'SELECT 1',
      '-- comment\nSELECT 2',
    ]);
  });

  it('/* 블록 코멘트 */ 내부의 세미콜론을 무시한다', () => {
    expect(splitSqlStatements('SELECT /* semi;colon */ 1; SELECT 2')).toEqual([
      'SELECT /* semi;colon */ 1',
      'SELECT 2',
    ]);
  });

  it('-- 코멘트만 있는 입력은 빈 배열을 반환한다', () => {
    expect(splitSqlStatements('-- just a comment\n-- another comment')).toEqual([]);
  });

  // --- PostgreSQL $$ 달러 쿼트 ---
  it('$$ 달러 쿼트 내부의 세미콜론을 무시한다', () => {
    const sql = `CREATE FUNCTION f() RETURNS void AS $$
BEGIN
  RAISE NOTICE 'hello; world';
END;
$$ LANGUAGE plpgsql`;
    expect(splitSqlStatements(sql)).toEqual([sql]);
  });

  it('$tag$ 이름 있는 달러 쿼트를 처리한다', () => {
    const sql = `CREATE FUNCTION f() RETURNS void AS $body$
BEGIN
  RAISE NOTICE 'test; value';
END;
$body$ LANGUAGE plpgsql`;
    expect(splitSqlStatements(sql)).toEqual([sql]);
  });

  it('유효하지 않은 달러 쿼트 태그(공백 포함)를 리터럴로 처리한다', () => {
    // "$ + $" 처럼 태그가 유효하지 않으면 달러 쿼트로 인식하지 않는다
    const result = splitSqlStatements('SELECT $ + $; SELECT 2');
    expect(result).toEqual(['SELECT $ + $', 'SELECT 2']);
  });

  it('달러 쿼트 이후에 오는 스테이트먼트를 분리한다', () => {
    const fn = `CREATE FUNCTION f() RETURNS void AS $$ BEGIN END; $$ LANGUAGE plpgsql`;
    const sql = `${fn};\nCOMMENT ON FUNCTION f() IS 'desc'`;
    const result = splitSqlStatements(sql);
    expect(result.length).toBe(2);
    expect(result[0]).toBe(fn);
    expect(result[1]).toBe("COMMENT ON FUNCTION f() IS 'desc'");
  });

  // --- PostgreSQL 실제 사용 케이스 ---
  it('CREATE TABLE + 여러 COMMENT ON 스테이트먼트를 분리한다', () => {
    const sql = `
CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL
);
COMMENT ON TABLE users IS 'User accounts';
COMMENT ON COLUMN users.id IS 'Primary key';
COMMENT ON COLUMN users.name IS 'Display name';
    `.trim();
    const result = splitSqlStatements(sql);
    expect(result.length).toBe(4);
    expect(result[0]).toContain('CREATE TABLE');
    expect(result[1]).toBe("COMMENT ON TABLE users IS 'User accounts'");
    expect(result[2]).toBe("COMMENT ON COLUMN users.id IS 'Primary key'");
    expect(result[3]).toBe("COMMENT ON COLUMN users.name IS 'Display name'");
  });

  // --- 멀티라인 스테이트먼트 ---
  it('멀티라인 스테이트먼트를 trim 해서 반환한다', () => {
    const sql = `
SELECT
  id,
  name
FROM users
WHERE id = 1
    `;
    expect(splitSqlStatements(sql)).toEqual([
      'SELECT\n  id,\n  name\nFROM users\nWHERE id = 1',
    ]);
  });
});
