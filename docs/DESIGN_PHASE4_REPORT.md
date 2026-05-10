# DESIGN — Phase 4 대표 보고 시스템 + Agent-9

> **작성**: 2026-05-10 / 메인 채팅
> **목표**: 주간 통계 스냅샷 자동 수집 → Agent-9 AI 핵심 5줄 요약 + 위험경보 → 대표 이메일 발송 + 어드민 보고서 화면
> **분량**: 10~14h (메인·A·B 병렬)
> **베이스**: `origin/main`

---

## 1. 도메인 모델

### 1.1 보고 주기
- **주간**: 매주 월 KST 06:00 자동 생성 (전주 월~일 기간 집계)
- **수동 생성**: 어드민이 임의 기간으로 즉시 생성 가능

### 1.2 보고서 내용 (4개 영역)
| 영역 | 포함 항목 |
|---|---|
| 회원 현황 | 기간 내 신규 가입 / 탈퇴 / 유형별 전체 현황 (일반·유족·자원봉사) |
| 후원 현황 | 기간 내 후원 건수·금액 / 방법별 분포 (효성CMS·토스·일시·계좌) / 정기·잠재 후원자 수 |
| SIREN 신고 현황 | 사건·괴롭힘·법률 각 신규 건수 / 상태별 처리 현황 |
| 매칭·지원 현황 | 전문가 1:1 매칭 신규·진행·완료 / 유족지원 신청 건수·카테고리별 |

### 1.3 Agent-9 역할 (Agent-8 주간 대표 버전)
- Gemini Flash로 수집 데이터 전체 분석
- **핵심 5줄 요약**: "이번 주 가장 중요한 변화 5가지"
- **위험경보**: 전주 대비 급감/급증 항목, 처리 지연 건, 미응대 신고 등
- 실패 시 폴백: 데이터 기반 단순 요약 (숫자 그대로)

---

## 2. DB 변경

### 2.1 신규 테이블 — `report_snapshots`
```sql
CREATE TABLE report_snapshots (
  id              serial PRIMARY KEY,
  report_type     varchar(20) NOT NULL DEFAULT 'weekly',  -- 'weekly' | 'custom'
  period_start    date NOT NULL,
  period_end      date NOT NULL,
  stats           jsonb NOT NULL DEFAULT '{}',   -- 수집된 통계 (구조 §3.1)
  ai_summary      text,                          -- Agent-9 핵심 5줄
  ai_alerts       jsonb DEFAULT '[]',            -- 위험경보 [{type, message, severity}]
  generated_by    int REFERENCES members(id) ON DELETE SET NULL,  -- null=cron 자동
  sent_email_at   timestamp,
  sent_to         jsonb DEFAULT '[]',            -- 발송 이메일 목록
  created_at      timestamp NOT NULL DEFAULT now()
);
CREATE INDEX report_snapshots_type_period ON report_snapshots(report_type, period_start DESC);
```

### 2.2 마이그
- `netlify/functions/migrate-phase4-report.ts` (1회용)
- 멱등 (`IF NOT EXISTS`)

---

## 3. API 계약 (4개)

### 3.1 메인 담당
| 메서드 | 경로 | 용도 |
|---|---|---|
| GET  | `/api/admin-report-list` | 보고서 목록 (type, limit, page) |
| GET  | `/api/admin-report-detail` | 보고서 상세 (?id=N) |
| POST | `/api/admin-report-generate` | 수동 생성 (기간 지정) |

### 3.2 B 담당
| 메서드 | 경로 | 용도 |
|---|---|---|
| POST | `/api/admin-report-send-email` | 수동 이메일 재발송 (?id=N) |

---

## 4. stats 구조 (jsonb 스키마)

```typescript
interface ReportStats {
  members: {
    newThisPeriod: number;
    withdrawnThisPeriod: number;
    totalActive: number;
    byType: { user: number; family: number; volunteer: number };
  };
  donations: {
    totalAmount: number;
    count: number;
    byMethod: { hyosung: number; toss_billing: number; onetime: number; bank: number };
    regularActive: number;   // 정기 후원자 (활성)
    regularProspect: number; // 잠재 후원자
  };
  siren: {
    incident:   { newThisPeriod: number; totalOpen: number };
    harassment: { newThisPeriod: number; totalOpen: number };
    legal:      { newThisPeriod: number; totalOpen: number };
  };
  expertMatches: {
    newThisPeriod: number;
    active: number;
    closedThisPeriod: number;
    byType: { lawyer: number; counselor: number };
  };
  support: {
    newThisPeriod: number;
    byCategory: { counseling: number; legal: number; scholarship: number };
  };
}
```

---

## 5. Cron (Agent-9)

