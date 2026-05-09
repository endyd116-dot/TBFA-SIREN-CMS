# Phase 1 역할 분담 — 가벼운 버전

> **작성**: 2026-05-10 / 메인 채팅
> **전제**: [PHASE_PROPOSAL.md](PHASE_PROPOSAL.md) 시나리오 B 채택 가정
> **Phase 1 정의**: 마일스톤 #16 단계 B + 6순위 #6/#15 사용자 검증
> **추정**: 2.5~3.5h (단계 B 1.5~2.5h + 검증 1h)

---

## 1. 역할 분담 (Phase 1 한정)

### Main 채팅 (`tbfa-mis`, `main`)
- **#16 단계 B 코드 작성·통합·머지·push 전담**
- 검증 시나리오 안내 작성 (Swain용 체크리스트)
- 머지 후 PROJECT_STATE.md §4.6 + §6.6 갱신

### A 채팅 (`../tbfa-mis-A`, `feature/eligibility-change`)
- **Phase 1에서는 휴면**. 작업 A 코드는 main 머지 완료, 이번 사이클은 검증만 (Swain 직접)
- Phase 2(시나리오 B)부터 활성화 — #16 단계 C의 schema 헤더 + migrate 함수 보조

### B 채팅 (`../tbfa-mis-B`, `feature/csv-donation-mapping`)
- **Phase 1에서는 휴면**. #15 코드 main 머지 완료, 검증 대기
- Phase 3(시나리오 B)부터 활성화 — #16 단계 D의 효성 billings 파서 + cron

> **왜 Phase 1만 단독?** 단계 B는 본질적으로 cms-tbfa 단일 도메인에 집중되며, 파일 의존성 그래프가 한 영역(통합 회원 화면)에 모임. 분할 시 통신·동기화 비용이 작업량보다 큼. 병렬화 효과는 Phase 2·3에서 발휘.

---

## 2. 파일 소유권 매트릭스 (Phase 1)

| 파일 | 책임 | 변경 유형 | 비고 |
|---|---|---|---|
| `public/js/cms-tbfa.js` | Main | DEMO_* 제거 + 실제 fetch 전환 + 회원 상세 모달 호출 | #BUG-2 직접 해결 지점 |
| `netlify/functions/admin-members.ts` | Main | `?source=` `?donorType=` 필터 추가 (확장) | 시그니처 호환 유지 |
| `netlify/functions/admin-member-donations.ts` | Main | 신규 생성 (없을 시) — 회원별 후원 이력 GET | `export const config = { path }` 필수 |
| `public/cms-tbfa.html` | Main | 회원 상세 모달 마크업 + 캐시버스터 갱신 | |
| `public/css/cms-tbfa.css` | Main | 모달 스타일 | append-only |
| `db/schema.ts` | (변경 없음) | 단계 C에서 처리 | Phase 1은 schema 무변경 |
| `lib/auth.ts` / `lib/admin-guard.ts` | ⛔ 변경 금지 | settings.json deny | 회귀 위험 |

---

## 3. 작업 의존성 그래프 (Phase 1)

```
[1] admin-member-donations.ts API 확인/신규
        │ (먼저 백엔드 준비)
        ▼
[2] admin-members.ts 필터 확장 (?source=, ?donorType=)
        │ (서버측 완료)
        ▼
[3] cms-tbfa.js — DEMO_MEMBERS·DEMO_WEB_DONORS·DEMO_TAGS 제거
        │
        ▼
[4] cms-tbfa.js — 실제 admin-members API fetch + 가입경로/후원 상태 뱃지
        │
        ▼
[5] cms-tbfa.html — 회원 상세 모달 마크업
        │
        ▼
[6] cms-tbfa.js — 회원 클릭 → 상세 모달 + 후원 내역 탭 (admin-member-donations)
        │
        ▼
[7] 캐시버스터 일괄 갱신 (?v=2026-05-10-c4)
        │
        ▼
[8] 머지 푸시
        │
        ▼
[9] Swain 검증 — 통합 회원 / 회원 상세 / #6 / #15
```

---

## 4. Mock 전략

- **DEMO_*** 를 제거하는 것이 Phase 1의 핵심이므로 mock 도입 없음. 실제 API 직결.
- 검증 데이터: 효성 contracts CSV로 100% 매칭됐던 **지주은·박두용** 등 실제 회원 가시성으로 성공 판정.

---

## 5. 통합 시점

Main 단독 작업이라 통합 절차가 단순:

1. 작업 시작 — Main 채팅이 main 폴더에서 직접 진행
2. 1~3 커밋(API 확장 / UI 전환 / 모달) 정도로 분리
3. `git push origin main` (settings.json 정비로 자유로움)
4. Netlify 자동 배포 1~2분
5. Swain 검증 시나리오 안내

A·B 채팅은 Phase 1에서 휴면이라 충돌·동기화 이슈 없음.

---

## 6. 검증 시나리오 (Swain 액션)

### #16 단계 B 검증
- [ ] cms-tbfa 통합 회원 탭 → 진짜 회원 명단 표시 (DEMO 0)
- [ ] 회원 클릭 → 상세 모달 + 후원 내역 탭 정상
- [ ] 가입경로/후원 상태 뱃지 표시
- [ ] 검색·필터·페이지네이션 동작

### 6순위 #6 자격 변경 검증
- [ ] 마이페이지 → 자격 변경 탭 진입 (500 에러 없음)
- [ ] 신청 제출
- [ ] 어드민 화면 → 자격 심사 대기 목록에 표시
- [ ] 승인/반려 처리

### 6순위 #15 CSV 자동 매핑 검증
- [ ] 어드민 → CSV 자동 매핑 탭
- [ ] 효성 contracts CSV 업로드 (또는 IBK)
- [ ] 자동 매칭 점수 표시
- [ ] 1건/일괄 확정 처리
- [ ] 확정 후 단계 B에서 추가된 후원 내역 탭에 반영 확인

---

## 7. Phase 1 종료 조건

- [ ] 위 검증 시나리오 모두 통과
- [ ] PROJECT_STATE.md §4.6 단계 B ✅ 갱신
- [ ] PROJECT_STATE.md §6.6 #BUG-2 ✅ 갱신
- [ ] PROJECT_STATE.md §2 마지막 업데이트 행 추가
- [ ] git push origin main
- [ ] Phase 2 시작 준비 (시나리오 B의 #16 단계 C)

---

## 8. Phase 2·3 미리보기 (구체화는 Phase 1 완료 후)

| Phase | 핵심 | 책임 | 추정 |
|---|---|---|---:|
| 2 | #16 단계 C — donor_type 4개 컬럼 + migrate + 정기/잠재 화면 + 토스 즉시 반영 hook | Main(주) + A(보조: schema 헤더, migrate 함수 사전 작성) | 3~4h |
| 3 | #16 단계 D — 효성 billings 파서 + cron-donor-status-sync + 대시보드 강화 | Main(대시보드) + B(파서·cron) | 3~5h |

Phase 2·3 정식 분담은 Phase 1 종료 시점에 별도 갱신.
