# Issues Archive — SIREN 프로젝트

> 해결된 이슈 13건의 압축 archive (2026-05-09 ~ 2026-05-14).
> 원본 개별 파일은 git history에서 복구 가능 (`git log -- docs/issues/`).
> PROJECT_STATE.md §6 가 활성 이슈 인덱스.

---

## 인덱스 표

| ID | 날짜 | 키워드 | 심각도 | 한 줄 원인 | Fix 위치 | 커밋 | 상태 |
|----|------|--------|--------|------------|----------|------|------|
| BUG-1 | 2026-05-09 | requireActiveUser uid | Critical | `user.id` 참조, 실제 필드는 `uid` → undefined SQL 파라미터 | `lib/auth.ts:128` | bb529f9 | 해결 |
| BUG-2 | 2026-05-10 | cms-tbfa 더미 데이터 | High | DEMO_MEMBERS/DEMO_WEB_DONORS/DEMO_TAGS 하드코딩, 실 DB 미연결 | `public/js/cms-tbfa.js:60-90` | 마일스톤 #16 단계 B | 해결 |
| BUG-5 | 2026-05-10 | 재정 감사 컬럼 NULL | High | `auth.admin?.id` 이중 오접근(실제는 `auth.ctx.admin.uid`) → silent NULL | `admin-finance-budget-upsert/expenditure-create/expenditure-approve.ts` | (이번 세션) | 해결 |
| BUG-6 | 2026-05-10 | 지출 목록 admins 미존재 | Critical | 존재하지 않는 `admins` 테이블 JOIN (실제는 `members`) | `admin-finance-expenditure-list.ts:39-40` | (이번 세션) | 해결 |
| BUG-7 | 2026-05-10 | 지출 승인 거짓 성공 | High | UPDATE 0행도 ok:true (RETURNING 검증 누락) | `admin-finance-expenditure-approve.ts:35` | (이번 세션) | 해결 |
| BACKFILL-1 | 2026-05-10 | 효성 paid_date NULL 44건 | Medium | billing_id FK 끊김·memo 패턴 부재로 자동 백필 경로 0 | (옛 자료 삭제 후 재 import) | c03c896(Q12) | 해결 |
| BUG-AI-P1-01 | 2026-05-13 | AI 자연어 의도 분류 회귀 | Critical | 시스템 프롬프트 규칙 #2 과다·카테고리 미갱신·description 약함 → 전 도구 호출 불능 | `admin-ai-agent.ts:116-133` | (Phase 1 fix 라운드) | 해결 |
| BUG-AI-P1-02 | 2026-05-13 | Gemini 모델 호출 타임아웃 | Critical | 모델 ID 불일치(`gemini-2.5-flash-lite` vs `gemini-3-flash`)·12초 자체 timeout | `lib/ai-gemini.ts` | (Phase 1 fix) | 해결 |
| BUG-AI-P1-03 | 2026-05-14 | toolApproval 양식 미구현 | Medium | 표준 §17.1 toolApproval 객체 처리 코드 부재, LLM이 빈 입력 보고 "(응답 없음)" | `admin-ai-agent.ts:500` | 명시적 자연어 회피책 채택 | 해결 |
| BUG-AI-P1-04 | 2026-05-14 | task 권한 매핑 오류 | High | super_admin이 admin 위계 인정 안 함 (정확 일치 비교) | `ai_tool_permissions` 시드·권한 체크 로직 | (role hierarchy fix) | 해결 |
| BUG-AI-P1-05 | 2026-05-14 | 인자 자동 추출 부정확 | Medium | 시스템 프롬프트에 현재 날짜 미주입 + 단일 명령 자동 부풀림 | `admin-ai-agent.ts` 시스템 프롬프트 | e74c3f0 | 해결 |
| BUG-AI-P1-05b | 2026-05-14 | notice_category enum 부분 동기화 | Medium | enum 4개 중 general/event만 정정, member/media 누락 + 거부 메시지 옛값 | `lib/ai-agent-tools.ts` notice_create | 3ba204c | 해결 |
| BUG-AI-P1-06 | 2026-05-14 | AI 도구 선택 오류 3건 | High | description 트리거 키워드 부족 → 의미적으로 가까운 다른 도구로 폴백 | `lib/ai-agent-tools.ts` description·시스템 프롬프트 | (Phase 2 fix) | 해결 |
| BUG-AI-P2-02 | 2026-05-14 | notice_create board_posts.content 컬럼 미존재 | High | INSERT 테이블·컬럼 매핑 오류 (notices vs board_posts) | `lib/ai-agent-tools.ts` notice_create | (Phase 2 fix) | 해결 |

