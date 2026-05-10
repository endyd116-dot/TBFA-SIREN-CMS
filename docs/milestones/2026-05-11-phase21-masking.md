# Phase 21 — 어드민 전화번호 마스킹 정식 적용

> 설계 확정일: 2026-05-11
> 담당: 메인(설계·머지) / B(백엔드) / A(프론트) / C(검증)
> 선행 조건: Phase 20-C 검증 마감 후 시작
> 이관 출처: BUG-17-06 (`docs/verify/2026-05-11-phase17.md` §3)

---

## §0 결정 사항 요약

| 항목 | 결정 |
|---|---|
| 마스킹 위치 | **백엔드** — API 응답 자체에서 마스킹 처리 |
| 기본 표시 | 전화번호 `010-****-5678` 형태로 모든 계정에 기본 마스킹 |
| 원본 보기 | [원본 보기] 버튼 클릭 → 별도 API 호출 → 원본 반환 + 감사 로그 자동 기록 |
| 권한 분기 | 권한 무관, 모든 계정 동일 정책 (원본 보기 버튼으로 통일) |
| 마스킹 대상 | **전화번호만** — 이메일은 원본 유지 |
| 익스포트 파일 | **원본 유지** — Excel·CSV 다운로드는 마스킹 없음 |
| 효성 CMS+ | **마스킹 절대 제외** — 전화번호가 매칭 키, 건드리면 시스템 깨짐 |
| 기존 헬퍼 | `lib/masking.ts` → `maskPhone()` 이미 구현됨, 재사용 |

---

## §1 마스킹 적용 대상 — 21개 API (5그룹)

### 그룹 ① 회원 관리 (6개) — 마스킹 적용

| 파일 | 역할 | 마스킹 필드 |
|---|---|---|
| `admin-members.ts` | 회원 목록 | `phone` |
| `admin-member-detail.ts` | 회원 상세 | `phone` |
| `admin-members-blacklist.ts` | 블랙리스트 | `phone` |
| `admin-pending-approvals.ts` | 가입 승인 대기 | `phone` |
| `admin-operators.ts` | 운영자 목록 | `phone` |
| `admin-eligibility-list.ts` | 자격 변경 심사 | `phone` |

### 그룹 ② 후원자 관리 (5개) — 마스킹 적용

| 파일 | 역할 | 마스킹 필드 |
|---|---|---|
| `admin-donor-regular-list.ts` | 정기 후원자 목록 | `phone` |
| `admin-donor-prospect-list.ts` | 잠재 후원자 목록 | `phone` |
| `admin-donation-pending-list.ts` | 미확정 후원 목록 | `phone` |
| `admin-donation-confirm.ts` | 후원 확정 처리 응답 | `phone` |
| `admin-churn-risks.ts` | 이탈 위험 후원자 | `phone` |

### 그룹 ③ 데이터 익스포트 (3개) — **원본 유지, 마스킹 제외**

| 파일 | 역할 | 처리 |
|---|---|---|
| `admin-members-export.ts` | 회원 명단 Excel·CSV | 원본 그대로 |
| `admin-members-contract-export.ts` | 계약 회원 익스포트 | 원본 그대로 |
| `admin-donations-export.ts` | 후원 명단 익스포트 | 원본 그대로 |

### 그룹 ④ 효성 CMS+ (3개) — **마스킹 절대 제외**

| 파일 | 역할 | 처리 |
|---|---|---|
| `admin-hyosung.ts` | 효성 CMS+ 관리 | 원본 그대로 |
| `admin-hyosung-import-contracts.ts` | 효성 계약 임포트 | 원본 그대로 |
| `admin-hyosung-import-billings.ts` | 효성 청구 임포트 | 원본 그대로 |

### 그룹 ⑤ 채팅·신고·전문가 (4개) — 마스킹 적용

| 파일 | 역할 | 마스킹 필드 |
|---|---|---|
| `admin-chat-rooms.ts` | 어드민 문의 관리 | `phone` |
| `admin-experts-for-match.ts` | 전문가 매칭 후보 | `phone` |
| `admin-anonymous-reveal.ts` | 익명 신고 추적 | `phone` (단, 신원 확인 목적 특성상 [원본 보기] 별도 정책 — §2.3 참고) |
| `admin-support.ts` | 유가족 지원 관리 | `phone` |

