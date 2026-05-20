# SIREN — 작업 인수인계 (HANDOFF)

> **단일 최신 파일**. "지금 어디까지 왔는지" 한 화면에 들어오게 유지.
> 새 메인 채팅 시작 시 정독.
> 이전 시점 스냅샷은 [`docs/history/handover/v20.md`](../history/handover/v20.md) 영구 archive (자발적 안 읽음).
>
> **마지막 갱신**: 2026-05-20 24:00 KST / **R39 정식 종결·라이브 검증 15/15 PASS·메뉴얼 300문항 통합·R40 KICC 대기**
> 새 메인 채팅 진입 시 본 문서 → PROJECT_STATE.md → docs/rules/REMAINING_WORK.md 순서로 정독

---

## 1. 프로젝트 (요약)

**SIREN(싸이렌)** = (사)교사유가족협의회 통합 NPO 플랫폼.

- 라이브: <https://tbfa.co.kr> (공식 메인) / <https://tbfa-siren-cms.netlify.app> (Netlify 기본)
- 베이스 브랜치: `main`
- 상세 스택·환경·구조: [`CLAUDE.md`](../../CLAUDE.md) §1~5

운영 완성도 (2026-05-20 기준 — 명세 정합 시리즈 종결):
- 🟢 **근태관리 시스템**: 정합도 93.4% (5축 가중 평균) — 즉시 운영 가능
- 🟢 **성과관리 시스템**: 정합도 96.7% — 즉시 운영 가능
- 🟢 **급여 통합 (R37)**: 자동 집계·PDF 명세서·이메일 일괄 발송·CSV 22컬럼 회계 export 완비
- 🟢 교유협 자체 운영: 약 95%+ (실제 운영 단계)

---

## 2. 새 메인 채팅이 시작 시 해야 할 일

```
1) 본 HANDOFF.md 정독
2) docs/README.md (문서 4영역 구조 진입점) 정독
3) PROJECT_STATE.md §2·§5 정독
4) docs/rules/REMAINING_WORK.md 정독 — 잔여 작업 인벤토리
5) memory/MEMORY.md 인덱스 + feedback_* 메모리 본문 정독
   특히: feedback_design_routine·feedback_single_session·feedback_progress_reporting
6) Swain과 다음 작업 확정 후 진행
```

---

## 3. 2026-05-20 명세 정합 시리즈 종결 (R29 ~ R37 — 7라운드)

### 3.1 7라운드 누적 성과

| 라운드 | 내용 | 종결 시점 |
|---|---|---|
| R29 | 근태·성과 1차 갭 fix (P1·P2) | 2026-05-19 |
| R30 | KST 표시 통일 | 2026-05-19 |
| R31 | 근태·성과 2차 갭 분석 | 2026-05-19 |
| R32 | sql.raw 파라미터 미바인딩 BUG fix (7개 함수) | 2026-05-19 |
| R33 | sql.raw 잔존 3건 + HYBRID 키 변환 | 2026-05-19 |
| R34 | 인증 모델 통일 (operator-guard 토큰 fallback) + amend 통합 | 2026-05-19 |
| R35 | Light B base_salary UI + Final P1·P2 (H 5 + M·🟡 16) | 2026-05-20 |
| R36 | 근태 부가 5건 (역방향 신청·외근지 선택·연속 재택 알림·3회 지각·WBS 자동 카드) | 2026-05-20 |
| R37 | 급여 통합 (자동 집계·PDF·이메일·CSV·마이페이지·6~7일 단일 라운드) | 2026-05-20 |

### 3.2 정합도 v1 → v2

| 시스템 | R35 종결 | R37 종결 | 상승 |
|---|---|---|---|
| 근태관리 | 87.9% | **93.4%** | +5.5p |
| 성과관리 | 96.0% | **96.7%** | +0.7p |
| 평균 | 92.0% | **95.1%** | +3.1p |

### 3.3 검증 합산
- E2E 12 시나리오 ALL PASS
- R37 Q1~Q10 ALL PASS + R36 회귀 8/8
- R35 P1 7/7 + P2 16/16 = 23/23 ALL PASS
- R29~R34 누적 fix 회귀 ALL PASS
- BUG 0건

### 3.4 거시 결함 모두 해소
1. drizzle sql.raw 파라미터 미바인딩 (14개 함수)
2. 인증 모델 분리 (R34-P1-A user/admin JWT fallback)
3. HYBRID 키 변환 (R32-P0 → R33-P0)
4. UPSERT 출근 데이터 무결성 (R35 H-G2)
5. 사일런트 권한 토글 (R35 H2 UI 안내)
6. AI 자동 매칭 알림 누락 (R35 H3)
7. 워크스페이스 6페이지 인증 통일 (R35 H-G1)
8. work_mode·거점·정책·wbsCards UX 격차 (R35 M-G1~G7)
9. 결산 사유 가시성·cron 임계점 누락·throw 500 (R35 M1·M4·M5)
10. AI 임계 환경변수화·SI 정렬 명시 (R35 🟡A·🟡B)
11. §9 급여 자동 집계 미연결 (R37로 해소)
12. §14 CSV·base_salary·PDF·이메일 (R37로 해소)

---

## 4. 🟢 운영 시작 공식 선언 (2026-05-20)

**근태관리 + 성과관리 + 급여 통합 시스템 — 즉시 운영 시작 가능**

