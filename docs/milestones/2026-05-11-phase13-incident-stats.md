# Phase 13 — 신고 통계 대시보드

> **작성**: 2026-05-11 / 메인 채팅
> **상위 Phase**: Phase 13 신고 통계 대시보드 ([카탈로그](2026-05-10-phase10-22-catalog.md) §Phase13)
> **추정**: 메인 설계 2h / B 백 3~4h / A 프론트 4~5h / C 검증 2h / 합계 11~13h
> **모드**: 평행 (A·B 동시 시작. A는 mock JSON으로 시작, B 머지 후 실 API 연결)

---

## 0. 요구사항 확정 (Swain 결정 2026-05-11)

| 항목 | 결정 |
|---|---|
| 신고 3종 표시 방식 | 탭 전환 — [전체 합계] [사건 신고] [괴롭힘 신고] [법률 상담] |
| 기간 필터 | 프리셋 4개 버튼([이번 달][지난 달][올해][작년]) + 시작일·종료일 직접 입력 |
| AI 심각도 통계 | 포함 — 도넛 차트 (높음·중간·낮음·미분석 분포) |
| PDF 내보내기 | 포함 — 브라우저 print CSS 방식 (window.print) |
| 이메일 발송 | 제외 (Phase 16 통합 분석 때 처리) |
| 화면 위치 | admin.html SPA — 기존 🚨 사이렌 관리 그룹 아래 신규 메뉴 1개 추가 |

---

## 1. DB 설계 (B용)

### 1.1 신규 테이블
없음 — 기존 3개 테이블 집계만 사용.

### 1.2 기존 테이블 컬럼 추가
없음 — 신규 컬럼 불필요.

### 1.3 마이그레이션
없음 — schema 변경 없음. 마이그 파일 작성 불필요.

### 1.4 기존 테이블 구조 확인 (B 참고용)

#### incidentReports (사건 신고)
| 컬럼 | 타입 | 값 예시 |
|---|---|---|
| status | enum | `submitted`, `ai_analyzed`, `reviewing`, `responded`, `closed`, `rejected` |
| aiSeverity | varchar(20) | `critical`, `high`, `medium`, `low`, null |
| createdAt | timestamp | |

#### harassmentReports (괴롭힘 신고)
| 컬럼 | 타입 | 값 예시 |
|---|---|---|
| status | enum | `submitted`, `ai_analyzed`, `reviewing`, `responded`, `closed`, `rejected` |
| aiSeverity | varchar(20) | `critical`, `high`, `medium`, `low`, null |
| createdAt | timestamp | |

#### legalConsultations (법률 상담)
| 컬럼 | 타입 | 값 예시 |
|---|---|---|
| status | enum | `submitted`, `ai_analyzed`, `matching`, `matched`, `in_progress`, `responded`, `closed`, `rejected` |
| aiUrgency | varchar(20) | `critical`, `high`, `medium`, `low`, null (※ 필드명 주의: aiSeverity 아님) |
| createdAt | timestamp | |

---

## 2. API 명세 (B용)

### 2.1 함수 목록

| 함수 파일 | 경로 | 메서드 | 권한 | 용도 |
|---|---|---|---|---|
| `netlify/functions/admin-incident-stats.ts` | `/api/admin-incident-stats` | GET | requireAdmin | 신고 3종 통계 통합 조회 |

### 2.2 함수 상세

#### `admin-incident-stats` (`/api/admin-incident-stats` GET)

**권한**: `requireAdmin`

**요청 쿼리 파라미터**:
```
?from=YYYY-MM-DD   (선택, 기본: 해당 월 1일)
?to=YYYY-MM-DD     (선택, 기본: 오늘)
?type=all|incident|harassment|legal  (선택, 기본: all)
```