```
파일: netlify/functions/cron-agent-9.ts
스케줄: "0 21 * * 0" (UTC 일 21:00 = KST 월 06:00)
```

**동작 흐름**:
1. 전주 월 00:00 ~ 일 23:59 (KST) 기간 계산
2. `report-collector.ts`로 stats 수집
3. Gemini Flash 호출 → ai_summary(핵심 5줄) + ai_alerts(위험경보)
4. `report_snapshots` INSERT
5. `ADMIN_NOTIFY_EMAIL` + super_admin 이메일 목록으로 Resend 발송
6. AI 실패 시 폴백 텍스트 자동 생성

---

## 6. 신규 파일 (8개)

### 6.1 메인 담당 (5개)
```
netlify/functions/
  ├─ migrate-phase4-report.ts        ★ 1회용 마이그
  ├─ admin-report-list.ts            GET 목록
  ├─ admin-report-detail.ts          GET 상세
  ├─ admin-report-generate.ts        POST 수동 생성
  └─ cron-agent-9.ts                 ★ 주간 자동 cron

lib/
  └─ report-collector.ts             통계 수집 헬퍼
```

### 6.2 A 담당 (2개 신규 + 1개 확장)
```
public/js/
  └─ admin-report.js                 ★ 보고서 화면 — 목록·상세·Chart.js·AI 요약

public/admin.html                    확장 — 📊 보고서 탭/패널 + script include
public/js/admin.js                   확장 — 라우터 1줄 + 타이틀 맵 1줄
```

### 6.3 B 담당 (1개 신규 + 1개 신규)
```
netlify/functions/
  └─ admin-report-send-email.ts      POST 이메일 수동 재발송

public/css/
  └─ admin-report-print.css          인쇄 전용 스타일 (window.print 패턴)
```

---

## 7. 이메일 발송 전략

- **자동 발송**: cron-agent-9가 report_snapshots 저장 직후 Resend 호출
- **발송 대상**: `process.env.ADMIN_NOTIFY_EMAIL` (기본) + members.type='admin' AND member_subtype='super_admin'
- **제목**: `[SIREN 주간 보고] YYYY-MM-DD ~ YYYY-MM-DD`
- **본문**: AI 요약 5줄 + 위험경보 + 주요 수치 표

---

## 8. 진행 순서

```
[메인 1차 푸시]
  · migrate-phase4-report.ts + schema.ts 섹션 (reportSnapshots)
  · docs/DESIGN_PHASE4_REPORT.md

[Swain 마이그 호출]
  https://tbfa-siren-cms.netlify.app/api/migrate-phase4-report?run=1

[메인 2차 푸시]
  · schema 정의 활성화 (마이그 후)
  · lib/report-collector.ts
  · netlify/functions/admin-report-list.ts
  · netlify/functions/admin-report-detail.ts
  · netlify/functions/admin-report-generate.ts
  · netlify/functions/cron-agent-9.ts

[A·B 병렬 시작]
  · A: admin-report.js + admin.html 확장 + admin.js 라우터
  · B: admin-report-send-email.ts + admin-report-print.css

[메인 머지·검증]
  · A → main 머지
  · B → main 머지
  · Swain 검증
```

---

## 9. 검증 시나리오 (Swain 가이드)

### V1. 수동 보고서 생성 + 조회
1. 어드민 → 📊 주간 보고서 탭
2. "보고서 생성" 버튼 → 기간 선택 → 생성
3. 목록에서 방금 생성된 보고서 클릭 → 4개 영역 통계 + AI 요약 표시 확인

### V2. 자동 주간 발송
1. cron-agent-9 수동 트리거 또는 다음 월요일 자동 발송 대기
2. 대표 이메일 수신 확인 → 핵심 5줄 + 위험경보

### V3. 인쇄
1. 보고서 상세 → 🖨️ 인쇄 버튼 → 브라우저 인쇄 미리보기 → 깔끔하게 출력

---

## 10. 위험 요소·주의사항

1. **stats 수집 쿼리 비용**: 6개 테이블 COUNT 집계 → 인덱스 확인 필수
2. **Gemini 호출 실패 폴백**: 수치 기반 단순 요약으로 대체 (보고서 자체는 저장)
3. **schema.ts append-only**: `/* === Phase 4 === */` 섹션 헤더로 파일 끝에 추가
4. **netlify.toml cron 추가**: `cron-agent-9` 스케줄 명시 필요
5. **이메일 발송 실패**: 보고서 저장은 성공으로 처리, 이메일만 재시도 가능하게

---

## 11. 종료 조건

- [ ] V1·V2·V3 Swain 검증 통과
- [ ] PROJECT_STATE.md §4.X Phase 4 진행률 갱신
- [ ] HANDOFF.md §3·§4 갱신
- [ ] tag `phase4-complete-YYYYMMDD`
