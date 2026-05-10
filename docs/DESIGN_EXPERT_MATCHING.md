# DESIGN — 6순위 #8 변호사·심리상담사 1:1 매칭 채팅

> **작성**: 2026-05-10 / 메인 채팅
> **목표**: 사용자가 SIREN 신고·유족지원에서 변호사·심리상담사 매칭을 신청 → 어드민이 배정 → 1:1 채팅방 자동 생성 → 양측 상담 → 어드민 종료
> **분량**: 15~18h (메인·A·B 병렬)
> **베이스**: `origin/main`

---

## 1. 도메인 모델

### 1.1 액터
- **사용자(user)**: `members.type='user'` 일반 회원
- **전문가(expert)**: `members.type='volunteer'` + `member_subtype IN ('lawyer','counselor')` (기존 인프라 그대로 활용)
- **어드민(admin)**: 매칭 배정·세션 종료 권한

### 1.2 도메인 신호
매칭은 SIREN 4개 도메인 중 한 곳에서 시작:
- `incident` — 사건 제보
- `harassment` — 악성민원
- `legal` — 법률지원
- `support` — 유족지원

매칭 종류:
- `lawyer` — 법률 자문
- `counselor` — 심리 상담

### 1.3 흐름
```
[사용자]                    [어드민]                    [전문가]
   │                          │                           │
   ├─ 매칭 신청 (도메인+종류) │                           │
   │  status: pending ────────┤                           │
   │                          ├─ 대기 목록 조회           │
   │                          ├─ 전문가 선택·배정         │
   │                          │  expert_matches.expert_id │
   │                          │  chat_rooms 자동 생성     │
   │                          │  (room_type='expert_1on1')│
   │                          │  status: matched ─────────┤
   │  status: active◄─────────┤                           │
   │  채팅방 진입 가능        │                           │
   │                          │                           │
   ├──────────── 양측 채팅 ──────────────────────────────►│
   │                          │                           │
   │                          ├─ 세션 종료                │
   │                          │  status: closed           │
   │                          │  chat_rooms.closedAt 채움 │
```

### 1.4 상태 전이
- `pending`: 신청 직후, 어드민 검토 대기
- `matched`: 어드민이 전문가 배정 + 채팅방 생성 완료
- `active`: 첫 메시지가 오가면 자동 (또는 matched와 동일 처리)
- `closed`: 세션 종료 (어드민 또는 만료)
- `rejected`: 어드민이 거절 (전문가 부재·부적절 등)

---

## 2. DB 변경

### 2.1 신규 테이블 — `expert_matches`
```sql
CREATE TABLE expert_matches (
  id              serial PRIMARY KEY,
  user_id         int NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  expert_id       int REFERENCES members(id) ON DELETE SET NULL,
  match_type      varchar(20),               -- 'lawyer' | 'counselor'
  source_domain   varchar(30),               -- 'incident'|'harassment'|'legal'|'support'
  source_id       int,                       -- 도메인별 row id (선택, 추적용)
  chat_room_id    int REFERENCES chat_rooms(id) ON DELETE SET NULL,
  status          varchar(20) NOT NULL DEFAULT 'pending',
  reason          text,                      -- 사용자 신청 사유
  admin_note      text,                      -- 어드민 메모
  assigned_by     int REFERENCES members(id) ON DELETE SET NULL,  -- 어드민도 members 통합 모델
  assigned_at     timestamp,
  closed_at       timestamp,
  closed_reason   varchar(50),               -- 'completed'|'expert_unavailable'|'user_canceled' 등
  created_at      timestamp NOT NULL DEFAULT now(),
  updated_at      timestamp NOT NULL DEFAULT now()
);
CREATE INDEX expert_matches_user_idx   ON expert_matches(user_id);
CREATE INDEX expert_matches_expert_idx ON expert_matches(expert_id);
CREATE INDEX expert_matches_status_idx ON expert_matches(status);
```

