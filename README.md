# DB Manager

VS Code / Cursor IDE용 데이터베이스 관리 익스텐션.
DBeaver, Navicat, HeidiSQL 수준의 DB 관리 기능을 IDE 안에서 바로 사용할 수 있습니다.

## 지원 데이터베이스

| Database | Driver | 비고 |
|----------|--------|------|
| MySQL | `mysql2` | 5.7+ |
| MariaDB | `mysql2` | 10.3+ |
| PostgreSQL | `pg` | 12+ |
| SQLite | `better-sqlite3` | 3.x |
| Redis | `ioredis` | 6+ |

## 주요 기능

- **연결 관리** — 다중 DB 연결 저장/관리, 연결 그룹, OS 키체인 비밀번호 보관
- **Explorer 사이드바 통합** — 탐색기에서 바로 DB 탐색
- **스키마 브라우저** — 사이드바 트리뷰로 커넥션 클릭 → 펼쳐지며 DB/스키마/테이블/뷰/인덱스 탐색
- **SQL 쿼리 편집기** — Monaco 기반 SQL 에디터, 자동완성, 구문 강조
- **쿼리 결과 테이블** — AG Grid 기반 가상화 그리드, 정렬/필터/페이지네이션
- **테이블 데이터 편집** — 인라인 INSERT/UPDATE/DELETE
- **스키마 관리** — 테이블/인덱스/뷰 생성·수정·삭제 (DDL)
- **데이터 내보내기/가져오기** — CSV, JSON, SQL Dump
- **Redis 브라우저** — 키 탐색(SCAN), 값 편집, TTL 관리
- **쿼리 히스토리** — 실행한 쿼리 기록 조회

## 기술 스택

- **언어**: TypeScript (strict mode)
- **UI**: React 18+ (VS Code Webview)
- **상태관리**: Zustand
- **SQL 에디터**: Monaco Editor
- **데이터 그리드**: AG Grid (Community)
- **빌드**: esbuild (익스텐션) + Vite (웹뷰)
- **패키지 매니저**: pnpm workspaces (모노레포)
- **테스트**: Vitest (유닛) + @vscode/test-cli (통합)
- **린트/포맷**: ESLint + Prettier

## 프로젝트 구조

```
dbmanager/
├── packages/
│   ├── extension/      # VS Code 익스텐션 호스트 (Node.js)
│   ├── webview-ui/     # React 웹뷰 앱 (브라우저)
│   └── shared/         # 공유 타입 및 메시지 프로토콜
├── pnpm-workspace.yaml
└── tsconfig.base.json
```

## 개발 환경 설정

### 필수 요구사항

- Node.js 20+
- pnpm 9+
- VS Code 1.95+

### 설치 및 빌드

```bash
# 의존성 설치
pnpm install

# 전체 빌드 (shared → webview-ui → extension 순서)
pnpm build

# 개발 모드 (watch)
pnpm dev
```

### 디버깅

VS Code에서 `F5`를 누르면 Extension Development Host가 실행됩니다.

### 테스트

```bash
# 유닛 테스트
pnpm test

# 유닛 테스트 (watch 모드)
pnpm test:watch

# 타입 체크
pnpm typecheck

# 린트
pnpm lint
```

## 배포

VS Code Marketplace와 Open VSX Registry(Cursor 호환)에 동시 배포합니다.

```bash
# VSIX 패키징
pnpm package

# 퍼블리시 (CI/CD에서 자동 실행)
pnpm publish:vsce    # VS Code Marketplace
pnpm publish:ovsx    # Open VSX (Cursor, VSCodium)
```

## 라이선스

[MIT](LICENSE)