---

## §2 신규 API 설계

### 2.1 원본 조회 API — `admin-phone-reveal.ts`

```
GET /api/admin-phone-reveal?type={entity}&id={id}
```

- **역할**: 마스킹된 전화번호를 원본으로 조회. 호출 시 감사 로그 자동 기록.
- **인증**: `requireAdmin` 필수
- **파라미터**:
  - `type`: `member` | `donor` | `expert` | `support` | `chat`
  - `id`: 해당 엔티티 ID (숫자)
- **응답**:
  ```json
  { "ok": true, "phone": "010-1234-5678", "revealedAt": "2026-05-11T10:00:00Z" }
  ```
- **감사 로그 기록** (호출 시 자동):
  - 로그인한 관리자 UID
  - 조회 대상 type + id
  - 조회 시각
  - 테이블: `audit_logs` (기존 테이블 재사용, `action = 'phone_reveal'`)
- **DB 조회 분기** (`type` 기준):
  - `member` → `members` 테이블 `id` 기준 `phone` 조회
  - `donor` → `donations` 또는 `members` 테이블 — `type`에 따라 분기
  - `expert` → `expert_profiles` 테이블
  - `support` → `support_applications` 테이블
  - `chat` → `members` 테이블 (채팅방 참여자 기준)

### 2.2 [원본 보기] 버튼 동작 흐름

```
1. 화면에 010-****-5678 표시
2. 각 행 오른쪽에 [원본 보기] 버튼
3. 클릭 → GET /api/admin-phone-reveal?type=member&id=123 호출
4. 응답 받으면 → 해당 셀을 010-1234-5678로 교체
5. 버튼 → [숨기기]로 변경 (다시 클릭 시 마스킹으로 복귀)
6. 서버에서 감사 로그 자동 기록 (클라이언트는 별도 처리 불필요)
```

### 2.3 익명 신고 추적 (`admin-anonymous-reveal.ts`) 특이사항

- 익명 신고 추적은 이미 "신원 확인" 자체가 목적인 화면
- [원본 보기] 버튼 없이 **처음부터 원본 노출** 유지 (현행 동작 그대로)
- 단, 해당 API 호출 자체가 감사 로그에 기록되도록 `audit()` 추가

---

## §3 백엔드 구현 방식 (B 분담)

### 3.1 마스킹 적용 패턴 (표준)

```typescript
import { maskPhone } from "../../lib/masking";

// 응답 직전, map 단계에서 적용
const result = rows.map(r => ({
  ...r,
  phone: maskPhone(r.phone),   // 원본 대신 마스킹된 값 반환
}));
```

### 3.2 신규 파일

- `netlify/functions/admin-phone-reveal.ts` — 원본 조회 + 감사 로그 기록

### 3.3 수정 파일 (그룹 ①②⑤ — 총 15개)

각 함수 응답 `map()` 단계에 `phone: maskPhone(r.phone)` 한 줄 추가.

**그룹 ① 회원 (6개)**
- `admin-members.ts`
- `admin-member-detail.ts`
- `admin-members-blacklist.ts`
- `admin-pending-approvals.ts`
- `admin-operators.ts`
- `admin-eligibility-list.ts`

**그룹 ② 후원자 (5개)**
- `admin-donor-regular-list.ts`
- `admin-donor-prospect-list.ts`
- `admin-donation-pending-list.ts`
- `admin-donation-confirm.ts`
- `admin-churn-risks.ts`

**그룹 ⑤ 채팅·신고·전문가 (4개)**
- `admin-chat-rooms.ts`
- `admin-experts-for-match.ts`
- `admin-support.ts`
- `admin-anonymous-reveal.ts` (감사 로그 `audit()` 추가만, 마스킹 미적용)

**그룹 ③④ (6개)**: 수정 없음

### 3.4 push 전 체크

```
□ npx tsc --noEmit 신규 0 errors
□ admin-phone-reveal.ts: config.path = "/api/admin-phone-reveal" 명시
□ requireAdmin 반환은 auth.res
□ 익스포트 3개·효성 3개는 maskPhone 호출 없음 확인
□ admin-anonymous-reveal.ts: maskPhone 없음, audit() 추가만 확인
```

