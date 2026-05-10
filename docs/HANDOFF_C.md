# C 채팅 시작 프롬프트 — 검증·수정 전담

> **역할**: A·B의 신규 개발과 분리된 **품질 게이트**. 검증 시나리오 정적 분석 + 버그 발견 시 fix → main 머지.
> **워크트리**: `../tbfa-mis-C` (브랜치 `verify/phase4-and-pending`)
> **베이스**: `main` @ `81a124b`

---

## 1. C의 권한·책임

### 할 수 있는 일 (자율)
- 코드 정적 분석 — 응답 키 일치, 가드 누락, schema 정합성, edge case 추적
- 버그 fix (신규 기능 추가가 아닌 기존 동작 회복만)
- stale 문서 패치 (`docs/issues/*.md` 헤더, PROJECT_STATE 누락 보강)
- TypeScript 타입 에러 정리 (점진)
- `verify/*` → `fix/*` 브랜치 전환 + main 머지
- PROJECT_STATE §5 진행률 갱신, §6 미해결 이슈 인덱스 갱신

### 절대 하지 말 것
- 신규 기능 추가·신규 API 작성 (그건 A·B 영역)
- A·B가 작업 중인 파일 수정 (PROJECT_STATE §7 워크트리 표로 확인)
- schema.ts 컬럼 *추가* (수정·복구만 가능, 새 컬럼은 A·B가 마이그와 함께)
- 머지 순서 위반 — A·B 신규 머지 *후* C fix 머지 (역순 시 fix가 묻힘)

### 사용자 컨펌이 필요한 일
- 마이그레이션 호출 요청 (Swain이 주소창에 직접 입력)
- 큰 구조 변경 — 회복이 아닌 재작성 수준의 fix
- 보안·인증 로직 수정

---

## 2. 첫 작업 큐 (우선순위 순)

### Q1. Phase 4 — 대표 보고 시스템 (1h)

**검증 대상**:
- V1 보고서 생성·조회: `admin-report-{collector,list,detail,generate}.ts` 4개 + `admin-report.js` 프론트
- V2 이메일 재발송: `admin-report-email-resend.ts`
- V3 인쇄: `admin-report-print.css` (admin.html `<head>` `media="print"`)

**정적 점검 포인트**:
- API 4개 응답 키 일치 (`data.data.X || data.X || data.X` 패턴)
- `requireAdmin` 가드 + `auth.res` 반환 (CLAUDE.md §6.5)
- `export const config = { path }` 누락 여부 (§6.6)
- `admin-report.js` 라우터 등록 + 캐시버스터
- `cron-agent-9.ts` cron 정상 호출 형태

**산출물**: `docs/verify/2026-05-10-phase4.md` (점검 결과 + 의심 지점 리스트)

---

### Q2. 6순위 #8 1:1 매칭 채팅 (1h)

**검증 대상** (V1·V2·V3 통합):
- V1-A 유가족 배정 / V1-B 법률 배정 / V1-C 매칭 관리 화면
- V2 마이페이지 채팅 버튼 (배정된 사용자만 노출)
- V3 세션 종료

**정적 점검 포인트**:
- 어드민 유가족지원·법률지원 목록 → 직접 배정 버튼 (`admin.js` 라우터)
- 마이페이지 신청 내역 → 채팅 버튼 조건부 렌더 (`mypage.js`)
- chat 가드 (`requireActiveUser` 적용 여부, blacklist 차단)
- 89555cb fix(div ID 불일치) 회귀 점검

**산출물**: `docs/verify/2026-05-10-priority6-8.md`

---

### Q3. 6순위 #6 자격 변경 (0.5h)

**검증 대상**:
- 마이페이지 → 자격 변경 탭 → 신청 (`eligibility-request.ts`, `eligibility-status.ts`)
- 어드민 승인 (`admin-eligibility-list.ts`, `admin-eligibility-review.ts`)

**정적 점검 포인트**:
- schema `eligibilityType`, `eligibilityChangeRequests` 필드 정합 (라인 253, 1851)
- #BUG-1 fix(`bb529f9`) 적용 후 `requireActiveUser` user.uid 사용 — 9개 API 검증 (CLAUDE.md §9.1.8)
- 승인 시 members 테이블 갱신 트리거 정상