---

## 상세 항목

### BUG-1 — requireActiveUser `user.id` undefined (2026-05-09)
**원인**: `UserPayload`는 `uid` 필드만 정의하는데 코드가 `user.id` 참조 → undefined가 SQL 파라미터로 전달 → drizzle `UNDEFINED_VALUE` throw → 500 응답. 5순위 #1 블랙리스트 통합 시 도입된 헬퍼의 잠재 버그.
**Fix**: `user.uid`로 한 줄 수정 (`bb529f9`)
**파일**: `lib/auth.ts:128`
**영향**: 9개 API 동작 불능 (eligibility, board, support, incident/harassment/legal-create, admin-members-blacklist)
**교훈**: 새 헬퍼 도입 직후 모든 사용처 1회 grep 검증 의무화 (CLAUDE.md §9.1.8)

### BUG-2 — cms-tbfa 통합 회원·웹후원자·태그 더미 데이터 (2026-05-10)
**원인**: DEMO_MEMBERS(7명)·DEMO_WEB_DONORS(4명)·DEMO_TAGS 하드코딩으로 실 DB 미연결. CSV 자동 매핑으로 매칭된 실 회원이 cms-tbfa에 표시 안 됨.
**Fix**: 마일스톤 #16 단계 B에서 DEMO_* 제거 + `admin-members` API 재사용 + source/donorType 필터 추가
**파일**: `public/js/cms-tbfa.js:60-90`
**교훈**: 데모 임시값을 운영 코드에 남기지 말 것. 화면 첫 정독 시 실제 DB 연결 여부 즉시 확인.

### BUG-5 — 재정 관리 감사 추적 컬럼 영구 NULL (2026-05-10)
**원인**: `requireAdmin`은 `{ ok, ctx: { admin, member } }` 반환이고 `admin`은 `AdminPayload`(uid 필드)인데, 코드가 `${auth.admin?.id || null}`로 **이중 잘못된 경로** 접근. optional chaining + fallback이 silent NULL 유발.
**Fix**: 3곳 동일 패턴으로 `auth.ctx.admin.uid`로 정정
**파일**: `admin-finance-budget-upsert.ts:26`, `admin-finance-expenditure-create.ts:33`, `admin-finance-expenditure-approve.ts:32`
**교훈**: BUG-1과 동일 구조 — 헬퍼 반환 형식이 작성자 가정과 달라 발생. `auth.ctx.admin.uid` wrapper 함수 추출 검토.

### BUG-6 — 지출 목록 admins 테이블 미존재 (2026-05-10)
**원인**: `LEFT JOIN admins`로 존재하지 않는 테이블 참조. 본 프로젝트 어드민은 `members.type='admin'`으로 저장됨 — schema.ts에 admins 정의 없음, 코드 작성 시 가정 오류.
**Fix**: `LEFT JOIN admins creator/approver` → `LEFT JOIN members creator/approver`
**파일**: `admin-finance-expenditure-list.ts:39-40`
**교훈**: raw SQL 함수의 테이블명을 schema.ts와 grep 교차 검증. 라이브 호출 + 시퀀스 검증으로만 발견 가능한 클래스의 버그.

