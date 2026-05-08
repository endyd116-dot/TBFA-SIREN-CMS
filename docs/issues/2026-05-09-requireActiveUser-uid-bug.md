# #BUG-1 — requireActiveUser `user.id` undefined 버그

> **상태**: 🔴 미해결 (수정 보류 — 추후 별도 처리)
> **발견 일시**: 2026-05-09
> **발견 맥락**: 작업 A(#6 자격 변경) 사용자 검증 시도 중 마이페이지 → 자격 변경 탭 진입 → 500 에러
> **심각도**: 🔴 Critical (해당 함수를 쓰는 모든 API가 동작 불능)
> **수정 권한**: `lib/auth.ts`는 settings.json deny 등록 → **사용자 직접 처리 필요**

---

## 1. 위치

`lib/auth.ts:128`

```ts
// 현재 (버그)
.where(eq(members.id, user.id))    // ❌ user.id 는 undefined

// 수정 후
.where(eq(members.id, user.uid))   // ✅
```

## 2. 원인

`UserPayload` 타입은 `uid` 필드만 정의하는데 코드가 `user.id`를 참조 → undefined → drizzle/postgres-js가 `UNDEFINED_VALUE: Undefined values are not allowed` throw.

```ts
// lib/auth.ts:31~36
export interface UserPayload {
  uid: number;      // ← 정의된 필드
  email: string;
  type: ...;
  name: string;
}
```

## 3. 에러 증거 (Netlify Function 로그)

```
2026-05-09, 05:20:49 AM  ERROR  [requireActiveUser] DB 조회 실패:
  UNDEFINED_VALUE: Undefined values are not allowed
2026-05-09, 05:20:53 AM  ERROR  [requireActiveUser] DB 조회 실패:
  UNDEFINED_VALUE: Undefined values are not allowed (재시도)
```

클라이언트 응답: `500 { ok: false, error: "인증 검증 중 오류" }` (`lib/auth.ts:179` catch 블록)

## 4. 영향 범위

`requireActiveUser`를 사용하는 **9개 API 모두 동작 불능 추정**:

| API | 도메인 | 사용자 영향 |
|---|---|---|
| `eligibility-status` | 마이페이지 자격변경 조회 | 🔴 발견됨 |
| `eligibility-request` | 자격변경 신청 | 🔴 동일 추정 |
| `board-create` | 게시글 작성 | 🔴 동일 추정 |
| `board-comment-create` | 댓글 작성 | 🔴 동일 추정 |
| `support-create` | 유족지원 신청 | 🔴 동일 추정 |
| `incident-report-create` | SIREN 사건 신고 | 🔴 동일 추정 |
| `harassment-report-create` | SIREN 괴롭힘 신고 | 🔴 동일 추정 |
| `legal-consultation-create` | SIREN 법률 상담 | 🔴 동일 추정 |
| `admin-members-blacklist` | 어드민 블랙 처리 | 🔴 동일 추정 |

도입 시점: 5순위 #1 블랙리스트 통합 (`requireActiveUser` 함수 신설). **그동안 위 CREATE API 들이 사용자 검증 안 거치고 통과했을 가능성**.

## 5. 수정 방법

**한 줄 수정**:

```diff
- .where(eq(members.id, user.id))
+ .where(eq(members.id, user.uid))
```

## 6. 처리 권장 절차

`lib/auth.ts`는 settings.json deny에 등록되어 있어 **사용자 직접 수정**이 가장 안전:

1. 메인 폴더(`tbfa-mis`)에서 main 브랜치 확인:
   ```bash
   git checkout main && git pull origin main
   ```
2. `lib/auth.ts:128` 직접 편집 (`user.id` → `user.uid`)
3. commit + push:
   ```bash
   git add lib/auth.ts
   git commit -m "fix(auth): requireActiveUser user.id → user.uid (UNDEFINED_VALUE 버그)

   5순위 #1 블랙 통합 시 도입된 requireActiveUser에서 잘못된 필드명 참조.
   UserPayload는 uid 필드만 정의하는데 user.id를 사용해 undefined가 SQL
   파라미터로 전달 → drizzle UNDEFINED_VALUE 에러 → 500 응답.

   영향: requireActiveUser 사용 API 9개 (eligibility, board, support,
   incident/harassment/legal-create, admin-members-blacklist)"
   git push origin main
   ```
4. Netlify 자동 배포 1~2분 대기
5. 마이페이지 → 자격 변경 진입하여 정상 로드 확인 → 작업 A 사용자 검증 재개

## 7. 회귀 방지 메모

- 도입 시점부터의 회귀였으나 **블랙 통합 후 차단 적용 CREATE API들이 바로 검증되지 않은 게 주된 원인**
- 향후 `requireActiveUser`/`requireAdmin` 류 헬퍼는 단위 테스트 또는 도입 직후 **모든 사용처 1회 검증** 권장
- TypeScript strict mode + 인덱스 시그니처 회피로 `user.id` 같은 오타가 컴파일 단계에서 잡히도록 검토

## 8. 관련 정보

- 발견된 채팅: 메인 채팅 (작업 A·C 머지 후 검증 단계)
- 머지 커밋: `4872a36` (작업 C 정리) 시점에 발견
- 회귀 가설: A·C 머지가 회귀 일으킨 것 아님 (도입 시점부터의 잠재 버그)
