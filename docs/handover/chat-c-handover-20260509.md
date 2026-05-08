# 작업 C 인계서 — 2026-05-09

> **목적**: 같은 working directory 충돌 사고 정리 후, 새 worktree에서 작업 C(#15 효성+기업은행 CSV 자동 매핑) 본체를 이어받기 위한 인계 문서.
> **새 C 채팅 시작 시 이 파일 + `CLAUDE.md` + `PROJECT_STATE.md §4.3 / §6` 을 먼저 읽으세요.**

---

## 0. 인계 시점 git 최종 스냅샷

```
* feature/csv-donation-mapping 0453071 [origin/feature/csv-donation-mapping]  (동기화)
  feature/eligibility-change   52b716c [origin/main]                          (A 대기)
  main                         52b716c [origin/main]
```

- `0453071` = `docs(parallel-c): 작업 C 시작 — feature/csv-donation-mapping 브랜치 생성, §4.3 진행률 5%`
- 변경 파일: `PROJECT_STATE.md` 1개 (§2 한 행 추가, §4.3 진행률·담당·다음 할 일 갱신)
- 모든 흔적 origin 반영 완료. force push 사용 안 함.

---

## 1. 환경 확인 사항 — worktree 첫 진입 시 확인

```bash
git status                # On branch feature/csv-donation-mapping / up to date
git log --oneline -3      # 최상단: 0453071 docs(parallel-c)...
git branch -vv            # csv-donation-mapping이 origin/...과 동기화
```

기대값:
- HEAD = `0453071`
- `origin/feature/csv-donation-mapping`과 동기화
- working tree 깨끗 (`.claude/` untracked만 정상)

---

## 2. PROJECT_STATE.md §4.3 현재 상태 (origin 반영 완료)

| 항목 | 값 |
|---|---|
| 진행률 | 🟡 **5%** (브랜치 생성 + 시작 보고) |
| 담당 채팅 | C (csv-mapping) |
| 예상 시간 | 10~13h |
| 다음 할 일 | migrate-add-pending-donations 작성 → ibk-parser → matcher → API 3종 → cms-tbfa 탭 |

§2 마지막 업데이트 표에도 "C 채팅 작업 시작" 행 반영됨.

---

## 3. 작업 본체 시작점 (todo 순서)

1. **cms-tbfa.html 탭 패널 구조 파악** ← 첫 번째
2. `migrate-add-pending-donations.ts` (pending_donations + donation_matching_rules)
3. `lib/ibk-parser.ts` (hyosung-parser와 동일 인터페이스)
4. `lib/donation-matcher.ts` (이름·금액·날짜·계좌끝4 룰엔진)
5. `admin-donation-import.ts` (multipart 업로드 → pending 적재)
6. `admin-donation-pending-list.ts`
7. `admin-donation-confirm.ts` (1건/일괄)
8. `cms-tbfa-import.js` + `cms-tbfa.html` 탭 + `admin.html` 메뉴
9. 사용자 마이그 호출 → schema 활성화 → 마이그 파일 삭제
10. 사용자 검증 → PROJECT_STATE.md 100%

---

## 4. 사전 분석 완료 사항 (재조사 불필요)

| 파일 | 위치 | 메모 |
|---|---|---|
| `db/schema.ts` 끝 | 1843줄 | 이 뒤에 `/* === 작업 C: CSV 자동 매핑 === */` 헤더 + append-only |
| `donations` 테이블 | `schema.ts:293~` | `confirmed_donation_id` FK 대상. 이미 `hyosungMemberNo / hyosungContractNo / hyosungBillNo / hyosungBillingId` 컬럼 보유 — pending → donations 확정 시 활용 |
| `hyosung-parser.ts` 인터페이스 | `HyosungContractRow`, `HyosungBillingRow`, `ParseResult<T>`, `parseCsvText`, `normalizePhone/Amount/Date/Int/String`, `detectEncoding`, `detectCsvType` | ibk-parser는 동일 패턴: `IbkTransferRow`, `parseIbkTransfersCsv(text)`, `ParseResult<IbkTransferRow>` 반환. 정규화 유틸은 import해서 재사용 (시그니처 변경 금지) |
| `cms-tbfa.html` 사이드바 | 222~263줄 | "후원 관리" 그룹(`data-group="donation"`, 230~241줄) 하위 `<ul class="cms-submenu">`에 `<li><a href="#csv-import" data-tab="csv-import">📥 CSV 자동 매핑</a></li>` 추가 |
| `cms-tbfa.html` 메인 컨텐츠 | 277줄~ | `<div class="cms-content">` 내부 마지막 `<section class="cms-page" id="page-...">` 다음에 `<section class="cms-page" id="page-csv-import">...</section>` 추가 |
| `cms-tbfa.html` 총 라인 | 1112줄 | `</body>` 직전 script include 자리 |
| `admin.html` 총 라인 | 5620줄 | 메뉴 추가 위치 — 사이드바 `<nav>` 끝, emoji 📥 (§6.2 충돌 회피) |
| `requireAdmin` 반환 필드 | `auth.res` (response 아님) | CLAUDE.md §6.5 — 모든 `admin-*` 함수에서 `if (!auth.ok) return auth.res;` |

---

## 5. ⚠️ 이번 채팅에서 발견한 주의사항 (새 채팅 필독)

### 5.1 같은 working directory 공유 시 브랜치 충돌 발생 — 해결됨

- **증상**: `git checkout -b` 직후 다른 채팅이 `git checkout`을 하면 HEAD가 바뀌어 commit이 엉뚱한 브랜치로 들어감.
- **이번 사고**: 처음 `b5167bf` 커밋이 `feature/csv-donation-mapping` 대신 `feature/eligibility-change`에 들어갔음 → cherry-pick으로 정리 (`0453071`로 옮김) + `eligibility-change` reset.
- **대응**: 이번에 worktree로 분리 → 새 채팅은 별도 폴더에서 시작하므로 재발 위험 없음.
- **메모리 추가 권장(feedback 타입)**: "병렬 작업 시 `git worktree` 사용 필수 — 같은 working directory를 두 채팅이 공유 금지. 사고 사례: 2026-05-09 b5167bf → 0453071 cherry-pick 정리."

### 5.2 PROJECT_STATE.md 추가 메모는 안 했음

사용자 지시 "추가 커밋 하지 마" 준수. 새 채팅이 본격 작업 시작할 때 §4.3 진행률을 `🟡 5%` → `🟡 진행중 N%`로 직접 갱신하면 됩니다.

### 5.3 cherry-pick으로 옮긴 SHA

| 구 SHA | 신 SHA | 위치 |
|---|---|---|
| `b5167bf` (구, eligibility-change에 잘못 들어감) | `0453071` (현재 origin/csv-donation-mapping HEAD) | 두 SHA의 diff 동일 |

`b5167bf`는 더 이상 reachable한 브랜치에 없음 → git GC 대상.

---

## 6. 작업 흐름 시 절대 손대면 안 되는 영역 (재확인)

| 영역 | 이유 |
|---|---|
| `lib/auth.ts`, `lib/admin-guard.ts` | 회귀 위험 최고 (모든 인증 흐름 영향) |
| `lib/hyosung-parser.ts` 시그니처 | 호출처 회귀 위험 — 정규화 유틸은 import만 |
| `public/mypage.html`, `public/js/auth.js` | 작업 A 영역 |
| `public/js/admin-mypage-cancellation.js`, `public/js/admin-eligibility.js` | 작업 A 영역 |
| `db/schema.ts`, `public/admin.html` | 본인 섹션 끝에만 append-only (PROJECT_STATE §6.2 매트릭스) |

---

## 7. 머지 순서 (PROJECT_STATE §4.4)

**C → A → B** (변경량 작은 → 큰)

C 머지 전:
- [ ] `git fetch origin && git rebase origin/main` 충돌 해결
- [ ] CLAUDE.md §13 체크리스트 통과
- [ ] 마이그레이션 호출 성공 → schema 정의 활성화 → 함수 삭제 완료
- [ ] 캐시버스터 갱신 (`?v=2026-05-09-N`)
- [ ] 로컬 동작 확인 (`npm run dev` → 효성·기업은행 CSV 업로드 → 자동 매칭 → 1건/일괄 확정)
- [ ] §4.3 진행률 100% + §2 행 추가 후 push
- [ ] 사용자에게 "C 머지 완료" 알림 → A 채팅이 흡수

---

## 8. 데이터 모델 참고 (PROJECT_STATE §4.3 발췌)

```sql
CREATE TABLE pending_donations (
  id serial PRIMARY KEY,
  source varchar(20),                -- 'hyosung'|'ibk'
  source_file_name varchar(200),
  source_row_index int,
  raw_data jsonb,
  parsed_name varchar(100),
  parsed_amount int,
  parsed_date date,
  parsed_memo text,
  matched_member_id int REFERENCES members(id),
  match_score numeric(4,2),
  match_reason varchar(200),
  status varchar(20) DEFAULT 'pending',
  confirmed_donation_id int REFERENCES donations(id),
  imported_by int REFERENCES admins(id),
  created_at timestamp DEFAULT now()
);
-- donation_matching_rules 는 룰 엔진 가중치 저장용 (이름·금액·날짜·계좌끝4 가중치)
-- 신규 채팅에서 구체 컬럼 설계 (이번 채팅에서는 미설계)
```

---

**작성**: 2026-05-09 / C 채팅 (1차)
**다음 채팅이 할 첫 일**: 본 인계서 + `CLAUDE.md` + `PROJECT_STATE.md §4.3 / §6` 읽고 todo 1번(cms-tbfa.html 탭 분석)부터 시작.