### 2.2 chat_rooms 확장
```sql
ALTER TABLE chat_rooms ADD COLUMN room_type varchar(20) NOT NULL DEFAULT 'general';
ALTER TABLE chat_rooms ADD COLUMN expert_id int REFERENCES members(id) ON DELETE SET NULL;
CREATE INDEX chat_rooms_room_type_idx ON chat_rooms(room_type);
CREATE INDEX chat_rooms_expert_idx    ON chat_rooms(expert_id);
```
- `room_type='general'`(기본) | `'expert_1on1'`(전문가 1:1)
- 기존 `category` 컬럼은 도메인 카테고리(신고/지원/문의 등)로 그대로 유지 — `room_type`과 직교

### 2.3 마이그
- `netlify/functions/migrate-expert-matching.ts` (1회용)
- Swain이 어드민 로그인 후 `?run=1`로 호출
- 멱등(`IF NOT EXISTS`) 보장

---

## 3. API 계약 (8개)

### 3.1 사용자 측 (A 담당)
| 메서드 | 경로 | 용도 |
|---|---|---|
| POST | `/api/expert-match-request` | 매칭 신청 (matchType + sourceDomain + reason) |
| GET  | `/api/expert-match-list` | 본인 매칭 내역 (active / closed 분리) |

### 3.2 어드민 측
| 메서드 | 경로 | 용도 | 담당 |
|---|---|---|---|
| GET  | `/api/admin-expert-list` | 매칭 대기·진행·완료 목록 (필터링) | A |
| POST | `/api/admin-expert-assign` | **전문가 배정 + 채팅방 자동 생성 트랜잭션** | **메인 (핵심)** |
| POST | `/api/expert-session-end` | 세션 종료 (어드민·전문가) | A |

### 3.3 채팅 가드 (A 담당)
- 기존 `chat-*.ts` 함수에 `room_type='expert_1on1'`인 방의 권한 가드 강화
- 입장 가능: `chat_rooms.member_id`(사용자) OR `chat_rooms.expert_id`(전문가) OR 어드민
- 그 외는 403

### 3.4 응답 패턴 (CLAUDE.md §6.2)
```typescript
// 단계별 try/catch + step·detail·stack
function jsonError(step: string, err: any) {
  return new Response(JSON.stringify({
    ok: false, error: "...", step,
    detail: String(err?.message || err).slice(0, 500),
    stack: String(err?.stack || "").slice(0, 1000),
  }), { status: 500, headers: { "Content-Type": "application/json" } });
}
```

---

## 4. 권한 정책

| 액션 | 사용자 | 전문가 | 어드민 |
|---|---|---|---|
| 매칭 신청 | ✅ 본인만 | ❌ | ❌ |
| 본인 매칭 내역 | ✅ 본인만 | ✅ 본인 배정 건만 | ✅ 전체 |
| 전문가 배정 | ❌ | ❌ | ✅ |
| 채팅방 입장 | ✅ 매칭된 본인 | ✅ 배정된 본인 | ✅ |
| 세션 종료 | ❌ | ✅ 본인 배정 건 | ✅ |

차단 정책:
- `requireActiveUser`(블랙 차단 포함) — 사용자 신청·내역
- `requireAdmin` — 어드민 API
- 채팅방 가드 — 본인 매칭 OR 본인 배정 OR 어드민만

---

## 5. 신규 파일 (8개)

### 5.1 백엔드 (A 담당, 메인은 admin-expert-assign만)
```
netlify/functions/
  ├─ expert-match-request.ts      A
  ├─ expert-match-list.ts          A
  ├─ admin-expert-list.ts          A
  ├─ admin-expert-assign.ts        ★ 메인 (트랜잭션 핵심)
  ├─ expert-session-end.ts         A
  └─ migrate-expert-matching.ts    메인 (1회용, 호출 후 삭제)
```

### 5.2 프론트엔드 (B 담당)
```
public/js/
  ├─ mypage-expert-match.js       B (마이페이지 모듈)
  └─ admin-expert.js              B (어드민 모듈)
```

### 5.3 라이브러리 (메인)
```
lib/
  └─ expert-match.ts              메인 (상태 enum, 검증 헬퍼, 채팅방 생성 헬퍼)
```

---

## 6. 확장 파일 (충돌 회피)