### BUG-7 — 지출 승인/반려 거짓 성공 응답 (2026-05-10)
**원인**: UPDATE WHERE `status='draft'`가 0행 매칭이어도 `db.execute`가 에러 throw 안 함, 행 수 검증 없이 `ok:true` 반환 → 이미 처리된 지출 재호출 시 거짓 성공.
**Fix**: `RETURNING id` 추가 + `updatedRows.length === 0` 검증 → 409 응답
**파일**: `admin-finance-expenditure-approve.ts:35`
**교훈**: UPDATE/DELETE는 RETURNING + 행 수 검증 패턴 표준화 (CLAUDE.md §6.2 추가 검토). 의미상 무결성 버그는 라이브 시퀀스 검증으로만 발견됨.

### BACKFILL-1 — 효성 paid_date NULL 44건 (2026-05-10)
**원인**: 옛 효성 import 흐름에서 raw 테이블·후원 행 INSERT 시 billing_id FK 미적재 → 자동 매칭 키 없음. 정규식 매칭 0건·billing_id join 0건·회원번호+청구월 join 0건(month 컬럼도 NULL).
**Fix**: 옛 자료 모두 삭제 후 계약 → 수납 파일 순서로 재 import (자동 백필 경로 0이므로 데이터 재 import가 가장 깔끔)
**관련**: Q12 fix 머지 `c03c896` (수입 집계 기준일 → 실 결제일)
**교훈**: import 코드에 billing_id FK 추가하여 신규 import는 정상 join 가능하게 조치. 옛 데이터 분석 정확도 손실 인정.

### BUG-AI-P1-01 — AI 자연어 의도 분류 회귀 (2026-05-13)
**원인**: 시스템 프롬프트 규칙 #2 "의도 모호하면 도구 호출 전 되묻기"가 너무 강함 + 카테고리에 memos/calendar/files 누락 + 도구 description 약함 → AI가 모든 자연어 명령에 되묻기로만 응답. Phase 1 신규 도구 12개와 기존 `members_stats` 모두 실패. 도구명 직접 지정만 작동.
**Fix**: 시스템 프롬프트 규칙 완화 + 카테고리 갱신 + description 강화
**파일**: `admin-ai-agent.ts:116-133`
**교훈**: 시스템 프롬프트 변경 시 의도 분류 회귀 위험 — 의도 분류 sanity check 시나리오 보유 권장.

### BUG-AI-P1-02 — Gemini 모델 호출 전체 타임아웃 (2026-05-13)
**원인**: 폴백 체인이 모두 12초 timeout 실패. 첫 모델로 `gemini-2.5-flash-lite`가 노출되어 CLAUDE.md §7.1 명시 `gemini-3-flash`와 불일치. 시스템 프롬프트 사이즈·콜드 스타트 누적 지연 가능성.
**Fix**: 모델 ID 정정 + 폴백 체인 정합화
**파일**: `lib/ai-gemini.ts`
**교훈**: 모델 ID는 CLAUDE.md §7.1 단일 출처. 폴백 체인 첫 모델은 명시 모델과 일치해야 함.

### BUG-AI-P1-03 — toolApproval 양식 미구현 (2026-05-14)
**원인**: 표준 §17.1에 명시된 `body.toolApproval` 객체 처리 코드가 grep 결과 없음. validation만 통과하고 빈 userMessage로 LLM 흐름 진입 → "(응답 없음)" 반환.
**Fix**: 명시적 자연어("requireApproval false로 진행") 회피책 채택 — short-circuit 처리 (`a46d43a`)
**파일**: `admin-ai-agent.ts:500`
**교훈**: 표준 양식 신설 시 코드 구현 동시 푸시. "응"·"진행" 같은 짧은 표현은 GREETING 패턴으로 빠지므로 명시적 표현 필요.

### BUG-AI-P1-04 — task_create/task_update 권한 매핑 오류 (2026-05-14)
**원인**: `ai_tool_permissions`의 required_role이 `admin`인데 로그인 계정 role은 `super_admin`. 권한 체크가 `role === required_role` 정확 일치 비교 → super_admin이 admin 위계 인정 안 됨.
**Fix**: role hierarchy 도입 (super_admin > admin > member)
**파일**: `ai_tool_permissions` 시드 + 권한 체크 로직
**교훈**: role hierarchy는 권한 모델의 기본 — 도구 시드 작성 시 역할 위계 명시 의무.

