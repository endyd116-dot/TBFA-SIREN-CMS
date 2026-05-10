# SIREN — 작업 인수인계 (HANDOFF)

> **단일 최신 파일**. "지금 어디까지 왔는지" 한 화면에 들어오게 유지.
> 새 메인 채팅 시작 시 정독.
> 이전 시점 스냅샷은 [`docs/handover/v*.md`](handover/) 영구 보관(자발적 안 읽음).
>
> **마지막 갱신**: 2026-05-11 / Phase 15+16 C 검증 완료 / 메인 머지 대기

---

## 1. 프로젝트 (요약)

**SIREN(싸이렌)** = (사)교사유가족협의회 통합 NPO 플랫폼.

- 라이브: <https://tbfa-siren-cms.netlify.app>
- 베이스 브랜치: `main`
- 상세 스택·환경·구조: [`CLAUDE.md`](../CLAUDE.md) §1~5

---

## 2. 새 메인 채팅이 시작 시 해야 할 일

```
1) 본 HANDOFF.md 정독 (지금 읽고 있음)
2) PROJECT_STATE.md §2·§3·§5·§7 정독
3) docs/PARALLEL_GUIDE.md §1~§3 정독
4) 본 §3 (지금 진행 중인 일) 확인
5) B·A·C 채팅 진행 상황을 Swain께 확인
6) 보고 온 채팅 있으면 즉시 머지 순서대로 처리
```

---

## 3. 지금 진행 중인 일 (이전 메인 채팅 종료 시점)

### 3.1 Phase 15 — 전문가 매칭 고도화 C 검증 완료, 머지 대기

**상태**: C 검증 브랜치 `verify/phase15` 완료 (`43a7aa6`). 메인 머지 필요.

**검증 결과**: Q1~Q9 모두 PASS. 버그 6건 발견·수정.

| BUG | 심각도 | 내용 |
|---|---|---|
| BUG-15-01 | Critical | AI 추천 백엔드가 존재하지 않는 테이블명(`legal_reports`) 사용 → `legal_consultations`로 수정 |
| BUG-15-02 | High | AI 추천 백엔드가 잘못된 컬럼명(`content`) 사용 → 테이블별 실제 컬럼명(`content_html` / `content`) 분리 |
| BUG-15-03 | Critical | 전문가 프로필 저장 API 경로 오타 → 올바른 경로로 수정 |
| BUG-15-04 | Medium | 전문가 프로필 목록 조회 시 필터 파라미터를 백엔드가 미지원 → 전체 조회 후 화면에서 필터링으로 변경 |
| BUG-15-05 | Critical | 매칭 후기 작성 화면이 matchId 없이 초기화돼 항상 오류 → 완료 카드에 [⭐ 후기 작성] 버튼 추가, matchId 연동 |
| BUG-15-06 | High | AI 추천 화면이 matchId만 보내는데 백엔드는 sourceType·sourceId가 없으면 처리 불가 → 백엔드에서 matchId로 원본 정보 자동 조회 |

**보고서**: [`docs/verify/2026-05-11-phase15.md`](verify/2026-05-11-phase15.md)

---

### 3.2 Phase 16 — 통합 분석 대시보드 C 검증 완료, 머지 대기

**상태**: C 검증 브랜치 `verify/phase16` 완료 (`21f6222`). 메인 머지 필요.

**검증 결과**: Q1~Q10 모두 PASS. 버그 2건 발견·수정.

| BUG | 심각도 | 내용 |
|---|---|---|
| BUG-16-01 | High | 통합 분석 대시보드 화면에 기간 선택 버튼이 없어 30일 고정 → [30일][90일][180일][365일] 버튼 추가 및 클릭 시 KPI 재조회 |
| BUG-16-02 | High | 대표 보고서 [연간] 탭 클릭 시 분기 데이터 반환 → 화면 탭값(`yearly`)을 백엔드 인식값(`annual`)으로 매핑 추가 |

**보고서**: [`docs/verify/2026-05-11-phase16.md`](verify/2026-05-11-phase16.md)

---

### 3.3 새 C 채팅에게 (다음 작업)

새 C 채팅은 Swain(사용자)이 다음 검증 작업 트리거를 보낼 때까지 대기.

**C 작업 규칙 (반드시 준수)**:
- 표현 규칙: 함수명·변수명·코드 용어 없이 사용자 동작·결과 위주로 설명
- 금지: `PROJECT_STATE.md`, `docs/HANDOFF.md`, `docs/` 수정 (C는 검증 보고서만 작성)
- worktree: `../tbfa-mis-C` / 현재 브랜치: `verify/phase16`

---

### 3.4 충돌 재발 방지 정책

**A·B·C 채팅은 `PROJECT_STATE.md`, `docs/HANDOFF.md`, `docs/` 수정 절대 금지.**

---

### 3.5 4채팅 구조 (현재)

