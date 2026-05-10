# Phase 19 — 핵심 API 헬스체크 스크립트

> 설계 확정일: 2026-05-11
> 담당: B(스크립트 작성) + A(없음)
> 선행 조건: Phase 18 머지 완료 (캐시 적용된 상태에서 응답시간 측정 포함)

---

## §0 요구사항 확정

| 항목 | 결정 |
|---|---|
| 스크립트 언어 | Node.js (ESM, .mjs) — 별도 프레임워크 없음 |
| 실행 방법 | `node scripts/healthcheck.mjs` (로컬 + CI 모두 실행 가능) |
| 대상 환경 | 라이브 URL (https://tbfa-siren-cms.netlify.app) |
| 인증 방식 | 어드민 ID·PW를 환경변수로 주입 → 로그인 후 쿠키 추출 → 이후 요청에 사용 |
| 체크 항목 | 핵심 API 15개 (401·405·200 상태코드 + 응답시간) |
| 실패 기준 | 상태코드 불일치 또는 응답시간 3000ms 초과 |
| 출력 | 터미널 컬러 표 (PASS ✅ / FAIL ❌) + 최종 요약 |
| 저장 위치 | `scripts/healthcheck.mjs` (신규 디렉토리) |
| 신규 테이블 | 없음 |
| 프론트 변경 | 없음 |

---

## §1 DB 설계

신규 테이블 없음. 마이그레이션 불필요.

---

## §2 API 명세

### 2.1 헬스체크 대상 15개

| # | 경로 | 메서드 | 예상 상태코드 (인증 전) | 예상 상태코드 (인증 후) | 비고 |
|---|---|---|---|---|---|
| 1 | `/api/admin-login` | POST | 200 (인증 전 공개) | — | 로그인 자체 |
| 2 | `/api/admin-me` | GET | 401 | 200 | 세션 확인 |
| 3 | `/api/admin-members` | GET | 401 | 200 | 회원 목록 |
| 4 | `/api/admin-donations` | GET | 401 | 200 | 후원 목록 |
| 5 | `/api/admin-donation-dashboard` | GET | 401 | 200 | 대시보드 (캐시 포함) |
| 6 | `/api/admin-members-source-kpi` | GET | 401 | 200 | 가입경로 KPI (캐시 포함) |
| 7 | `/api/admin-incidents-list` | GET | 401 | 200 | 사건신고 목록 |
| 8 | `/api/admin-harassment-list` | GET | 401 | 200 | 괴롭힘신고 목록 |
| 9 | `/api/admin-support-list` | GET | 401 | 200 | 유족지원 목록 |
| 10 | `/api/admin-agency-list` | GET | 401 | 200 | 외부기관 목록 (Phase 14) |
| 11 | `/api/admin-expert-profile-get` | GET | 401 | 200 | 전문가 목록 (Phase 15) |
| 12 | `/api/admin-dashboard-kpi` | GET | 401 | 200 | 통합 KPI (Phase 16) |
| 13 | `/api/admin-audit-list` | GET | 401 | 200 | 감사 로그 (Phase 17) |
| 14 | `/api/admin-send-jobs-list` | GET | 401 | 200 | 발송 작업 목록 |
| 15 | `/api/admin-login` | DELETE | 200 | — | 로그아웃 (쿠키 정리) |

### 2.2 스크립트 구조

```
scripts/
└── healthcheck.mjs   ← 단일 파일
```

실행 흐름:
1. 환경변수 `HC_BASE_URL`, `HC_ADMIN_ID`, `HC_ADMIN_PW` 읽기
2. POST `/api/admin-login` → Set-Cookie 헤더에서 쿠키 추출
3. 401 체크 목록 (인증 전): GET 요청 → 401 확인
4. 인증 후 체크 목록: 쿠키 포함 GET 요청 → 200 확인 + 응답시간 측정
5. 결과 표 출력 + 실패 건수 요약
6. 실패 1건 이상 시 process.exit(1) (CI 연동 대비)

---

## §3 화면 설계

프론트 변경 없음.

---

## §4 검증 시나리오

| ID | 시나리오 | 기대 결과 |
|---|---|---|
| Q1 | `node scripts/healthcheck.mjs` 실행 (환경변수 미설정) | 에러 메시지 출력 후 종료 |
| Q2 | 환경변수 설정 후 실행 | 로그인 성공, 15개 API 체크 시작 |
| Q3 | PASS 케이스 확인 | 모든 401·200 상태코드 일치 항목 ✅ 표시 |
| Q4 | 응답시간 3000ms 이내 확인 | 모든 항목 3000ms 미만 |
| Q5 | 캐시 적용 API (Q5·Q6) 응답시간 | 2회차 호출 시 1회차보다 빠른 응답 기록 |
| Q6 | 최종 요약 출력 | "15/15 PASS" 메시지 |
| Q7 | 회귀 — 기존 API 정상 동작 | Phase 14~18 API 포함 전부 200 |

---

## §5 mock 데이터

스크립트 단독 실행 — mock 불필요.

---

## §6 채팅 시작 프롬프트

### 6.1 B 채팅 — 스크립트 작성

```
[B — Phase 19 핵심 API 헬스체크 스크립트 작성]

모델: Sonnet 4.6
워크트리: ../tbfa-mis-B
브랜치: feature/phase19-healthcheck ← 반드시 새로 생성 (git checkout -b feature/phase19-healthcheck origin/main)
설계서: docs/milestones/2026-05-11-phase19-healthcheck.md

영역: scripts/ (신규 디렉토리)
금지: public/, assets/, netlify/functions/, lib/, db/, drizzle/, PROJECT_STATE.md, docs/HANDOFF.md, docs/

━━━ 신규 파일 1개 ━━━
scripts/healthcheck.mjs

환경변수:
  HC_BASE_URL   예: https://tbfa-siren-cms.netlify.app
  HC_ADMIN_ID   어드민 이메일
  HC_ADMIN_PW   어드민 비밀번호

실행 흐름:
  1. 환경변수 검증 (없으면 에러 출력 + exit 1)
  2. POST {HC_BASE_URL}/api/admin-login → 쿠키 추출
  3. 아래 15개 API 순서대로 체크
  4. 결과 표 출력 (항목명 / 상태코드 / 응답시간ms / PASS|FAIL)
  5. 실패 1건 이상 시 exit(1)

━━━ 체크 목록 (설계서 §2.1 그대로) ━━━
인증 전 401 확인:
  GET /api/admin-me
  GET /api/admin-members
  GET /api/admin-donations
  GET /api/admin-donation-dashboard
  GET /api/admin-members-source-kpi
  GET /api/admin-incidents-list
  GET /api/admin-harassment-list
  GET /api/admin-support-list
  GET /api/admin-agency-list
  GET /api/admin-expert-profile-get?all=true
  GET /api/admin-dashboard-kpi
  GET /api/admin-audit-list
  GET /api/admin-send-jobs-list

인증 후 200 확인 + 응답시간 측정:
  (위 목록 동일, 쿠키 포함)

로그아웃:
  DELETE /api/admin-login (또는 POST /api/admin-logout — 실제 경로 확인 후 사용)

━━━ 출력 예시 ━━━
┌─────────────────────────────────┬──────┬────────┬──────┐
│ API                             │ Code │  Time  │ 결과 │
├─────────────────────────────────┼──────┼────────┼──────┤
│ GET /api/admin-me (인증전)      │  401 │   45ms │  ✅  │
│ GET /api/admin-me (인증후)      │  200 │  120ms │  ✅  │
│ ...                             │      │        │      │
└─────────────────────────────────┴──────┴────────┴──────┘
결과: 15/15 PASS (총 소요: 2340ms)

━━━ push 전 체크 (이것만 틀려도 머지 불가) ━━━
  □ 브랜치명: feature/phase19-healthcheck (새로 생성했는가?)
  □ scripts/healthcheck.mjs 파일 존재
  □ 환경변수 미설정 시 에러 출력 + exit(1)
  □ 15개 API 전부 체크 (인증 전 401 + 인증 후 200)
  □ 실패 시 process.exit(1)
  □ npx tsc --noEmit 해당 없음 (mjs 파일) — node scripts/healthcheck.mjs --dry-run 등 실행 가능한지 확인

push 후 메인에 보고: 브랜치명·커밋 해시·변경 파일 요약.
```

### 6.2 A 채팅 — 해당 없음

Phase 19는 스크립트 전용 (프론트 변경 없음). A는 Phase 17 트리거 대기 또는 다음 Phase 대기.

### 6.3 C 채팅 — 검증·fix

```
[C — Phase 19 헬스체크 스크립트 검증·fix]

모델: Opus 4.7
워크트리: ../tbfa-mis-C
브랜치: verify/phase19 (베이스 main @ B 머지 후 커밋)
정독: docs/milestones/2026-05-11-phase19-healthcheck.md §4

작업 순서:
  1) scripts/healthcheck.mjs 실행 (환경변수 미설정 → 에러 확인)
  2) 환경변수 설정 후 재실행 → §4 Q1~Q7 순서대로 실행·기록
  3) 응답시간 표 캡처 (ms 단위)
  4) bug 발견 시 fix 커밋 → 메인 보고
  5) 보고서 docs/verify/2026-05-11-phase19.md 작성
  6) push → 메인 보고

표현 규칙: 함수명·코드 용어 없이 사용자 동작·결과 위주.
금지: PROJECT_STATE.md, docs/HANDOFF.md 수정.

환경변수 (C 워크트리에서 실행 시):
  HC_BASE_URL=https://tbfa-siren-cms.netlify.app
  HC_ADMIN_ID={어드민 이메일}
  HC_ADMIN_PW={어드민 비밀번호}
```

---

## §7 라운드 마감 체크리스트

- [ ] feature/phase19-healthcheck B push 완료
- [ ] 메인: scripts/healthcheck.mjs 존재·실행 가능 확인
- [ ] 메인: feature/phase19-healthcheck 머지
- [ ] C 검증 트리거 발송 (환경변수 Swain이 C에 전달)
- [ ] verify/phase19 머지
- [ ] PROJECT_STATE.md §5 Phase 19 → ✅ 100% 갱신