### BUG-AI-P1-05 — 인자 자동 추출 부정확 (2026-05-14)
**원인**: ① 현재 날짜 미주입 → "이번 주"를 2023년으로 인식 ② "내일"을 2024-05-17로 인식 (실 2026-05-15) ③ 단일 명령 "더미 작업 만들어줘"를 우선순위별 3개로 자동 부풀림.
**Fix**: 시스템 프롬프트에 현재 날짜 동적 주입 + 인자 description에 "추정 금지" 명시 (`e74c3f0`)
**파일**: `admin-ai-agent.ts` 시스템 프롬프트
**교훈**: AI 인자 추출은 ~70% 정확도(표준 §17.2). 시각 인자는 시스템 프롬프트 동적 주입 + 도구 description에 매핑 힌트 필수.

### BUG-AI-P1-05b — notice_category enum 부분 동기화 (2026-05-14) [중요]
**원인**: 표준 v1.3 §18.12 BUG-05a fix 후 V6 검증에서 부분 적용 확인. notice_category 실제 enum 4개(`general/member/event/media`) 중 `general`·`event`만 정정되고 `member`·`media`는 옛 화이트리스트(`notice/event/press`) 그대로. 거부 메시지에도 옛 값 노출 — misleading.
**Fix**: 화이트리스트 4개 모두 추가 + 거부 메시지 enum 4개로 정정 (`3ba204c`)
**파일**: `lib/ai-agent-tools.ts` notice_create
**교훈 (가장 큰 가치)**: enum·필드명 fix는 **부분 적용 위험**이 큼. 표준 §18.13 "enum 도메인 전수 점검" 의무로 정착 — 메인이 grep으로 도메인 전체 동기화 후 한 번에 끝낼 것. 부분 fix → C가 부분 적용 BUG 재보고 → 라운드 폭증의 대표 사례. 거부 메시지 문자열도 화이트리스트 정정 시 함께 갱신해야 함 (소스 1개 원칙).

### BUG-AI-P1-06 — AI 도구 선택 오류 3건 (2026-05-14)
**원인**: 사용자 명령에 의미적으로 가까운 다른 도구로 폴백. ① "댓글 달아줘"를 task_update(status="doing")로 ② "공지글 작성"을 notice_create(실제는 board_post_create) ③ "캠페인 종료"를 campaigns_update(endDate)로(실제는 campaign_archive). description 트리거 키워드 부족.
**Fix**: 도구 description에 명시 트리거 키워드 추가 + 시스템 프롬프트에 명령→도구 매핑 예시
**파일**: `lib/ai-agent-tools.ts` description·`admin-ai-agent.ts` 시스템 프롬프트
**교훈**: 의미적으로 가까운 도구 쌍(notice/board_post, archive/update)은 description에 트리거 키워드 명시 의무. 한국어 모호 표현("공지" vs "공지글") 매핑 안내 필수.

### BUG-AI-P2-02 — notice_create board_posts.content 컬럼 미존재 (2026-05-14)
**원인**: notice_create 핸들러가 잘못된 테이블(`board_posts`)에 잘못된 컬럼(`content`)으로 INSERT 시도. 정상은 `notices` 테이블에 적절한 컬럼.
**Fix**: notice_create INSERT 테이블·컬럼 매핑 정정
**파일**: `lib/ai-agent-tools.ts` notice_create
**교훈**: 도구 핸들러는 직접 DB 패턴 사용 — schema.ts와 컬럼명 사전 grep 검증. BUG-6과 유사한 정적 검증 필요(테이블·컬럼명 schema 교차 검증).

---

## 교훈 — 카테고리별 패턴