**응답 (성공)**:
```json
{
  "ok": true,
  "period": { "from": "2026-05-01", "to": "2026-05-31" },
  "summary": {
    "total": 87,
    "incident": 34,
    "harassment": 28,
    "legal": 25
  },
  "incident": {
    "total": 34,
    "byStatus": {
      "submitted": 5,
      "ai_analyzed": 3,
      "reviewing": 8,
      "responded": 12,
      "closed": 4,
      "rejected": 2
    },
    "bySeverity": {
      "critical": 3,
      "high": 8,
      "medium": 14,
      "low": 6,
      "unanalyzed": 3
    },
    "monthlyTrend": [
      { "month": "2026-01", "count": 12 },
      { "month": "2026-02", "count": 9 }
    ]
  },
  "harassment": {
    "total": 28,
    "byStatus": { "submitted": 3, "ai_analyzed": 2, "reviewing": 6, "responded": 10, "closed": 5, "rejected": 2 },
    "bySeverity": { "critical": 2, "high": 6, "medium": 12, "low": 5, "unanalyzed": 3 },
    "monthlyTrend": []
  },
  "legal": {
    "total": 25,
    "byStatus": { "submitted": 2, "ai_analyzed": 1, "matching": 3, "matched": 4, "in_progress": 5, "responded": 6, "closed": 3, "rejected": 1 },
    "byUrgency": { "critical": 1, "high": 5, "medium": 10, "low": 7, "unanalyzed": 2 },
    "monthlyTrend": []
  }
}
```

**응답 (실패)**:
```json
{
  "ok": false,
  "error": "통계 조회에 실패했습니다.",
  "step": "auth | validate | select_incident | select_harassment | select_legal | map",
  "detail": "...",
  "stack": "..."
}
```

**처리 단계**:
1. `auth` — requireAdmin 인증
2. `validate` — from/to 날짜 파싱·유효성 검사 (from > to 이면 400)
3. `select_incident` — incident_reports 집계 SQL (WHERE createdAt BETWEEN from AND to)
4. `select_harassment` — harassment_reports 집계 SQL
5. `select_legal` — legal_consultations 집계 SQL (aiUrgency 사용 주의)
6. `map` — 응답 구조 조립

**구현 주의사항**:
- 보조 SELECT 3개는 각각 독립 try/catch — 하나 실패해도 나머지 빈 객체로 계속
- `legalConsultations`는 `aiSeverity` 아닌 **`aiUrgency`** 컬럼 (필드명 혼동 주의)
- monthlyTrend는 FROM-TO 기간이 2개월 이상일 때만 계산, 1개월 이하면 빈 배열
- SQL 집계는 `COUNT(*) FILTER (WHERE ...)` 패턴 사용 (기존 admin-incident-reports.ts 패턴 참고)
- status null 값 방어 (enum이지만 레거시 데이터 가능)

**필수 체크**:
- [x] `export const config = { path: "/api/admin-incident-stats" }`
- [x] requireAdmin 반환 `auth.res` (response 아님)
- [x] 보조 SELECT 3개 각각 try/catch + 빈 객체 fallback
- [x] `npx tsc --noEmit` 통과 후 push

---

## 3. 화면 명세 (A용)

### 3.1 페이지 목록

| 위치 | 진입점 | 권한 |
|---|---|---|
| `admin.html` SPA 내 신규 섹션 `id="adm-siren-stats"` | 🚨 사이렌 관리 그룹 > "📊 신고 통계" 메뉴 | 어드민 |

> ※ 별도 HTML 파일 없음. admin.html에 섹션 추가 + 사이드바 메뉴 1개 추가 방식.

### 3.2 와이어프레임

#### 섹션: `adm-siren-stats` (신고 통계 대시보드)