| 채팅 | 모델 | 역할 | 현재 상태 |
|---|---|---|---|
| 메인 | Opus 4.7 | 설계·머지·조율 | 인수인계 진행 중 |
| A | Sonnet 4.6 | 프론트 (`public/`) | Phase 15+16 완료 후 대기 |
| B | Sonnet 4.6 | 백 (`netlify/functions/`, `lib/`, `db/`) | Phase 15+16 완료 후 대기 |
| C | Opus 4.7 | 검증·fix | Phase 15+16 검증 완료 / 머지 대기 |

**worktree 폴더:**
```
tbfa-mis        (메인) — 머지·조율 전용
../tbfa-mis-A  (A 채팅)
../tbfa-mis-B  (B 채팅)
../tbfa-mis-C  (C 채팅) — 현재 verify/phase16
```

---

### 3.6 머지 순서 (즉시)

```
1. verify/phase15 → main 머지 (C BUG-15-01~06 fix 포함)
2. verify/phase16 → main 머지 (C BUG-16-01~02 fix 포함)
3. PROJECT_STATE.md §5 Phase 15·16 상태 갱신
4. 다음 단계: Phase 17 보안·감사 강화 (또는 Swain과 협의)
```

---

## 4. 즉시 해야 할 일 (새 메인)

```
1. verify/phase15 머지 → main push
2. verify/phase16 머지 → main push
3. PROJECT_STATE.md §5 Phase 15·16 ✅ 표시
4. Swain과 Phase 17 일정 협의 후 A·B 트리거
5. C에게 Phase 17 검증 트리거 (A·B 완료 후)
```

---

## 5. 핵심 정보

### 5.1 반복 사고 패턴 방지

| 날짜 | 사고 | 방지 |
|---|---|---|
| 2026-05-09 | worktree 미분리 충돌 | worktree 강제 |
| 2026-05-09 | schema 영역 덮어쓰기 | B만 schema, append-only |
| 2026-05-09 | #BUG-1 `uid` 필드명 오류 | 헬퍼 도입 직후 사용처 1회 검증 |
| 2026-05-10 | bigserial import 누락 502 | B push 전 `npx tsc --noEmit` 의무 |
| 2026-05-11 | #BUG-8 `auth.admin?.id` undefined | `auth.ctx?.admin?.uid` 직접 참조 |
| 2026-05-11 | #BUG-9 schema 컬럼 누락 (마이그 후 미반영) | 마이그 직후 schema 전수 대조 필수 |
| 2026-05-11 | A가 PROJECT_STATE.md 자발 수정 → 머지 2회 충돌 | A·B·C 트리거 프롬프트 `금지:` 항목에 명시 |
| 2026-05-11 | BUG-15-01 존재하지 않는 테이블명 사용 | 백엔드 테이블명은 schema.ts에서 직접 확인 |
| 2026-05-11 | BUG-15-05 matchId 미연결로 후기 기능 동작 불가 | 기능 단위 end-to-end 흐름 추적 필수 |

### 5.2 마이그레이션 호출 표준

```
어드민 로그인 상태에서 주소창:
https://tbfa-siren-cms.netlify.app/api/migrate-{이름}?run=1
→ { "ok": true } 확인 후 메인에 알림
→ 메인: schema 활성화 + 마이그 파일 삭제 + push
```

### 5.3 requireAdmin 패턴 (반드시 준수)

```typescript
const auth = await requireAdmin(req);
if (!auth.ok) return auth.res;  // 'res' — 'response' 아님
const adminUid = auth.ctx?.admin?.uid;  // id 아님
```

---

## 6. Phase 진행률 스냅샷

| 묶음 | 상태 |
|---|---|
| Phase 1~3, 3-extra | ✅ 100% |
| 4·5·6순위 전체 | ✅ 100% |
| Phase 4 대표 보고 | ✅ 100% |
| Phase 5~7 재정 | ✅ 100% |
| Phase 8 알림 인프라 | ✅ 100% |
| Phase 9 외부 API | ✅ 코드 100% / 🟡 실발송 환경변수 등록 후 자동 |
| Phase 10 R1~R4 | ✅ 100% |
| Phase 11 멘션·구독 | ✅ B+A 머지 / ✅ C 검증 PASS |
| Phase 12 신고 공개·익명 | ✅ B+A 머지 / ✅ C 검증 PASS |
| Phase 13 신고 통계 | ✅ B+A 머지 / ✅ C 검증 PASS |
| Phase 14 AI 어시스턴트 | ✅ B+A 머지 / ✅ C 검증 PASS |
| **Phase 15 전문가 매칭** | ✅ B+A 머지 / 🟣 verify/phase15 머지 대기 |
| **Phase 16 통합 분석** | ✅ B+A 머지 / 🟣 verify/phase16 머지 대기 |
| Phase 17~22 | ⏸ 카탈로그만 |

누적 약 **62%** / 약 580h+

---

## 7. 새 메인 첫 메시지 권장

```
인수인계 정독 완료.

현재 상태:
- Phase 15: C 검증 PASS (verify/phase15 머지 대기)
- Phase 16: C 검증 PASS (verify/phase16 머지 대기)
- 다음: 두 브랜치 머지 후 Phase 17 일정 협의

머지 순서대로 처리 후 Swain께 보고드립니다.
```
