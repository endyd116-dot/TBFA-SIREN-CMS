# SIREN 프로젝트 문서 구조

> 작성: 2026-05-20 / 메인 단독 문서 대정리 (cleanup/docs-memory-reorg)
> 신규 메인·A·B·C 채팅 진입 시 본 인덱스부터 정독.

---

## 📁 폴더 구조 (4영역 분리)

```
docs/
├── README.md               ← 본 인덱스 (진입점)
│
├── rules/                  ← 운영·작업 규칙 (살아있는 정책·자주 정독)
│   ├── HANDOFF.md                  최신 단일 인수인계
│   ├── REMAINING_WORK.md           잔여 작업 인벤토리
│   ├── PAGES.md                    페이지 진입점 카탈로그
│   ├── PARALLEL_GUIDE.md           병렬 작업·머지·충돌 회피
│   ├── PARALLEL_TEMPLATE.md        트리거 템플릿
│   ├── CONTEXT_OPTIMIZATION.md     컨텍스트 다이어트 정책
│   ├── policies/
│   │   └── roles-and-permissions.md  4계층 권한 정책
│   └── standards/
│       └── AI_AGENT_PLATFORM_STANDARD.md  AI 표준 v1.4
│
├── specs/                  ← 명세 마스터 (운영 기준·고정)
│   ├── 근태관리시스템_명세서.md
│   ├── 성과관리시스템_명세서.md
│   ├── 교사유가족협의회_사단법인_예산시스템_기능설계도_v3.md
│   ├── 2026-05-19-phase24-milestone-performance.md
│   ├── 2026-05-19-phase26-attendance.md
│   ├── 2026-05-19-phase27-att-step9-17.md
│   └── 2026-05-19-phase28-performance-completion.md
│
├── active/                 ← 진행 중 라운드만 (현재 비어있음)
│
└── history/                ← 완료 히스토리·정독 비필수
    ├── milestones/         완료 Phase·Round 26개 (Phase 22~R37)
    ├── verify/             검증 보고서 24개
    ├── gap/                갭 분석 6개 (R29~R35)
    ├── analysis/           정합도 분석 v1·v2 (근태·성과)
    ├── diagnostics/        진단 2개
    ├── cleanup/            정리 보고 1개
    ├── handover/v20.md     영구 archive 인수인계
    ├── milestones-archive.md  완료 Phase 통합 압축
    ├── verify-archive.md   검증 통합 압축
    └── issues-archive.md   이슈 통합 압축
```

---

## 🚀 진입 흐름

### 새 메인 채팅 진입 시
1. **CLAUDE.md** (자동 로드·재 Read 금지)
2. **PROJECT_STATE.md** (휘발성 상태)
3. **docs/rules/HANDOFF.md** (단일 최신 인수인계)
4. 작업 영역 관련 메모리 본문 정독 (`MEMORY.md` 인덱스 → 본문)
5. 큰 라운드 설계 시: `~/.claude/projects/.../memory/feedback_design_routine.md` 정독 필수

### 새 A·B·C 채팅 진입 시
1. 메인이 발사한 트리거 본문 정독
2. 트리거에 명시된 참조 문서 (보통 `docs/specs/` 또는 `docs/history/gap/`)
3. **CLAUDE.md §6.17** A·B·C 자율주행 정책 숙지

---

## 📌 명세 정합 시리즈 종결 (2026-05-20)

- **R29~R37**: 7라운드·65+건 명세 정합 fix + R36·R37 신규 기능 통합
- **정합도**: 근태 93.4% / 성과 96.7% (R37 종결 시점)
- **운영 시작 공식 선언**: 2026-05-20

자세한 누적 이력은 [history/handover/v20.md](history/handover/v20.md) 및 PROJECT_STATE.md 참조.

---

## 📝 갱신 정책

| 영역 | 갱신 시점 |
|---|---|
| `rules/HANDOFF.md` | 매 세션 종료 시·단일 최신 유지 |
| `rules/REMAINING_WORK.md` | 잔여 작업 우선순위 합의 시 |
| `specs/` | 명세 변경 시만 (운영 후 학습 단계 보강 포함) |
| `active/` | 새 라운드 설계 시 신설·종결 시 history/milestones/로 이동 |
| `history/` | 완료 라운드 마감 후 추가 (append-only) |