```
┌─ 신고 통계 대시보드 ───────────────────────────────────┐
│                                                         │
│  ── 기간 필터 ─────────────────────────────────────    │
│  [이번 달] [지난 달] [올해] [작년]                       │
│  시작일: [____-__-__]  종료일: [____-__-__]  [조회]     │
│                                                         │
│  ── 요약 카드 ─────────────────────────────────────    │
│  ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐           │
│  │ 전체   │ │ 사건   │ │ 괴롭힘 │ │ 법률   │           │
│  │  87건  │ │  34건  │ │  28건  │ │  25건  │           │
│  └────────┘ └────────┘ └────────┘ └────────┘           │
│                                                         │
│  ── 탭 ────────────────────────────────────────────    │
│  [전체 합계 ●] [사건 신고] [괴롭힘 신고] [법률 상담]     │
│                                                         │
│  ── 차트 영역 (탭 선택에 따라 전환) ───────────────    │
│  ┌──────────────────────┐  ┌──────────────────────┐    │
│  │ 처리 상태 분포        │  │ AI 심각도 분포        │    │
│  │ (수평 막대 차트)      │  │ (도넛 차트)           │    │
│  │ 접수 ████ 5          │  │  🔴높음 35%           │    │
│  │ 검토 ████████ 8      │  │  🟡중간 41%           │    │
│  │ 처리완료 ████ 12     │  │  🟢낮음 18%           │    │
│  │ 종결 ████ 4          │  │  ⚪미분석 6%          │    │
│  └──────────────────────┘  └──────────────────────┘    │
│                                                         │
│  ┌──────────────────────────────────────────────────┐  │
│  │ 월별 접수 추이 (꺾은선 차트 — 2개월 이상 시 표시) │  │
│  └──────────────────────────────────────────────────┘  │
│                                                         │
│  [🖨️ PDF 출력]                                         │
└─────────────────────────────────────────────────────────┘
```

**"전체 합계" 탭 선택 시**: 사건+괴롭힘+법률 합산 상태 분포 + 합산 심각도 분포 표시
**개별 탭 선택 시**: 해당 유형만 표시. 법률 상담 탭은 "심각도" 대신 "긴급도" 레이블.

### 3.3 사이드바 메뉴 추가 위치

`admin.html` 내 🚨 사이렌 관리 그룹 마지막 항목(`siren-board` 아래)에 추가:
```html
<a data-page="siren-stats">
  <i>📊</i><span>신고 통계</span>
</a>
```
그리고 해당 섹션 div 추가:
```html
<div id="adm-siren-stats" class="adm-page" style="display:none">
  <!-- 통계 대시보드 내용 -->
</div>
```

### 3.4 사용자 동작 → API 매핑

| 사용자 동작 | 호출 API | 요청 파라미터 | 응답 처리 | 에러 토스트 |
|---|---|---|---|---|
| 메뉴 진입 (최초) | GET `/api/admin-incident-stats` | `from`=이번달1일, `to`=오늘 | 요약 카드·차트 전부 갱신 | "통계를 불러오지 못했습니다." |
| [이번 달] 버튼 클릭 | GET `/api/admin-incident-stats` | `from`, `to` 이번 달 | 위와 동일 | 위와 동일 |
| [지난 달] 버튼 클릭 | GET `/api/admin-incident-stats` | 지난 달 1일~말일 | 위와 동일 | 위와 동일 |
| [올해] 버튼 클릭 | GET `/api/admin-incident-stats` | 1월1일~오늘 | 위와 동일 | 위와 동일 |
| [작년] 버튼 클릭 | GET `/api/admin-incident-stats` | 작년1월1일~12월31일 | 위와 동일 | 위와 동일 |
| 날짜 직접 입력 후 [조회] | GET `/api/admin-incident-stats` | 입력한 from/to | 위와 동일 | from>to이면 "시작일이 종료일보다 늦습니다." |
| 탭 전환 ([사건 신고] 등) | 없음 (클라이언트 전환) | — | 해당 유형 데이터로 차트 재렌더 | — |
| [🖨️ PDF 출력] 버튼 | `window.print()` | — | 브라우저 인쇄 다이얼로그 | — |

### 3.5 Chart.js 차트 구성

이미 admin.html에 Chart.js 4.4 로드됨 — 별도 CDN 추가 불필요.

| 차트 | 종류 | 데이터 |
|---|---|---|
| 처리 상태 분포 | 수평 막대 (Bar, indexAxis:'y') | byStatus 각 항목 count |
| AI 심각도/긴급도 분포 | 도넛 (Doughnut) | bySeverity 또는 byUrgency |
| 월별 접수 추이 | 꺾은선 (Line) | monthlyTrend (2개월 미만 시 숨김) |

**색상 기준**:
- critical: `#dc2626` (빨강)
- high: `#f97316` (주황)
- medium: `#eab308` (노랑)
- low: `#22c55e` (초록)
- unanalyzed: `#9ca3af` (회색)

