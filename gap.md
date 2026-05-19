R31-GAP-A 근태관리 2차 갭 분석 완료
보고서: docs/gap/2026-05-19-round2-att.md → main 5aec4cc로 push 완료 (https://github.com/endyd116-dot/TBFA-SIREN-CMS).

갭 21건 발견 (H 4 + M 12 + 부분 5)
🔴 H 4건 — 즉시 운영 영향

H1 어드민 직원 스케줄 저장 동작 불능 — JS가 존재하지 않는 /api/admin-att-member-schedule 호출 (404). 명세 admin-att-schedules로 변경 필요. body 키 5개 모두 다름.
H2 근무 정책 변경사항 미적용 — JS body 키(camelCase + Minutes/Hours 접미) ↔ 서버 기대 키(camelCase + Mins) 12개 모두 미스매치. 저장해도 기존값 유지.
H3 직원 수정 요청 옛 amend 경로 의존 — workspace-attendance.js가 여전히 /api/att-amend-request 호출 중. R29-P1 신설한 correction-request 사용 안 됨.
H4 직원 그룹 8개 API requireAdmin 격차 — R29-P1에서 9개는 requireOperator로 분리했으나 my-calendar·my-stats·remote-report·ai-draft·leave-balance·leave-history·leave-types·checkin-today는 누락.
🟡 M 12건 — createdBy 항상 NULL(.uid 잘못된 키), work_mode별 집계 부재, recurringRule "[object Object]" 표시, 카리오버 등 명세에 없는 UI 필드, HYBRID 요일 5요일 한정, FIELD·BUSINESS_TRIP 옵션 누락, 알림 actionUrl 미분기, att-export 권한 격리 등.

🟡 부분 구현 5건 — 퇴근 GPS 검증(명세 명시 vs 미구현), workplaceId 폼 부재, correction 알림 누락 등.

다음 라운드 권장 분담 (메인 설계 시)
H1·H2 같이 묶어서 어드민 워크스페이스 관리 JS 정정 1건 (가장 시급, 실제 동작 불능)
H3·H4 + M1·M10·M12 묶어서 가드 일관성·createdBy fix 1건
M4·M5·M7·M8 묶어서 어드민 UI 보강 1건
M11 명세서 단서 추가(코드 변경 없음) 1건
검증 메타: 명세 2종 전수 + TS 38개 + HTML 4개 + JS 3개 + schema 250라인 정독, 약 90분.

핵심 발견 (R29 라운드 누락분)
🔴 H 5건 (운영 깨짐 잠재 BUG)

CSV 다운로드 500 에러 — members.base_salary 컬럼 부재(schema·마이그 모두 없음), admin-milestone-settlement-export.ts:36에서 SELECT
마일스톤 정의 PATCH 미동작 — milestone-definitions.ts:104 sql.raw(q, vals) BUG fix 누락 (R29-GAP-P2-C와 동일 패턴)
분기 상태 변경 미동작 — milestone-quarters.ts:70 동일 BUG
비매출 2개 선택 검증 우회 — milestone-nonrevenue.ts:117 동일 BUG (VERIFIED 미확인 항목도 선택 가능)
EVENT_RANGE 단위 일관성 — UI "만원" 라벨 vs DB 시드 저장 단위 미정 → 50억~100억 표시 또는 50만→50원 저장 잠재
🟠 M 7건 — CSV roleLabel 대소문자(sm/pm/si vs SM/PM/SI)·AI 함수 이중화(ai-milestone-* vs ms-ai-*)·EVENT_RANGE UI 위치(명세 admin-milestone-settings vs 실제 workspace-milestones)·rolePermissions milestone:* 8개 권한 시드 미적용·자동 결산일 30일 후(UI 안내 10~14일과 불일치)·quarterApplicable 검증 누락·HOLD sql.raw escape

✅ 완전 구현 22건 확인 — 알림 16종(R29 패치 포함)·AI 5종·HOLD 트랜지션·D-N 카운트다운·breakdown 토글·결산 잠금·SI 공유 임계점·effective_from/to 격리·CSV 핵심 동작

다음 라운드 권장
R31-FIX(긴급): H1H4 4건 — 12시간 fix 가능 (sql.raw 3건 + base_salary 마이그 1건)
R31-OP-1: 시드 데이터 단위 결정 → H5 마무리
R32(추후): M1~M7 + 부분 구현 정리
메인 채팅 알림 메시지 (Swain 복붙용)
메인 → R31-GAP-B 결과 보고
성과관리 2차 갭 분석 main 안착 (9663c9a). R29-GAP에서 미발견된 H 5건(중 3건은 동일 sql.raw(q, vals) BUG fix 누락 — 운영 호출 시 동작 불능 확정), M 7건 식별. 보고서: docs/gap/2026-05-19-round2-ms.md. H1H4 fix는 코드 한 줄수십 줄, 다음 라운드 설계 권장. C·A 채팅에는 코드 영향 없음(분석 문서만) — 알림 불필요.