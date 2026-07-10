# 다음 세션 트리거 (복붙용)

아래 블록을 새 채팅에 그대로 붙여넣으세요.

---

워크스페이스 전수감사 **수정 라운드**를 이어서 진행한다. 메인 단독·순차·데이터 정합성 최우선. 이미 배치1~5·7 완료(31건 배포). **배치6부터 계속.**

**먼저 읽을 것 (정독):**
1. `docs/active/2026-07-10-workspace-audit-fix-progress.md` — 진행상황·남은 배치·Swain 결정·재사용 패턴 (**필수**)
2. `docs/active/2026-07-10-workspace-audit.md` — 발견 172건 전체 (해당 배치 항목만 발췌 정독)
3. CLAUDE.md는 자동 로드됨. §6.14(기능 위주 설명)·§9.3(푸시 배치)·§6.16(진행률) 준수.

**작업 방식:**
- 배치 단위로: 관련 코드 정독 → 수정 → `npx tsc --noEmit`(exit 0) → JS면 `node --check` + 참조 HTML `?v=` 갱신 → 로컬 커밋(`.git/CMSG_TMP` heredoc + `git commit -F`, 한글 안전).
- push는 **라이브 검증 단위 완성 때만 1회**(배치 여러 개 묶어서). 문서만이면 HEAD 커밋에 `[skip netlify]`.
- 커밋 메시지 끝에 `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- 발견마다 코드에 `[P1-N]`/`[P2-N]` 주석으로 추적성 유지.

**진행 순서 (권장):**
1. **배치6** 알림 라우팅·죽은 링크 (P1-6,30 + P2-24,28,45,47,48,49,50) — decision-free, 빠른 성과
2. **배치11** IDOR·조회 보안 (P2-53,54,55,59,60,63) — 보안, decision-free
3. **배치10** 파일함·휴지통·R2 고아 (P1-1,26,27 + P2-8,9,10,12,21,22,23,44,58)
4. **배치9** 캘린더 (P1-13 공유캘린더·P1-14 구글중복·P2-2,3,4,5,32) — 결정 반영됨
5. **배치8** AI 비서 안전장치 통합 (P1-2,3,4,7,32,33,36,37 + P2-26,27,61,62,63) — **최대 리팩터, 설계부터**
6. **정리**: 배치4잔여(P2-36,70·P1-31 UI)·배치5잔여(P2-40·프론트401 P1-12,43)·배치7잔여(P2-35,17,6,33)·배치12(나머지 P2·P3 + P2-1/30 마이그 + P2-31 표시 + P1-10 토스)

**Swain 확정 결정 (그대로 반영):**
- 만근 = 영업일 출근율 기준(무출근 제외) / 셀프결재 차단 + 이사장(super_admin) 예외 / 공유캘린더 = 전 운영자 일정 표시(소유자명 병기) / 작업 토스 = 담당자면 수정 허용(assignedBy 무관)
- 메인 판단 진행: 월경계휴가 일자안분(P2-36)·구글 externalRef 중복방지(P1-14)·소정근무일 안내문구 정정(P2-70)·보류해제 버튼(P1-31)

**마이그레이션 필요(배치12, Swain 클릭)**: P2-30 current_due nullable(마감일 없는 지시카드 변경요청 500). 표준 흐름 = migrate-*.ts 작성→배포→`https://tbfa.co.kr/api/migrate-xxx?run=1` Swain 실행→확인→파일삭제.

**핵심 재사용 패턴** (진행상황 문서 §재사용 패턴 참조):
- 권한: 근태admin=국장 → `requireAdmin + canAccess(role,'att_config'|'att_manage')`. 성과=운영자직원 → `requireOperator + operatorGuardFailed`. 쓰기는 항상 내부 super_admin 재검사.
- KST: SQL `(ts AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Seoul')::date`, 날짜문자열 경계 `+09:00` 접미. 헬퍼 `lib/att-utils.ts`.
- 응답: `ok(x)`={ok,message,data} → 단건은 `res.data.data`.
- 알림·활동로그는 `lib/workspace-logger.ts`. 작업 알림 표준 링크 = `/workspace-kanban.html#task=N`.

시작 전 진행상황 문서 정독 후, 배치6 대상 코드부터 확인하고 착수한다.

---