**상태 한글 레이블**:
- submitted → 접수
- ai_analyzed → AI 분석 완료
- reviewing → 검토 중
- responded → 처리 완료
- closed → 종결
- rejected → 반려
- matching → 매칭 중 (법률 전용)
- matched → 매칭 완료 (법률 전용)
- in_progress → 진행 중 (법률 전용)

### 3.6 PDF 출력 스타일

`public/css/admin-report-print.css` 기존 파일 재사용 (Phase 4 패턴).
차트는 `<canvas>` 요소 그대로 출력 — 별도 처리 없음.
print 시 사이드바·필터 영역 숨김 (`.no-print { display:none }` 클래스 적용).

### 3.7 JS 파일

| 파일 | 용도 |
|---|---|
| `public/js/admin-siren-stats.js` | 신규 — 통계 대시보드 전용 로직 |

admin.html 하단에 `<script src="/js/admin-siren-stats.js?v=1">` 추가.

### 3.8 토스트·문구 모음

| 상황 | 문구 |
|---|---|
| 통계 로드 성공 | (없음 — 화면 갱신으로 충분) |
| 통계 로드 실패 | "통계를 불러오지 못했습니다. {서버 detail}" |
| 날짜 검증 실패 | "시작일이 종료일보다 늦습니다." |
| 데이터 없음 | 차트 영역에 "해당 기간에 신고 내역이 없습니다." 텍스트 표시 |

### 3.9 캐시버스터

| 파일 | 참조 위치 | 버전 |
|---|---|---|
| `public/js/admin-siren-stats.js` | admin.html (신규 추가) | `?v=1` |

---

## 4. 검증 시나리오 (C용)

### 4.1 라이브 시나리오 (Q1~Q8)

| # | 시나리오 (사용자 동작) | 기대 동작 (사용자가 보는 결과) |
|---|---|---|
| Q1 | 어드민 로그인 → 🚨 사이렌 관리 그룹에서 "📊 신고 통계" 메뉴 클릭 | 신고 통계 대시보드 화면 표시. 요약 카드 4개(전체·사건·괴롭힘·법률)에 숫자 표시. 처리 상태 막대 차트·AI 심각도 도넛 차트 표시. 기본 기간은 이번 달. |
| Q2 | [지난 달] 버튼 클릭 | 지난 달 기간으로 통계 갱신. 요약 카드·차트 숫자 변경. 버튼 활성화 표시. |
| Q3 | [올해] 버튼 클릭 → 시작일·종료일 입력칸 확인 | 올해 1월~오늘 통계 표시. 2개월 이상이면 월별 추이 꺾은선 차트 표시. |
| Q4 | [작년] 버튼 클릭 | 작년 전체 통계 표시. 월별 추이 12개 점 표시. |
| Q5 | 시작일 `2026-01-01`, 종료일 `2026-03-31` 직접 입력 후 [조회] | 해당 기간 통계 표시. 월별 추이 3개 점(1·2·3월) 표시. |
| Q6 | 시작일 > 종료일로 잘못 입력 후 [조회] | "시작일이 종료일보다 늦습니다." 토스트 표시. API 호출 없음. |
| Q7 | [사건 신고] 탭 클릭 → [법률 상담] 탭 클릭 비교 | 탭 전환 시 해당 유형 통계로 차트 즉시 갱신. 법률 탭에서 도넛 차트 레이블이 "심각도"가 아닌 "긴급도"로 표시. |
| Q8 | [🖨️ PDF 출력] 버튼 클릭 | 브라우저 인쇄 다이얼로그 열림. 사이드바·필터 숨김, 차트·요약 카드만 인쇄 영역 포함. |

### 4.2 회귀 점검 영역

- **사건 제보 관리 화면** — 기존 목록·상세 정상 동작 여부 (admin.html SPA 메뉴 전환)
- **악성민원 관리 화면** — 동일
- **법률지원 관리 화면** — 동일
- **어드민 로그인** — admin.html 전체 로드 오류 없음 (JS 추가 후 구문 에러 체크)

### 4.3 백필 필요 여부

- [x] 백필 불필요 — 기존 데이터 집계만, DB 변경 없음.

