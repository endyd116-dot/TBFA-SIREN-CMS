# 딥릴리프 자료 추출 개선 + 발간 권한 — 라이브 검증 (2026-05-27)

> 대상: 딥릴리프 P4 종결 후 자료 추출 개선(Swain 마지막 요청) + 발간 권한 정책 연동.
> 방식: C(검증 에이전트) admin 계정 라이브 curl 검증 @ https://tbfa.co.kr. 코드 수정 0.
> 관련 커밋: `562b5fb`·`71481da`(발간 권한)·`b8603be`(전사 열람·m4a)·`8c628d2`(.doc/.hwp)·`6eadf8f`(마이그 삭제).

## 결과 요약 — FAIL 0 / 전 항목 PASS

| 항목 | 결과 | 근거 |
|---|---|---|
| 0. 배포 | ✅ 완료 | doc-text 함수 401 전환(7회차·약 3분)·admin 로그인 ok(super_admin) |
| 1. 발간 권한 항목 등록 | ✅ PASS | `role_permissions`에 `martyrdom_publication`(cms·admin허용·operator불가·오늘 갱신) |
| 2. 발간 목록 `canWrite` | ✅ PASS | `GET admin-martyrdom-publication` → `canWrite:true` + publications 6건 정상 |
| 3. 전사·추출 전문 열람(핵심) | ✅ PASS | 아래 상세 |
| 4. m4a/.doc/.hwp 신규 추출 | ⚠️ 부분 | m4a·hwp 작동 확인 / .doc done 샘플 없음 → 실파일 E2E Swain 수동 |

## 항목 3 상세 (핵심 — 추출본 보기)
- 사건 id=2(제주중 현승준 선생님·문서 71개) 사용. 추출 분포: docx 18 / gemini_ocr 33 / hwp 11 / **gemini_audio 2** / xlsx 2 / plain_text 1 / manual 2.
- **음성 전사 전문 정상 조회**:
  - doc 198(`제주교육청_미팅.m4a`): method=gemini_audio·status=done·**extractedText 10,003자**(화자분리 전사 실데이터).
  - doc 222(`변호사 통화 1차 통화음성.m4a`): **16,118자** 전사.
- negative: id 없이 → **400** / 쿠키 없이 → **401**. 게이트 정상.

## 항목 4 비고
- **m4a**: gemini_audio 2건 이미 done 전사 완료 → 파이프라인 작동 확인. mime 폴백은 향후 `audio/mp4` 거부 케이스 대비 안전망.
- **.hwp**: hwp method 11건 중 done 존재(id=191 등 1,022자) → 작동 확인.
- **.doc**: done 상태 .doc 샘플 없음. 기존 .doc(235)·구형 .hwp(237)은 신규 로직 이전 업로드분(manual/failed/0자) — 엔드포인트는 레코드 정상 반환. **신규 .doc/.hwp 추출 품질은 실파일 업로드 E2E 필요.**

## Swain 수동 검증 권장
신규 **.doc**(특히 done 샘플 없음)·필요시 .m4a/.hwp 실파일을 사건에 업로드 → 비동기 추출 완료 후 [보기]에서 추출/전사 전문 표시 1회 확인.
