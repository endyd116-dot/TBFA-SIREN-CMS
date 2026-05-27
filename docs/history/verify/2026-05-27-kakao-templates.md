# 카카오 알림톡 템플릿 자동 CRUD 시스템 — 라이브 검증 (2026-05-27)

> 대상: 운영자 CMS에서 알림톡 템플릿 등록→검수→승인→발송 자동 관리(솔라피 API 연동). env per-template 폐지.
> 방식: 메인 구축 + Swain 라이브 검증 @ https://tbfa.co.kr. 커밋 `e3a7ced`(+마이그 삭제·schema·메뉴얼 push).

## 결과 — PASS

| 항목 | 결과 | 근거 |
|---|---|---|
| 마이그 호출 | ✅ | `migrate-kakao-templates?run=1` → `ok:true`·table 생성·승인 6종 시드 `total:6`. 1회용 파일 삭제. |
| CMS 화면 | ✅ | 통합 CMS → 알림·발송 → 💬 카카오 알림톡 템플릿 → 6종 "승인" 표시·이벤트 연결 표시(Swain 확인). |
| 테스트 발송 | ✅ | [테스트 발송] → 실제 카카오톡 도착(Swain 확인). |

## 구성
- 테이블 `kakao_alimtalk_templates`(event_key=NotifyEvent값·solapi_template_id·status[draft/registered/inspecting/approved/rejected]·reject_reason·pf_id).
- solapi-client 카카오 관리 API: 채널조회·템플릿 등록·검수요청·상태조회·삭제·카테고리.
- 어댑터 `kakao-aligo`: env(`SOLAPI_TPL_*`) → **DB 이벤트별 승인 템플릿ID·pfId 조회**(env 폴백 유지·테이블 미존재 시 placeholder).
- `cron-kakao-template-status`(매시간): 검수중 템플릿 솔라피 상태 확인 → 승인/반려 자동 반영.
- `admin-kakao-templates`(API)+`admin-kakao-templates.html`: 목록·등록(등록+검수요청)·상태새로고침·테스트발송·이벤트매핑·활성토글·삭제. 조회 operator+/쓰기 admin+.
- pfId 솔라피 채널 API 자동 조회 → **env 추가 0개**.

## 의의
- §6.18(운영자 코드 없이 CMS 관리) 충족 — 템플릿 추가/삭제 시 개발자·env 개입 불필요.
- 솔라피 이전 트랙 최종 완성(SMS·MMS·프록시폐기 기완료 + 알림톡 DB관리).

## 잔여(선택)
- 운영자가 [＋ 새 템플릿 등록]으로 신규 템플릿 직접 생성→카카오 검수(1~3영업일)→승인 자동반영 실사용 1회 테스트.