---

## 5. 머지 순서·환경변수

### 5.1 머지 모드

- [x] 평행 (A는 mock JSON으로 시작, B 머지 후 실 API 연결)

**사유**: DB 변경 없으므로 마이그 대기 불필요. A는 §2.2 응답 구조의 mock 객체로 즉시 차트 구현 시작 가능.

### 5.2 머지 순서

```
1. B push (feature/phase13-back) → 메인이 main 머지 → push
   (마이그 없음 — Swain 호출 단계 없음)
2. A push (feature/phase13-front) → 메인이 main 머지 → push
3. C 검증 트리거 → C push (verify/phase13) → 메인 머지 → 라운드 마감
```

> B 머지 → 바로 A 머지 가능 (마이그·schema 활성화 단계 없음).

### 5.3 신규 환경변수

없음.

### 5.4 A mock 응답 (B 머지 전 사용)

```json
{
  "ok": true,
  "period": { "from": "2026-05-01", "to": "2026-05-31" },
  "summary": { "total": 12, "incident": 5, "harassment": 4, "legal": 3 },
  "incident": {
    "total": 5,
    "byStatus": { "submitted": 2, "ai_analyzed": 1, "reviewing": 1, "responded": 1, "closed": 0, "rejected": 0 },
    "bySeverity": { "critical": 0, "high": 2, "medium": 2, "low": 1, "unanalyzed": 0 },
    "monthlyTrend": []
  },
  "harassment": {
    "total": 4,
    "byStatus": { "submitted": 1, "ai_analyzed": 1, "reviewing": 1, "responded": 1, "closed": 0, "rejected": 0 },
    "bySeverity": { "critical": 1, "high": 1, "medium": 2, "low": 0, "unanalyzed": 0 },
    "monthlyTrend": []
  },
  "legal": {
    "total": 3,
    "byStatus": { "submitted": 1, "ai_analyzed": 0, "matching": 1, "matched": 0, "in_progress": 1, "responded": 0, "closed": 0, "rejected": 0 },
    "byUrgency": { "critical": 0, "high": 1, "medium": 2, "low": 0, "unanalyzed": 0 },
    "monthlyTrend": []
  }
}
```

---

## 6. 4채팅 시작 프롬프트 (Swain 복붙용)

### 6.1 메인 — 이미 작업 중 (이 설계서가 산출물)

### 6.2 B 채팅 — 백 구현

```
[B — Phase 13 신고 통계 대시보드 백 구현]

모델: Sonnet 4.6
워크트리: ../tbfa-mis-B
브랜치: feature/phase13-back (베이스 main 최신 커밋)
정독 (필수): docs/milestones/2026-05-11-phase13-incident-stats.md §1·§2
참고: docs/PARALLEL_GUIDE.md §3 (영역 분담)

영역: netlify/functions/, lib/, db/schema.ts, drizzle/, .env.example
금지: public/, assets/, PROJECT_STATE.md, docs/HANDOFF.md, docs/ (상태 기록은 push 후 메인에 보고 텍스트로만)

핵심 정보:
- DB 변경 없음 — 마이그 파일 작성 불필요
- 신규 파일 1개: netlify/functions/admin-incident-stats.ts
- legalConsultations 집계 시 aiUrgency 사용 (aiSeverity 아님 — 혼동 주의)
- 보조 SELECT(incident/harassment/legal) 각각 독립 try/catch + 빈 객체 fallback
- 설계서 §2.2 응답 구조 정확히 구현 (A가 mock으로 이미 작업 중이므로 키명 변경 금지)

작업 순서:
  1) netlify/functions/admin-incident-stats.ts 작성 (§2.2 명세 그대로)
  2) npx tsc --noEmit 통과 확인
  3) push

머지 전 체크:
  - export const config = { path: "/api/admin-incident-stats" }
  - requireAdmin 반환 auth.res
  - try/catch step·detail·stack
  - legalConsultations byUrgency 키 (bySeverity 아님)

push 후 메인에 보고: 브랜치명·커밋 해시·변경 파일 요약.
```

### 6.3 A 채팅 — 프론트 구현

