# B 채팅 시작 프롬프트 — 6순위 #16 단계 D (화면·대시보드 담당)

> **워크트리**: `../tbfa-mis-B` @ `feature/m16-step-d-ui`
> **베이스**: `main` @ `62f540c`
> **추정**: 2~3h (D3·D4·D7)
> **설계서**: [docs/milestones/2026-05-10-donor-system.md](milestones/2026-05-10-donor-system.md) §4

---

## 작업 영역 (B 전담 — 화면·대시보드)

| 항목 | 파일 | 내용 |
|---|---|---|
| **D3** | `public/cms-tbfa.html` + `public/js/cms-tbfa.js` | 통합 일반 회원 화면에 효성 양식 컬럼 추가 표시 (약정일·결제수단·계약상태) |
| **D4** | 정기 후원자 화면 (cms-tbfa.js 내) | 효성 양식 컬럼 보강 — 약정일·결제수단·매월 수납 현황 |
| **D7** | CSV 자동 매핑 화면 강화 (cms-tbfa.html 내 섹션) | KPI 상단 + 검증 alert 패널 + 자동 매칭 상태 전이 미리보기 |

### D3 상세
- 통합 회원 목록에 컬럼 추가: 약정일 / 결제수단(CMS이체·카드) / 결제등록상태 / 계약상태 / 상품분류
- 데이터 소스: `hyosung_contract_status`, `hyosung_member_no` (이미 members 테이블 존재)

### D4 상세
- 정기 후원자 목록: 채널(토스/효성) 뱃지 + 약정일 + 결제수단 + 다음 결제일 + 최근 수납 현황
- 데이터 소스: `donor_channels`, `donor_type` (단계 C 컬럼 이미 존재)

### D7 상세
- 상단 KPI 3개: 정기 활성(CMS분리/토스분리) / 잠재(일시·중단) / 검증 alert 건수
- 검증 alert 패널: 정기→중단 자동감지 / 충돌 케이스 / 미매칭 일시 후원
- 자동 매칭 미리보기: 확정 시 어떤 회원이 어떤 donor_type으로 바뀌는지 표시

---

## A 영역 회피 (중요)

A 채팅(`feature/m16-step-d-parser`)이 동시에 작업하는 영역:
- `lib/hyosung-members-parser.ts` (신규)
- `lib/hyosung-billings-parser.ts` (신규)
- `netlify/functions/cron-donor-status-sync.ts`
- 토스 빌링 후크

**B는 위 파일 건드리지 말 것.** 화면에서 A가 만드는 파서를 호출하는 API 엔드포인트가 있다면 함수 시그니처만 가정하고 작성 (A 완료 후 연결).

---

## 머지 전 체크

- [ ] D3: 통합 회원 목록 효성 컬럼 렌더 정상
- [ ] D4: 정기 후원자 화면 채널 뱃지 + 수납 현황 정상
- [ ] D7: KPI + alert 패널 + 미리보기 동작 확인
- [ ] A 영역 파일 미수정
- [ ] 캐시버스터 갱신 (`cms-tbfa.js?v=2026-05-10-d3`)

---

## 머지 순서

A(파서) 완료 후 B(화면)가 A의 파서를 연결하는 부분 있으면 A 먼저 머지. 화면만 독립적이면 동시 머지 가능.

---

## 시작 메시지 템플릿

```
[B 채팅 — 6순위 #16 단계 D 화면·대시보드 시작]

워크트리: ../tbfa-mis-B @ feature/m16-step-d-ui @ 62f540c
역할: D3(통합회원 효성컬럼) + D4(정기후원자 화면 보강) + D7(종합 검증 대시보드)
설계서: docs/milestones/2026-05-10-donor-system.md §4.3·§4.4 정독
가이드: docs/HANDOFF_B.md 정독

A 영역(파서 신규·cron·토스 후크) 회피.
cms-tbfa.js·cms-tbfa.html 집중.

작업 시작 전: 현재 cms-tbfa.html·js 구조 파악 후 D3·D4·D7 순서로 진행.
```