| 파일 | 메인 | A | B | 회피 전략 |
|---|---|---|---|---|
| `db/schema.ts` | ✅ | — | — | 메인이 마이그 호출 후 일괄 추가 (`/* === 6순위 #8 === */` 섹션 헤더) |
| `chat-*.ts` | — | ✅ | — | A가 권한 가드 강화 |
| `public/mypage.html` | — | — | ✅ | B가 탭 영역 끝에 추가 |
| `public/admin.html` | — | — | ✅ | B가 사이드바 메뉴 끝에 추가 |
| `public/js/auth.js` | — | — | (옵션) | 채팅방 진입 분기 |

`lib/auth.ts`·`lib/admin-guard.ts` — **변경 금지** (회귀 위험)

---

## 7. 진행 순서

```
[메인 1차 푸시] ─────────────────────────────────────────────
  · 본 DESIGN 문서
  · migrate-expert-matching.ts (1회용)
  · PROJECT_STATE.md §4.2 진행률 갱신

[Swain 마이그 호출] ────────────────────────────────────────
  https://tbfa-siren-cms.netlify.app/api/migrate-expert-matching?run=1

[메인 2차 푸시] ─────────────────────────────────────────────
  · schema.ts 정의 추가 (expert_matches + chat_rooms 2컬럼)
  · lib/expert-match.ts (헬퍼)
  · netlify/functions/admin-expert-assign.ts (트랜잭션 핵심)
  · 마이그 함수 삭제

[A·B 채팅 시작] ────────────────────────────────────────────
  · A 워크트리: ../tbfa-mis-A, 브랜치: feature/expert-matching-backend
  · B 워크트리: ../tbfa-mis-B, 브랜치: feature/expert-matching-frontend
  · 각자 origin/main에서 rebase 후 시작

[A·B 병렬 진행] ────────────────────────────────────────────
  · A: 4개 백엔드 + chat 가드
  · B: 마이페이지 모듈 + 어드민 모듈 + HTML 확장

[메인 머지·검증] ───────────────────────────────────────────
  · A → main 머지 (충돌 해결)
  · B → main 머지
  · 캐시버스터 일괄 갱신
  · Swain 검증 시나리오 안내
```

---

## 8. 검증 시나리오 (Swain 가이드)

### V1. 사용자 신청 + 어드민 배정 + 채팅방 생성
1. 마이페이지 → 신고 또는 유족지원 → 매칭 신청 → reason 입력
2. 어드민 → 1:1 매칭 관리 → 대기 목록에서 신청 행 확인
3. 어드민이 변호사 배정 → 채팅방 자동 생성 + 알림 발송 (인앱)
4. 사용자 마이페이지 → 진행중 매칭 → 채팅방 진입

### V2. 양측 채팅
1. 사용자 메시지 전송 → 전문가에게 표시 (반대도)
2. 어드민 입장도 가능 (감독·중재용)

### V3. 세션 종료
1. 어드민 또는 전문가가 세션 종료 → 상태 closed
2. 사용자 마이페이지 → 완료 매칭 탭에서 확인 가능 (대화 기록 읽기 전용)

---

## 9. 위험 요소·주의사항

1. **chat_rooms 회귀 방지** — 기존 `category` 그대로 유지. 신규 `room_type`은 직교 컬럼.
2. **admin-expert-assign 트랜잭션** — 매칭 상태 갱신 + 채팅방 생성을 한 트랜잭션으로 (실패 시 롤백)
3. **schema.ts append-only** (CLAUDE.md §9.1.6) — 메인이 `/* === 6순위 #8 === */` 섹션 헤더로 본인 영역 명시
4. **마이그 1회용 원칙** (CLAUDE.md §6.8) — 호출 성공 후 즉시 파일 삭제 + 커밋
5. **`requireAdmin` 반환은 `auth.res`** (response 아님)
6. **`/api/*` 함수에 `export const config = { path }`** 누락 금지

---

## 10. 종료 조건

- [ ] 마이그 호출 성공 → schema.ts 정의 활성화 → 마이그 함수 삭제
- [ ] V1·V2·V3 사용자 검증 통과
- [ ] PROJECT_STATE.md §4.2 ✅ 100% 갱신 + §2 마지막 업데이트 행 추가
- [ ] HANDOFF.md §3·§4 갱신 (6순위 #8 ✅ 완료 표기)
- [ ] tag `expert-matching-complete-20260510` (또는 검증 완료일)
