# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

VS Code/Cursor용 데이터베이스 관리 익스텐션. MySQL, MariaDB, PostgreSQL, SQLite, Redis를 지원한다.
pnpm workspaces 기반 모노레포로, 3개 패키지로 구성된다.

## Monorepo Structure

```
packages/
├── shared/         # 공유 타입, 메시지 프로토콜 (vscode/react 의존성 없음)
├── extension/      # VS Code 익스텐션 호스트 (Node.js, CJS)
└── webview-ui/     # React 웹뷰 앱 (브라우저, IIFE)
```

빌드 순서: `shared` → `webview-ui` → `extension` (extension이 webview 빌드 결과물을 포함)

## Commands

```bash
pnpm install          # 의존성 설치
pnpm build            # 전체 빌드 (shared → webview-ui → extension)
pnpm dev              # watch 모드 개발
pnpm test             # Vitest 유닛 테스트 전체 실행
pnpm test:watch       # Vitest watch 모드
pnpm typecheck        # tsc --noEmit (전체 패키지)
pnpm lint             # ESLint
pnpm lint:fix         # ESLint --fix
pnpm format           # Prettier --write
pnpm package          # VSIX 패키징
```

단일 패키지 빌드/테스트:
```bash
pnpm --filter @dbmanager/shared build
pnpm --filter @dbmanager/webview-ui build
pnpm --filter ./packages/extension build
pnpm --filter ./packages/extension test
```

단일 테스트 파일 실행:
```bash
pnpm --filter ./packages/extension test src/adapters/__tests__/mysql.test.ts
```

디버깅: VS Code에서 F5 → Extension Development Host 실행.

## Architecture

### Extension ↔ Webview Communication

익스텐션과 웹뷰는 `postMessage`로만 통신한다. 공유 메모리 없음.
메시지 타입은 `@dbmanager/shared`의 discriminated union으로 정의:

- `WebviewMessage` — 웹뷰 → 익스텐션 (쿼리 실행, 연결 테스트, 스키마 요청 등)
- `ExtensionMessage` — 익스텐션 → 웹뷰 (쿼리 결과, 에러, 상태 동기화 등)

웹뷰가 마운트되면 `{ type: 'ready' }`를 보내고, 익스텐션이 전체 상태 스냅샷으로 응답한다.
새 메시지 타입을 추가할 때는 반드시 `packages/shared/src/messages.ts`에 먼저 정의한다.

### Database Adapter Pattern

`packages/extension/src/adapters/base.ts`에 정의된 인터페이스:

- `DatabaseAdapter` — SQL DB 공통 (MySQL, MariaDB, PostgreSQL, SQLite)
  - connect/disconnect/ping, execute/cancel, 스키마 조회(getTables, getColumns 등)
- `RedisAdapter` — Redis 전용 (SQL이 아니므로 별도 인터페이스)
  - connect/disconnect/ping, scan/get/set/del, type/ttl

MySQL과 MariaDB는 같은 `mysql2` 드라이버를 공유한다. MariaDB 어댑터는 MySQL을 상속하고 방언 차이만 오버라이드한다.

### Connection Management

- 비밀번호: `vscode.SecretStorage` (OS 키체인)
- 연결 설정: `vscode.ExtensionContext.globalState`
- 연결 ID: UUID v4
- 풀: MySQL/PG `connectionLimit: 5`, SQLite 단일 핸들, Redis 멀티플렉싱

### Explorer Sidebar

Explorer 사이드바에 "DBManager - Connections" 뷰를 등록한다.
Cursor Extension Development Host에서 `viewContainers.activitybar`가 동작하지 않는 버그가 있어
`explorer` 컨테이너를 사용한다.

package.json contributes 구조:
```jsonc
{
  "views": {
    "explorer": [
      { "id": "dbmanager.connections", "name": "DBManager - Connections" }
    ]
  }
}
```

### TreeView Hierarchy

Explorer 사이드바의 `dbmanager.connections` 뷰에 TreeDataProvider를 바인딩한다.
커넥션 클릭 시 자동 연결 후 하위 노드가 펼쳐진다 (lazy loading).

```
Connection Groups (사용자 정의 폴더)
  └─ Connection (MySQL/PG/SQLite/Redis)
       └─ Database
            └─ Schema (PG만)
                 ├─ Tables
                 │    └─ Table → 클릭 시 Webview에서 데이터 표시
                 │         ├─ Columns
                 │         ├─ Indexes
                 │         └─ Foreign Keys
                 ├─ Views
                 └─ Routines
```
Redis: `Connection > DB(0-15) > Keys (SCAN)`

TreeView 컨텍스트 메뉴 (`view/item/context`):
- Connection: Connect, Disconnect, Edit, Delete, New Query
- Table: View Data, Edit Data, Show DDL, Export, Drop
- Column/Index: Show Info

### Webview UI

- React + Zustand (도메인별 스토어: connection, query, schema, results)
- 라우터 없이 `ViewState` discriminated union으로 뷰 전환
- Monaco Editor — SQL 편집, 자동완성은 익스텐션에서 테이블/컬럼 정보 수신
- AG Grid — 쿼리 결과 + 인라인 테이블 편집
- VS Code CSS 변수(`--vscode-*`)로 테마 자동 연동

## Key Conventions

- TypeScript strict mode 필수 (`strict: true`, `noUncheckedIndexedAccess: true`)
- 익스텐션 코드는 `platform: 'node'`, `format: 'cjs'`로 번들 (esbuild)
- 웹뷰 코드는 `platform: 'browser'`로 번들 (Vite)
- `vscode` 모듈은 반드시 esbuild external 처리
- `better-sqlite3`는 네이티브 모듈이므로 esbuild external 처리, 플랫폼별 빌드 필요
- `acquireVsCodeApi()`는 웹뷰 전체에서 정확히 1회만 호출 (`vscode-api.ts`)
- 웹뷰 HTML에 Content-Security-Policy 메타 태그 필수 (nonce 기반)
- Redis는 `KEYS *` 대신 반드시 `SCAN` 사용

## DB Driver Reference

| DB | Package | Param Style | Pool |
|----|---------|-------------|------|
| MySQL/MariaDB | `mysql2` | `?` placeholder | `createPool`, limit 5 |
| PostgreSQL | `pg` | `$1, $2` numbered | `new Pool`, max 5 |
| SQLite | `better-sqlite3` | `?` placeholder | 단일 핸들 (WAL mode) |
| Redis | `ioredis` | N/A | 멀티플렉싱 |

## Publishing

VS Code Marketplace (`vsce`) + Open VSX (`ovsx`) 동시 배포.
Open VSX 배포로 Cursor, VSCodium, Gitpod 호환성 확보.