---

## §4 프론트 구현 방식 (A 분담)

### 4.1 [원본 보기] 버튼 — 공통 헬퍼 (`admin-phone-reveal.js`)

```
신규 파일: public/js/admin-phone-reveal.js
역할: [원본 보기] 버튼 생성·동작 공통 함수 제공
  - createRevealButton(type, id, targetCell) → 버튼 DOM 반환
  - 클릭 시 GET /api/admin-phone-reveal?type=X&id=Y 호출
  - 성공 시 targetCell 텍스트를 원본으로 교체, 버튼 [숨기기]로 전환
  - 다시 클릭 시 010-****-5678로 복귀
```

### 4.2 수정 파일 — [원본 보기] 버튼 삽입

전화번호를 표시하는 테이블 행 렌더링 시 버튼 추가:

| JS 파일 | 적용 화면 |
|---|---|
| `admin-members-group.js` | 회원 목록·상세 |
| `admin-siren-group.js` | 신고 처리 (채팅·전문가) |
| `admin-support-group.js` | 유가족 지원 관리 |
| `admin-donations-group.js` | 후원자 관리 |
| `cms-tbfa.js` | 기존 회원 관리 화면 (20-C 이후 레거시) |

### 4.3 admin.html 캐시버스터

```
admin-phone-reveal.js 스크립트 태그 추가
캐시버스터: ?v=2026-05-11-phase21
```

---

## §5 단계 구조 (표준 패턴)

Phase 21은 DB 변경 없음(마이그레이션 불필요). B·A 동시 작업 후 각자 머지.

```
1. B: 15개 API 마스킹 적용 + admin-phone-reveal.ts 신규 → feature/phase21-back
2. A: admin-phone-reveal.js 신규 + 5개 JS 버튼 삽입 → feature/phase21-front (mock 없이 바로 실 API)
3. 메인: B 머지 → A 머지 → C 검증 트리거
4. C: Q1~Q12 검증 → BUG fix → docs/verify/2026-05-11-phase21.md
5. 메인: verify/phase21 머지 → PROJECT_STATE 갱신
```

---

## §6 검증 시나리오 (C 분담, Q1~Q12)

| Q | 시나리오 | 기대 결과 |
|---|---|---|
| Q1 | 어드민 로그인 → 회원 목록 진입 | 전화번호 `010-****-5678` 형태로 표시 |
| Q2 | 회원 목록에서 [원본 보기] 클릭 | 원본 번호 노출 + 버튼 [숨기기]로 전환 |
| Q3 | [숨기기] 클릭 | 다시 `010-****-5678`로 복귀 |
| Q4 | 후원자 목록 — 전화번호 마스킹 | 동일 패턴 적용 확인 |
| Q5 | 유가족 지원 목록 — 전화번호 마스킹 | 동일 패턴 적용 확인 |
| Q6 | [원본 보기] 클릭 시 감사 로그 기록 여부 | 감사 로그 화면에서 `phone_reveal` 항목 확인 |
| Q7 | 회원 명단 Excel 다운로드 | 원본 번호 그대로 (마스킹 없음) |
| Q8 | 효성 CMS+ 화면 | 전화번호 원본 그대로 (마스킹 없음) |
| Q9 | 익명 신고 추적 화면 | 원본 노출 그대로 유지 (마스킹 미적용 확인) |
| Q10 | 이메일 주소 | 어느 화면에서도 마스킹 없음 (원본) |
| Q11 | TypeScript `npx tsc --noEmit` | 신규 0 errors |
| Q12 | 기존 기능 회귀 — 후원·발송·사이렌 | 영향 없음 |

---

## §7 채팅 트리거 (메인 발송용)

### B 트리거