### Swain 운영 시작 권장 액션
1. **회원별 base_salary 입력** 선행 (어드민 → 회원 상세 모달 → 기본연봉 입력)
2. **분기 결산 PAID 처리** 후 익월 1일 cron-payroll-monthly 자동 흐름 진입
3. R36/R37 사용 패턴 1~2분기 관찰 → 잔여 영역 중 가치 있는 항목 선별 보강

### 운영 닫힘 흐름 (R37 종결 후)
```
근태(att_records) → working_mins·overtime_mins·휴가 집계
      ↓
성과(quarterly_settlements PAID) → totalBonus 월 안분
      ↓
members.baseSalary → base_salary_month
      ↓
cron-payroll-monthly (매월 1일 02:00) → payroll_slips UPSERT
      ↓
어드민 검토·승인 → PDF 생성 → 이메일 일괄 발송 (Resend batch)
      ↓
직원 마이페이지 → 본인 명세서 PDF 다운로드
      ↓
CSV export → 외부 회계 시스템 (세금·4대보험 처리)
```

---

## 5. 잔여 영역 (운영 학습 단계·선택적)

### 근태 6.6% (§6.2 부가 8건)
- 외근지 즐겨찾기·재택 사진·셀카·체크리스트·위젯·비교 뷰·다국어·IP 패턴
- 운영 후 사용 패턴 관찰하며 선별 도입

### 성과 3.3% (옵션·후속)
- rolePermissions milestone:* 실 미연결 (UI 안내 차단됨·옵션 B 후속)
- AI 증빙 검토 보조 (Gemini Vision 페이즈)
- 팀 보너스 옵션 (명세 §13.2 "가능")

### Phase 23 재정 v3.0
- 최소 2026-08-20 이후 (3개월 뒤) 별도 합의 후 진행

---

## 6. 문서 4영역 구조 (2026-05-20 정착)

`docs/README.md` 참조. 핵심 진입:
- **rules/**: HANDOFF·REMAINING_WORK·PARALLEL·PAGES·CONTEXT·policies·standards
- **specs/**: 명세 마스터 7개 (근태·성과·재정 + phase24·26·27·28)
- **active/**: 진행 중 라운드 (현재 비어있음)
- **history/**: 완료 히스토리 (milestones·verify·gap·analysis·통합 archive)

---

## 7. R39 정식 종결 (2026-05-20) — 완료 기록

- **Stage 1~8 전부 머지 + 라이브 검증(메인 직접) 15/15 PASS**
- 라이브 검증 BUG 2건 즉시 fix:
  - BUG-R39V-01: operator-guard tsc narrowing 사전 5건 (런타임 0·`operatorGuardFailed` 헬퍼 적용)
  - BUG-R39V-02: att-checkin/checkout deviceType 미수신·미저장 (att_records.device_type NULL 방지)
- 메뉴얼 2종 + AI 학습 자료 300문항 통합 (`public/manual*.html`·`docs/manual/`)
- 설계서 → `docs/history/milestones/2026-05-20-r39-roles-and-ux.md` archive
- 라운드 종결 체크리스트 15가지 메모리 등록 (`memory/release_checklist.md`)

### Swain 브라우저 라이브 확인 권장 (잔여)
- 워크툴 상단 출퇴근 버튼 위치 (상태 메시지 옆 시각 확인)
- 어드민 → 운영 관리 → 비매출 검토 4가지 액션
- 워크스페이스 진입 속도 체감

## 8. 다음 메인 채팅이 할 일 (즉시 진행)

### 우선 1. R40 PG 전환 (토스 → KICC) — Swain 옵션 결정 후 시작
- `docs/kicc.md` 정독 완료·**옵션 A(듀얼 PG 점진 전환) 추천**
- 기존 토스 빌링키는 KICC 마이그 불가(체계 완전 다름) → 신규만 KICC·기존은 토스 cron 자연 종료
- Swain 결정 대기: ① 기존 토스 정기 후원 회원 규모 ② 옵션 A/B/C 확정
- KICC 추가 문서 필요(빌키 발급·자동 결제·해지·조회 — 현재 kicc.md엔 일시 결제·웹훅 위주)

### 우선 2. 메뉴얼 R39 기능 본문 갱신
- 메뉴얼에 R39 기능 '예정' 표기 → 실제 안내로 갱신
- `docs/manual/ai-training-cms-2.jsonl` R39 표시 문항도 본 기능 안내로

### R40 후속 예약
- **PG 전환 (토스 → KICC)** — `docs/kicc.md` 정독 완료·옵션 A(듀얼 PG 점진 전환) 추천
  - 기존 토스 빌링키 회원은 KICC로 마이그 불가(체계 완전 다름·KICC cardNo vs 토스 customerKey)
  - 신규 회원만 KICC·기존 회원은 토스 cron 자연 종료까지 유지
  - KICC 추가 문서 필요(빌키 발급·자동 결제·해지·조회 — 현재 kicc.md엔 일시 결제·웹훅 위주)
  - Swain 결정 필요: 기존 토스 정기 후원 회원 규모 + 옵션 A/B/C 확정
- Netlify 배포 시간 단축 (netlify-plugin-cache·dead code 정리)
- RAG 인프라 구축 (Q&A 300문항 임베딩·Gemini Embedding·검색 로직)
- 운영 사용 패턴 관찰 후 §6.2 부가 8건 선별
- Phase 23 재정 v3.0 (2026-08-20 이후 별도 합의)

---

## 9. 갱신 정책

- 새 라운드 종결 후 §3·§4·§5·§8 갱신
- 단일 최신 유지 (이전 시점 보존 시 `docs/history/handover/vN.md`로 archive)
- §2 진입 흐름은 정독 순서 변경 시만 갱신