### 1. 필드명·타입 불일치 (BUG-1, BUG-5)
헬퍼 함수의 반환 형식이 작성자 가정과 다를 때 silent NULL 또는 undefined SQL 파라미터 → 광범위 회귀. 두 BUG 모두 동일 구조(BUG-1: `user.id` vs `user.uid` / BUG-5: `auth.admin?.id` vs `auth.ctx.admin.uid`). 해결책은 **헬퍼 도입 직후 모든 사용처 1회 grep 검증**(CLAUDE.md §9.1.8). 장기적으로 TypeScript strict + wrapper 함수 추출로 컴파일 타임에 잡히게 검토.

### 2. DB 테이블·컬럼명 미존재 (BUG-6, BUG-AI-P2-02)
raw SQL 또는 도구 핸들러의 테이블·컬럼명이 schema.ts와 어긋남. 본 프로젝트는 `admins` 테이블 없고 `members.type='admin'`이 정답. 정적 검증으로 잡기 어려움 — raw SQL 안의 테이블·컬럼명을 schema와 교차 검증하는 스크립트 필요. 라이브 호출 + 시퀀스 검증의 첫 가치 증명 사례.

### 3. 거짓 성공 응답 (BUG-7)
UPDATE/DELETE가 0행 매칭이어도 에러 throw 안 함 → ok:true 거짓 응답. 감사 로그에도 가짜 성공 기록 위험. **표준화 필요**: UPDATE/DELETE는 `RETURNING id` + 영향 행 수 검증 → 0이면 4xx 응답. CLAUDE.md §6.2 추가 검토 항목.

### 4. 데모 데이터 잔존 (BUG-2)
화면 개발 시 DEMO_* 하드코딩을 운영 코드에 남김 → 실 DB 미연결 발견 지연. 화면 첫 정독 시 실 DB 연결 여부 즉시 확인 의무. CSV 자동 매핑 같은 회귀 검증으로만 드러남.

### 5. 데이터 백필 한계 (BACKFILL-1)
옛 import 흐름에 FK 미적재 등 구조적 결함이 있으면 자동 백필 경로 0. 정규식·join 다중 경로 시도 후 모두 실패하면 옛 자료 삭제 후 재 import가 가장 깔끔. **신규 import 코드는 FK 적재 의무화**로 미래 백필 경로 보장.

### 6. AI 에이전트 자연어·인자·도구 선택 (BUG-AI-P1-01·02·05·06)
시스템 프롬프트 변경 → 의도 분류 회귀 위험 (BUG-AI-P1-01). 모델 ID 단일 출처 어긋남 (BUG-AI-P1-02). 시각 인자는 현재 날짜 동적 주입 필수, 자동 부풀림 방지 (BUG-AI-P1-05). 의미적으로 가까운 도구 쌍은 description 트리거 키워드 + 매핑 예시 필수 (BUG-AI-P1-06). **표준 §17.2 "인자 자동 추출 ~70%" 한계 인정** — 도구 description에 명시 매핑 힌트 박는 게 가장 효과적.

### 7. enum 부분 동기화 (BUG-AI-P1-05b) [가장 큰 교훈]
**enum·필드명 fix의 부분 적용 위험**. notice_category 4개 중 2개만 정정·2개 누락·거부 메시지 옛 값 잔존 → C가 부분 적용 BUG 재보고 → 라운드 폭증. **표준 §18.13 "도메인 전수 동기화 의무"로 정착**: 메인이 enum·필드명 fix 시 grep으로 도메인 전체 점검(핸들러 화이트리스트·도구 description·거부 메시지·schema enum·시드 SQL 모두) 후 한 번에 끝낼 것. 부분 fix는 라운드 비용·신뢰도 모두 손실. 메모리 `feedback_verification_rounds.md`·`project_ai_standard.md` 핵심 항목.

### 8. 표준 양식 미구현 (BUG-AI-P1-03, BUG-AI-P1-04)
표준 문서에 명시된 양식(toolApproval, role hierarchy)이 코드로 구현 안 됨. 표준 신설 시 코드 구현 동시 푸시 의무. role 비교는 정확 일치 대신 위계 인정(super_admin > admin > member)으로 설계.

---

**마지막 갱신**: 2026-05-14 (압축 archive 생성 — 원본 13개 파일 git history 보존)