```
[B — Phase 21 전화번호 마스킹 백엔드]

브랜치: feature/phase21-back ← origin/main
설계서: docs/milestones/2026-05-11-phase21-masking.md §3

영역: netlify/functions/, lib/
금지: public/, db/schema.ts, PROJECT_STATE.md, docs/HANDOFF.md, docs/

━━━ 신규 파일 1개 ━━━
netlify/functions/admin-phone-reveal.ts
  GET /api/admin-phone-reveal?type={entity}&id={id}
  requireAdmin 후 type+id로 해당 테이블에서 phone 원본 조회
  audit() 호출: action='phone_reveal', targetType=type, targetId=id
  응답: { ok, phone, revealedAt }

━━━ 수정 파일 15개 ━━━
그룹 ① 회원 6개:
  admin-members.ts, admin-member-detail.ts, admin-members-blacklist.ts,
  admin-pending-approvals.ts, admin-operators.ts, admin-eligibility-list.ts

그룹 ② 후원자 5개:
  admin-donor-regular-list.ts, admin-donor-prospect-list.ts,
  admin-donation-pending-list.ts, admin-donation-confirm.ts, admin-churn-risks.ts

그룹 ⑤ 4개:
  admin-chat-rooms.ts, admin-experts-for-match.ts, admin-support.ts
  admin-anonymous-reveal.ts → maskPhone 없음, audit() 추가만

적용 패턴:
  import { maskPhone } from "../../lib/masking";
  rows.map(r => ({ ...r, phone: maskPhone(r.phone) }))

━━━ 수정 금지 6개 ━━━
익스포트: admin-members-export.ts, admin-members-contract-export.ts, admin-donations-export.ts
효성: admin-hyosung.ts, admin-hyosung-import-contracts.ts, admin-hyosung-import-billings.ts

━━━ push 전 체크 ━━━
□ npx tsc --noEmit 신규 0 errors
□ admin-phone-reveal.ts config.path = "/api/admin-phone-reveal"
□ requireAdmin 반환 auth.res
□ 익스포트·효성 6개 maskPhone 없음 확인

push 후 메인에 보고: 브랜치명·커밋 해시·변경 파일 요약
금지: PROJECT_STATE.md, docs/HANDOFF.md, docs/ 수정
```

### A 트리거

```
[A — Phase 21 전화번호 마스킹 프론트]

브랜치: feature/phase21-front ← origin/main
설계서: docs/milestones/2026-05-11-phase21-masking.md §4

영역: public/
금지: lib/, netlify/functions/, db/, PROJECT_STATE.md, docs/HANDOFF.md, docs/

━━━ 신규 파일 1개 ━━━
public/js/admin-phone-reveal.js
  createRevealButton(type, id, targetCell) 함수 export
  - [원본 보기] 버튼 DOM 생성·반환
  - 클릭: GET /api/admin-phone-reveal?type={type}&id={id}
  - 성공: targetCell 텍스트 → 원본번호, 버튼 → [숨기기]
  - [숨기기] 클릭: targetCell → 010-****-5678 복귀

━━━ 수정 파일 5개 ━━━
전화번호 표시하는 테이블 행 렌더링 시 createRevealButton 호출:
  public/js/admin-members-group.js    (회원 목록)
  public/js/admin-siren-group.js      (채팅·전문가)
  public/js/admin-support-group.js    (유가족 지원)
  public/js/admin-donations-group.js  (후원자 관리)
  public/js/cms-tbfa.js               (기존 회원 관리)

━━━ 수정 파일 1개 ━━━
public/admin.html
  admin-phone-reveal.js 스크립트 태그 추가
  캐시버스터: ?v=2026-05-11-phase21

━━━ push 전 체크 ━━━
□ [원본 보기] → [숨기기] → 마스킹 복귀 동작 확인
□ 효성·익스포트 화면에 버튼 없음 확인

push 후 메인에 보고: 브랜치명·커밋 해시·변경 파일 요약
금지: PROJECT_STATE.md, docs/HANDOFF.md, docs/ 수정
```

---

## §8 위험 관리

| 위험 | 대응 |
|---|---|
| 익스포트 API에 실수로 maskPhone 추가 | B push 전 체크리스트 + C Q7 검증 |
| 효성 API 마스킹 적용 시 매칭 깨짐 | 수정 금지 목록 명시 + C Q8 검증 |
| audit() 호출 실패 시 원본 노출 차단 | audit 실패는 warn만 (원본 조회는 정상 반환) |
| admin-anonymous-reveal 마스킹 실수 적용 | C Q9 전용 검증 |

---

## §9 변경 이력

| 일시 | 작성 | 내용 |
|---|---|---|
| 2026-05-11 | 메인 | 신설 — BUG-17-06 이관, 정책 확정, 21개 파일 분류, 트리거 포함 |