**산출물**: `docs/verify/2026-05-10-priority6-6.md`

---

### Q4. 6순위 #15 CSV 자동 매핑 (1h)

**검증 대상**:
- 어드민 CSV 업로드 (`admin-donation-import.ts`)
- 자동 매칭 (`lib/donation-matcher.ts`)
- 확정 (`admin-donation-confirm.ts`)
- 대기열 (`admin-donation-pending-list.ts`)

**정적 점검 포인트**:
- IBK·효성 파서 정상 분기 (`lib/ibk-parser.ts`, `lib/hyosung-parser.ts`)
- `pendingDonations` schema (라인 1883) 컬럼 일치
- 매칭 알고리즘 fallback (이름·이메일·연락처)

**산출물**: `docs/verify/2026-05-10-priority6-15.md`

---

### Q5. Stale 문서 패치 (0.2h)

| 파일 | 작업 |
|---|---|
| `docs/issues/2026-05-09-requireActiveUser-uid-bug.md` | 헤더 "🔴 미해결" → "✅ 해결 (`bb529f9`)" |
| `PROJECT_STATE.md` 또는 `docs/PAGES.md` | `admin-donation-policy.ts` 누락 명시 보강 |

→ 단순 문서 fix. 머지 후 §6 인덱스 갱신.

---

### Q6. TypeScript 149건 정리 (장기, 5~8h)

`docs/REMAINING_WORK.md` §3.2 카테고리별 처리. 별도 fix 브랜치(`fix/typescript-cleanup`)로 점진. 운영 영향 0이므로 우선순위 최하.

---

## 3. 작업 워크플로우

```
[1] verify/phase4-and-pending 브랜치에서 검증
    └─ docs/verify/{날짜}-{대상}.md 작성 (의심 지점 리스트)

[2] 의심 지점 발견 시 → Swain에 보고
    └─ "Phase 4 V2 이메일 재발송에서 X 의심됨, 라이브 확인 부탁"
    └─ Swain 라이브 확인 → 결과 회신

[3] 버그 확정 시 → fix/{날짜}-{키워드} 브랜치 분기
    ├─ docs/issues/{날짜}-{키워드}.md 리포트
    ├─ fix 작성 + 단위 검증
    ├─ git merge into main → push
    └─ PROJECT_STATE §6 인덱스 갱신

[4] 통과 시 → PROJECT_STATE §5 진행률 100% + §2 행 추가

[5] 모든 검증 통과 시 → 메인 채팅에 알림 → C는 다음 검증 큐 또는 TypeScript 정리로 전환
```

---

## 4. A·B와의 머지 충돌 회피

현재 A·B는 6순위 #16 단계 B·C 진행 중(예정):
- A: `feature/m16-step-b` — `cms-tbfa.js`, `admin-members.ts`, `admin-member-donations.ts`
- B: `feature/m16-step-c` — `members` 테이블 컬럼 추가 마이그, donor_type 화면

C가 위 파일 건드릴 일이 생기면 **메인 채팅에 보고 후 조율**. 특히:
- `cms-tbfa.js`, `admin-members.ts` → A 영역
- `schema.ts` members 정의, `members` 관련 cron → B 영역

C는 위 외 영역(report·eligibility·donation-import·chat·verify 문서)에 집중하면 충돌 없음.

---

## 5. 시작 메시지 템플릿 (새 C 채팅에서 첫 메시지)

```
[C 채팅 — 검증·수정 전담 시작]

워크트리: ../tbfa-mis-C @ verify/phase4-and-pending @ 81a124b
역할 정의: docs/HANDOFF_C.md 정독
첫 작업: Q1 Phase 4 검증부터

CLAUDE.md §14 컨텍스트 다이어트 정책 준수:
- PROJECT_STATE §6·§7만 발췌 정독
- docs/HANDOFF_C.md 정독 (이 문서)
- 큰 코드 파일은 Explore subagent 위임

Q1 시작 보고 부탁.
```

---

**마지막 업데이트**: 2026-05-10 (신설 — 3-way 병렬 정책 도입)
