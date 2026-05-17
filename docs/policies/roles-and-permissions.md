# 역할 및 권한 정책

> **최초 작성**: 2026-05-17  
> **라운드**: 4 — 3단 권한 체계 신설  
> **적용 시점**: migrate-round4-rbac 마이그레이션 호출 후

---

## 1. 역할 정의

| 역할 | 코드 | 설명 |
|---|---|---|
| 최고 관리자 | `super_admin` | 모든 기능 접근. 시스템 설정·예산·감사 로그 포함 |
| 일반 관리자 | `admin` | 회원·후원·SIREN 운영 담당. 시스템 설정 접근 불가 |
| 운영자 | `operator` | 캠페인·게시판·워크스페이스 조회·관리만 가능 |

---

## 2. 권한 매트릭스

| 기능 영역 | super_admin | admin | operator |
|---|---|---|---|
| 감사 로그 조회 | ✅ | ❌ | ❌ |
| 예산 승인 | ✅ | ❌ | ❌ |
| 지출 승인 | ✅ | ❌ | ❌ |
| 등급·정책·AI 설정 | ✅ | ❌ | ❌ |
| 운영자 관리 | ✅ | ❌ | ❌ |
| 회원 관리 (블랙·자격·강제) | ✅ | ✅ | ❌ |
| 후원·환불 관리 | ✅ | ✅ | ❌ |
| SIREN 신고 처리 | ✅ | ✅ | ❌ |
| 캠페인·게시판 관리 | ✅ | ✅ | ✅ |
| 워크스페이스 조회·Task 관리 | ✅ | ✅ | ✅ |

---

## 3. 역할 계층 (우선순위)

```
super_admin (3) > admin (2) > operator (1)
```

- 상위 역할은 하위 역할의 모든 권한을 포함
- `requireRole(member, "admin")` 호출 시 `super_admin`도 통과

---

## 4. 역할 변경 절차

1. 어드민 로그인 (super_admin 계정 필요)
2. 시스템 → 권한 정책 메뉴 진입
3. 운영자 목록에서 대상 클릭
4. role 드롭다운에서 새 역할 선택 후 저장
5. 변경 사항은 다음 로그인부터 적용 (JWT 재발급 필요)

> **주의**: 역할 변경 권한은 `super_admin`만 보유. 자기 자신의 역할 강등 금지.

---

## 5. 마이그레이션 이력

| 날짜 | 내용 |
|---|---|
| 2026-05-17 | 3단 체계 신설. 기존 `operator`(type=admin) → `admin`으로 일괄 변환 |

---

## 6. 코드 사용 패턴

```typescript
import { requireRole, roleForbidden } from "../../lib/admin-role";

// super_admin만 접근
if (!requireRole(auth.ctx.member, "super_admin")) {
  return roleForbidden("super_admin");
}

// admin 이상 접근
if (!requireRole(auth.ctx.member, "admin")) {
  return roleForbidden("admin");
}
```
