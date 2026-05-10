# B 채팅 시작 프롬프트 — 6순위 #16 단계 C (donor_type 컬럼 + 정기/잠재 화면)

> **워크트리**: `../tbfa-mis-B` @ `feature/m16-step-c`
> **베이스**: `main` @ `aa7305d`
> **추정**: 3~4h
> **설계서**: [docs/milestones/2026-05-10-donor-system.md](milestones/2026-05-10-donor-system.md) §3

---

## 작업 영역 (B 전담)

### 1. 데이터 모델 (마이그레이션)

`migrate-add-members-donor-type.ts` 신규:
```sql
ALTER TABLE members ADD COLUMN donor_type varchar(20);       -- regular|prospect|none
ALTER TABLE members ADD COLUMN donor_channels jsonb;          -- ['toss']|['hyosung']|['toss','hyosung']
ALTER TABLE members ADD COLUMN prospect_subtype varchar(20); -- onetime|cancelled
ALTER TABLE members ADD COLUMN donor_evaluated_at timestamp;
```

마이그 호출 흐름 (CLAUDE.md §6.8):
1. 마이그 함수 작성 + 푸시
2. Swain 어드민 로그인 → `https://tbfa-siren-cms.netlify.app/api/migrate-add-members-donor-type?run=1`
3. 응답 success 확인 → schema.ts 정의 활성화 + 마이그 파일 삭제 + 푸시

마이그 적용 전에는 schema.ts 컬럼 정의 추가 금지 (CLAUDE.md §9.1.1).

### 2. 토스 즉시 반영 후크

| 파일 | 작업 |
|---|---|
| `auth-toss-billing-issued.ts` | 빌링키 등록 시 donor_type='regular' + channels에 'toss' 추가 |
| `cron-toss-billing.ts` | 결제 성공 시 재평가 |
| 토스 해지 처리 (마이페이지) | channels에서 'toss' 제거 → 잔여 채널로 재평가 |

### 3. cron 안전망

`cron-donor-status-sync.ts` 신규 — KST 03:00, 식별 SQL 4종 일괄 실행 + 누락 케이스 자동 보정.

### 4. API + 화면 (정기/잠재)

| 파일 | 작업 |
|---|---|
| `admin-donor-regular-list.ts` (신규) | 정기 후원자 + 채널별 KPI |
| `admin-donor-prospect-list.ts` (신규) | 잠재 후원자 (`?subtype=onetime\|cancelled\|all`) |
| 정기/잠재 화면 (placeholder → 본격) | 채널 뱃지·다음 결제일·재유치 액션 등 |

---

## A 영역 회피 (중요)

A 채팅(`feature/m16-step-b`)이 동시에 작업하는 영역:
- `public/js/cms-tbfa.js` (DEMO 제거)
- `netlify/functions/admin-members.ts` 필터 확장
- `admin-member-donations.ts` 신규 (회원별 후원 이력)
- 회원 상세 모달

**B는 위 영역 건드리지 말 것**. `schema.ts` members 컬럼 추가는 B 영역 — append-only + 본인 섹션 헤더 (`/* === B: m16-step-c === */`) 원칙 (CLAUDE.md §9.1.6).

---

## 머지 전 체크

- [ ] 마이그 함수 작성 → Swain 호출 → success 확인
- [ ] schema.ts 정의 활성화 + 마이그 파일 삭제 + 푸시
- [ ] 토스 후크 3개 즉시 반영 검증
- [ ] cron-donor-status-sync 동작 검증 (식별 SQL 4종)
- [ ] 정기/잠재 API 2개 응답 키 일관성
- [ ] 정기/잠재 화면 동작
- [ ] A 영역 파일 미수정
- [ ] 응답 키 다중 fallback
- [ ] `requireAdmin` 가드 + `auth.res` 반환

---

## 머지 순서 (A보다 먼저 또는 후?)

- **B 먼저 머지 권장**: schema.ts members 컬럼이 추가되면 A의 `admin-members.ts`에서 donor_type 컬럼을 즉시 SELECT 가능 (fallback 'none' 불필요)
- 단, A·B 동시 진행 시 A는 컬럼 미존재 fallback 처리 → 머지 순서 무관
- C(검증)는 A·B 모두 머지 후 검증 시작

---

## 시작 메시지 템플릿

```
[B 채팅 — 6순위 #16 단계 C 시작]

워크트리: ../tbfa-mis-B @ feature/m16-step-c @ aa7305d
역할: donor_type 컬럼 + 토스 즉시 반영 후크 + 정기/잠재 화면 + cron 안전망
설계서: docs/milestones/2026-05-10-donor-system.md §3 정독
가이드: docs/HANDOFF_B.md 정독

CLAUDE.md §14 컨텍스트 다이어트 정책 준수.
PROJECT_STATE §3·§7만 발췌 정독.
A 영역 (cms-tbfa.js, admin-members.ts 필터, admin-member-donations.ts, 회원 상세 모달) 회피.

작업 순서: 마이그 작성 → 호출 요청 → schema 활성화 → 토스 후크 → cron → API → 화면.
첫 보고: 마이그 함수 작성 완료 시점.
```
