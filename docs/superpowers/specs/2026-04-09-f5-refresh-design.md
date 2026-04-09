# F5 Refresh in TableDataView

**Date:** 2026-04-09  
**Status:** Approved

## Overview

테이블 뷰에서 F5 키를 눌러 데이터를 새로고침할 수 있게 한다. 현재 적용된 정렬, WHERE 필터(입력창에 타이핑된 미적용 텍스트 포함), 페이지 오프셋을 반영한다.

## Scope

- 변경 파일: `packages/webview-ui/src/components/TableDataView/index.tsx` 단독
- 새 메시지 타입 없음, Zustand 스토어 변경 없음

## Behavior

| 조건 | 동작 |
|------|------|
| 모달 열림 (editingCell / showDeleteConfirm / statusError) | 무시 |
| WHERE 입력창에 미적용 텍스트 있음 | Apply + 새로고침 (offset 0으로 리셋) |
| WHERE 변경 없음 | 현재 페이지 유지하며 새로고침 |
| 정렬 상태 | 항상 유지 (sortRef 그대로 사용) |

## Key Design Decisions

- **F5 vs VS Code 충돌 없음**: 웹뷰는 격리된 iframe에서 실행되므로 웹뷰에 포커스가 있을 때 F5 이벤트는 VS Code의 전역 keybinding("Start Debugging")에 도달하지 않음. `e.preventDefault()`로 브라우저 기본 동작도 차단.
- **WHERE 동작**: 사용자가 F5를 "Apply + Refresh"로 기대함. WHERE가 변경된 경우 offset을 0으로 리셋(Apply 버튼과 동일한 동작).
- **기존 Refresh 버튼**: 새로 추출하는 `handleRefresh` 콜백으로 교체해 F5와 버튼이 동일하게 동작.

## Implementation

### 1. `handleRefresh` 콜백 추출

```ts
const handleRefresh = useCallback(() => {
  const whereChanged = whereClause !== appliedWhere;
  setAppliedWhere(whereClause);
  fetchData({
    offset: whereChanged ? 0 : offset,
    where: whereClause,
  });
}, [whereClause, appliedWhere, offset, fetchData]);
```

### 2. Refresh 버튼 업데이트

```tsx
// 기존
onClick={() => fetchData({ offset })}

// 변경
onClick={handleRefresh}
```

### 3. F5 keydown useEffect

```ts
useEffect(() => {
  const handler = (e: KeyboardEvent) => {
    if (e.key !== 'F5') return;
    if (editingCell || showDeleteConfirm || statusError) return;
    e.preventDefault();
    handleRefresh();
  };
  window.addEventListener('keydown', handler);
  return () => window.removeEventListener('keydown', handler);
}, [editingCell, showDeleteConfirm, statusError, handleRefresh]);
```

## Data Flow

```
F5 키다운
  → iframe이 이벤트 캡처 (VS Code 전역 핸들러 도달 안 함)
  → 모달 가드 통과
  → e.preventDefault()
  → setAppliedWhere(whereClause)
  → postMessage: getTableData { sortColumn, sortDirection, where, offset }
  → Extension 처리 → tableData 응답
  → Zustand 스토어 업데이트 → AG Grid 리렌더
```

## Out of Scope

- QueryEditor 뷰에서의 F5 (별도 요구사항)
- VS Code 커맨드 팔레트 등록
- RedisBrowser 등 다른 뷰에서의 F5
