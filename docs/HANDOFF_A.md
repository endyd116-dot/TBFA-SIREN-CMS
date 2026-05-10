# A 채팅 시작 프롬프트 — 6순위 #16 단계 D (파서·백엔드 담당)

> **워크트리**: `../tbfa-mis-A` @ `feature/m16-step-d-parser`
> **베이스**: `main` @ `62f540c`
> **추정**: 3~4h (D1·D2·D5·D6)
> **설계서**: [docs/milestones/2026-05-10-donor-system.md](milestones/2026-05-10-donor-system.md) §4

---

## 작업 영역 (A 전담 — 파서·백엔드)

| 항목 | 파일 | 내용 |
|---|---|---|
| **D1** | `lib/hyosung-members-parser.ts` (신규) | 효성 회원관리 CSV/엑셀 파서 — 회원 매핑 + SIREN 신규 생성 |
| **D2** | `lib/hyosung-billings-parser.ts` (신규) | 효성 수납내역 CSV/엑셀 파서 — 청구·수납·미납·취소·환불 흡수 + donations 적재 |
| **D5** | `netlify/functions/cron-donor-status-sync.ts` (수정) | donor_type 식별 SQL — 효성 컬럼 기반 강화 |
| **D6** | 토스 빌링 후크 (수정) | 결제 발생 즉시 `donations` + `members.donor_*` 동시 갱신 (CSV 무관, 실시간) |

### D1 — 효성 회원관리 파서 상세
- 효성 CSV 컬럼: 회원번호·이름·연락처·이메일·약정일·결제수단·계약상태
- 기존 SIREN 회원과 이름+연락처로 매칭 → 있으면 `hyosung_member_no` 업데이트
- 없으면 신규 회원 생성 (`signup_source_id` = 효성 경로)
- SIREN 고유 컬럼(등급·메모·태그) 보존

### D2 — 효성 수납내역 파서 상세
- 효성 CSV 컬럼: 회원번호·청구월·청구액·수납액·수납일·상태(정상/미납/취소/환불)
- `hyosung_member_no` 기반 회원 매칭 → `donations` 테이블 적재
- 중복 방지: `hyosung_bill_no` + `hyosung_billing_month` 고유 확인

---

## B 영역 회피 (중요)

B 채팅(`feature/m16-step-d-ui`)이 동시에 작업하는 영역:
- `public/cms-tbfa.html` (통합 회원 화면·정기 후원자 화면 컬럼 보강)
- `public/js/cms-tbfa.js` (D3·D4 화면 렌더링)
- 종합 검증 대시보드 (D7 — cms-tbfa.html 내 섹션)

**A는 위 파일 건드리지 말 것.** schema.ts는 수정 없음 (단계 C에서 이미 donor_type 컬럼 추가됨).

---

## 머지 전 체크

- [ ] D1 파서: CSV 헤더 자동 감지 + 오류 행 건너뜀 처리
- [ ] D1: 회원 매칭 실패 시 신규 생성 (중복 방지 확인)
- [ ] D2 파서: 수납 상태 5종 정상 분기
- [ ] D2: donations 중복 삽입 방지 (`hyosung_bill_no` unique 확인)
- [ ] D5: SQL 4종 정상 실행 (cron 로그 확인)
- [ ] D6: 토스 결제 즉시 반영 — members.donor_type 갱신 확인
- [ ] B 영역 파일 미수정
- [ ] 응답 키 다중 fallback 적용

---

## 시작 메시지 템플릿

```
[A 채팅 — 6순위 #16 단계 D 파서·백엔드 시작]

워크트리: ../tbfa-mis-A @ feature/m16-step-d-parser @ 62f540c
역할: D1(효성 회원파서) + D2(효성 수납파서) + D5(cron 강화) + D6(토스 즉시반영)
설계서: docs/milestones/2026-05-10-donor-system.md §4.4 정독
가이드: docs/HANDOFF_A.md 정독

B 영역(cms-tbfa.html·js 화면 보강) 회피.
schema.ts 수정 불필요 (단계 C에서 donor_type 이미 존재).

작업 시작 전: 기존 lib/hyosung-parser.ts, lib/ibk-parser.ts 패턴 파악 후 D1·D2 작성.
```