```
[A — Phase 13 신고 통계 대시보드 프론트 구현]

모델: Sonnet 4.6
워크트리: ../tbfa-mis-A
브랜치: feature/phase13-front (베이스 main 최신 커밋)
정독 (필수): docs/milestones/2026-05-11-phase13-incident-stats.md §3
참고: docs/PARALLEL_GUIDE.md §3 (영역 분담)

영역: public/, assets/
금지: lib/, netlify/functions/, db/, drizzle/, PROJECT_STATE.md, docs/HANDOFF.md, docs/ (상태 기록은 push 후 메인에 보고 텍스트로만)

모드: 평행 mock — §5.4의 mock JSON 객체를 변수에 담아 먼저 차트 구현.
B 머지 후 메인이 "실 API 연결" 신호 주면 mock → /api/admin-incident-stats 호출로 교체.

작업 대상:
  1) public/admin.html — 사이드바에 "📊 신고 통계" 메뉴 추가 + 섹션 div 추가
     (위치: 🚨 사이렌 관리 그룹, siren-board 아래)
  2) public/js/admin-siren-stats.js — 신규 파일 (§3.2~§3.8 명세 그대로)
     - 기간 필터 (프리셋 4개 + 날짜 직접 입력 + [조회] 버튼)
     - 요약 카드 4개 (전체·사건·괴롭힘·법률)
     - 탭 전환 (전체·사건·괴롭힘·법률)
     - Chart.js 차트 3종 (수평 막대·도넛·꺾은선)
     - [🖨️ PDF 출력] → window.print()
  3) admin.html 하단에 <script src="/js/admin-siren-stats.js?v=1"> 추가

차트 구성 (§3.5):
  - Chart.js 4.4는 이미 admin.html에 로드됨 — 추가 CDN 없음
  - 처리 상태: 수평 막대 (Bar, indexAxis:'y')
  - AI 심각도/긴급도: 도넛 (Doughnut)
  - 월별 추이: 꺾은선 (Line), monthlyTrend 배열 length < 2이면 섹션 숨김
  - 색상: critical=#dc2626, high=#f97316, medium=#eab308, low=#22c55e, unanalyzed=#9ca3af

법률 탭 주의:
  - 심각도 키가 bySeverity 아닌 byUrgency
  - 도넛 차트 레이블을 "긴급도"로 표시

PDF 출력:
  - window.print() 호출
  - 사이드바·필터 영역에 no-print 클래스 (admin-report-print.css 재사용)

push 후 메인에 보고: 브랜치명·커밋 해시·변경 파일 요약.
```

### 6.4 C 채팅 — 검증·fix

```
[C — Phase 13 신고 통계 대시보드 검증·fix]

모델: Opus 4.7
워크트리: ../tbfa-mis-C
브랜치: verify/phase13 (베이스 main @ B+A 머지 후 커밋)
정독: docs/milestones/2026-05-11-phase13-incident-stats.md §4

작업 순서:
  1) §4.1 Q1~Q8 라이브 시나리오 순서대로 실행·기록
  2) §4.2 회귀 점검 (사건·악성민원·법률지원 관리 화면 + 어드민 로그인)
  3) bug 발견 시 fix 커밋 → 메인 보고
  4) 보고서 docs/verify/2026-05-11-phase13.md 작성
  5) push → 메인 보고

표현 규칙: 함수명·코드 용어 없이 사용자 동작·결과 위주.
```

---

## 7. 라운드 마감 체크리스트 (메인)

- [ ] B `feature/phase13-back` 머지 완료
- [ ] A `feature/phase13-front` 머지 완료 (실 API 연결 확인)
- [ ] C `verify/phase13` 머지 완료
- [ ] C 보고서 `docs/verify/2026-05-11-phase13.md` push 완료
- [ ] Q1~Q8 모두 PASS (또는 fix 후 재검증 PASS)
- [ ] PROJECT_STATE §2 마지막 업데이트 행 추가
- [ ] PROJECT_STATE §5 Phase 13 진행률 갱신
- [ ] HANDOFF.md 갱신
- [ ] 다음 라운드 (Phase 14 또는 Phase 16) 설계 시작
