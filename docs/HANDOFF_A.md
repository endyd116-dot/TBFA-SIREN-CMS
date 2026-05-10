# A 채팅 시작 프롬프트 — 6순위 #16 단계 B (통합회원 실제 API + 상세 모달)

> **워크트리**: `../tbfa-mis-A` @ `feature/m16-step-b`
> **베이스**: `main` @ `aa7305d`
> **추정**: 1.5~2.5h
> **설계서**: [docs/milestones/2026-05-10-donor-system.md](milestones/2026-05-10-donor-system.md) §2

---

## 작업 영역 (A 전담)

| 파일 | 작업 |
|---|---|
| `public/js/cms-tbfa.js` | DEMO_MEMBERS / DEMO_WEB_DONORS / DEMO_TAGS 제거 → 실제 fetch |
| `netlify/functions/admin-members.ts` | `?source=siren\|hyosung\|manual\|all` + `?donorType=regular\|prospect\|none\|all` 필터 추가 (donorType은 컬럼 미존재 시 'none' fallback) |
| `netlify/functions/admin-member-donations.ts` (신규) | 회원별 후원 이력 조회 API |
| `public/cms-tbfa.html` (또는 `public/js/cms-tbfa.js`) | 가입경로 뱃지 + 후원 상태 뱃지 + 검색·필터·페이지네이션 + **회원 상세 모달** (기본 정보 + 후원 내역 탭) |

→ 완료 시 #BUG-2 자동 해결.

---

## B 영역 회피 (중요)

B 채팅(`feature/m16-step-c`)이 동시에 작업하는 영역:
- `db/schema.ts` `members` 테이블 컬럼 추가 (`donor_type`, `donor_channels`, `prospect_subtype`, `donor_evaluated_at`)
- `migrate-add-members-donor-type.ts`
- `cron-donor-status-sync.ts` 신규
- 정기/잠재 화면 (placeholder → 본격)
- `auth-toss-billing-issued.ts` 등 토스 후크에 donor_type 즉시 반영

**A는 위 영역 건드리지 말 것**. `admin-members.ts`는 A 영역이지만 schema.ts members 정의 추가는 B가 함 — A는 컬럼이 없을 때 'none' fallback으로 동작하면 됨.

`schema.ts` 수정 시 append-only + 본인 섹션 헤더 (`/* === A: m16-step-b === */`) 원칙 (CLAUDE.md §9.1.6).

---

## 머지 전 체크

- [ ] DEMO 제거 후 cms-tbfa 화면 정상 동작
- [ ] 필터 4가지(source) × 4가지(donorType) 콤비 검증
- [ ] 회원 상세 모달 + 후원 내역 탭 정상
- [ ] 캐시버스터 갱신 (`cms-tbfa.js?v=2026-05-10-c4`)
- [ ] B 영역 파일 미수정
- [ ] 응답 키 다중 fallback (`data.data.X || data.X`)
- [ ] `requireAdmin` 가드 + `auth.res` 반환

---

## 시작 메시지 템플릿

```
[A 채팅 — 6순위 #16 단계 B 시작]

워크트리: ../tbfa-mis-A @ feature/m16-step-b @ aa7305d
역할: 통합회원 실제 API + 상세 모달 (DEMO 제거)
설계서: docs/milestones/2026-05-10-donor-system.md §2 정독
가이드: docs/HANDOFF_A.md 정독

CLAUDE.md §14 컨텍스트 다이어트 정책 준수.
PROJECT_STATE §3·§7만 발췌 정독.
B 영역 (schema.ts members 컬럼 추가, donor_type 화면, 토스 후크) 회피.

작업 시작 전 단계 B 작업 항목 9개(B1~B9) 분배 계획 보고 부탁.
```
