# Phase 9 — SMS·카카오 알림톡 외부 서비스 비교 (Swain 결정용)

> **작성**: 2026-05-10 / 메인 채팅 (Phase 9 외부 API 결정 사전 준비)
> **목적**: A(SMS)·B(카카오 알림톡) Phase 9 코드 착수 전 외부 서비스 1~2곳 선정
> **상태**: ✅ Swain 결정 완료 (2026-05-10) — 시나리오 B Aligo 통합 / 협회 대표번호 / 템플릿 메인 위임 / 선결제

---

## 1. 배경

Phase 8 알림 인프라가 SMS·카카오 알림톡 placeholder 어댑터까지 포함해서 머지 완료. Phase 9에서 placeholder를 실제 외부 서비스로 교체해야 한다. 대기 시간을 줄이기 위해 C가 Phase 8 검증 진행 중인 사이 외부 서비스 결정과 사전 절차(발신번호 등록·알림톡 템플릿 심사)를 시작하는 게 효율적.

알림톡 템플릿은 카카오 심사가 영업일 **3~5일** 걸려서 결정이 늦어지면 Phase 9 코드 머지 후에도 한참 placeholder 유지될 수 있다.

---

## 2. 비교 매트릭스 (한국 시장 기준)

| 항목 | **SOLAPI** | **Aligo** | **NHN Cloud** | **BizM** | **카카오비즈** |
|---|---|---|---|---|---|
| **통합형** (SMS+알림톡) | ✅ 한 계정 | ✅ 한 계정 | ✅ 한 계정 | 알림톡 전문 | 알림톡 전문 |
| **SMS 건당 가격** (추정) | 약 9원 | 약 7원 | 약 14원 | — | — |
| **알림톡 건당** (추정) | 약 7원 | 약 6원 | 약 9원 | 약 6원 | 약 8원 |
| **발신번호 등록 시간** | 1~2일 | 당일~1일 | 3~5일 | 위탁 1~2일 | 1주 이상 |
| **알림톡 템플릿 심사** | 영업일 3~5일 (대행 지원) | 영업일 3~5일 | 영업일 3~5일 | 영업일 3~5일 | 영업일 3~7일 |
| **SDK·문서** | TypeScript 공식 SDK·문서 우수 | JavaScript SDK 단순 | 멀티 언어 SDK·문서 충실 | REST API·SDK 단순 | 한국어 문서 우수 |
| **NPO·중소 사용 사례** | 매우 많음 | 많음 | 많음 (대기업·NPO) | 알림톡 전문 | 카카오 직속 |
| **안정성** (장애 빈도) | 매우 안정 | 안정 | 최고 (대기업급) | 안정 | 최고 (카카오 직속) |
| **결제 흐름** | 선결제 충전 | 선결제·후결제 선택 | 후결제 (월정산·세금계산서) | 선결제 | 선결제 |
| **테스트 모드** | 콘솔에서 토큰 발급·발송 | 동일 | 동일 | 동일 | 동일 |
| **회계·세금계산서** | 자동 발급 | 자동 발급 | 자동 발급 (월정산 좋음) | 자동 발급 | 자동 발급 |

> 가격은 추정치(2026년 초 시장 기준). 정확한 단가는 결정 후 견적 요청 시 확정.

---

## 3. 후보 시나리오

### 시나리오 A — SOLAPI 통합 (메인 추천)

- **장점**: SMS+알림톡 한 계정, TypeScript 공식 SDK, NPO 사용 사례 많음, 가격 합리
- **단점**: NHN보다 안정성 약간 낮음 (그래도 우수 수준)
- **적합**: 운영자 인적 자원 많지 않고 한 곳 통합 관리 선호

### 시나리오 B — Aligo 통합 (저비용 우선)

- **장점**: 가격 가장 저렴 + 발신번호 등록 빠름
- **단점**: SDK 단순함 (TypeScript 타입 정의 부족 → A·B 작업 시 자체 래퍼 필요)
- **적합**: 운영 비용 최소화 우선

### 시나리오 C — NHN Cloud 통합 (안정성 최우선)

- **장점**: 대기업급 안정성, 후결제(월정산) 깔끔, 회계 처리 편함
- **단점**: 가격 높음, 발신번호 등록 3~5일 소요
- **적합**: 회원·후원 규모 크고 안정성 최우선

### 시나리오 D — 분리 (SMS=Aligo, 알림톡=BizM)

- **장점**: 각 영역 최저가 조합
- **단점**: 두 계정·두 결제·두 SDK 관리, 운영 부담 ↑
- **적합**: 코드 작성·운영 인력 충분, 비용 최우선

---

## 4. 추천 — SOLAPI 통합 (시나리오 A)

이유:
- SIREN 운영 인력 규모(메인+병렬 채팅) — 통합 관리가 효율적
- TypeScript 공식 SDK가 Phase 9 어댑터 구현 부담 ↓
- 가격이 NPO 운영비에 부담 없음 (월 SMS 1,000건 = 약 9,000원)
- 한국 시장 점유율 높음 → 장애 시 대안·정보 풍부
- SMS·알림톡 한 곳에서 관리 → 회계 정산 단순

대안 추천: 협회 회계가 후결제·월정산을 강력 선호하면 NHN Cloud (가격 차이 ≈ 50% 더 비싸지만 회계 깔끔함).

---

## 5. Swain 결정 포인트

| # | 항목 | 결정 |
|---|---|---|
| 1 | 통합 vs 분리 | 시나리오 A·B·C(통합) 또는 D(분리) |
| 2 | 비용 vs 안정성 | A(균형) / B(저비용) / C(안정성) |
| 3 | 발신번호 | 협회 대표번호 사용? 별도 발신 전용 번호 신청? |
| 4 | 알림톡 템플릿 책임자 | 누가 9종 이벤트별 템플릿 문구 작성·심사 신청? (Swain 또는 메인 위임) |
| 5 | 결제 흐름 | 선결제(충전) vs 후결제(월정산) 선호 |

---

## 6. 결정 후 즉시 시작 가능한 사전 작업

1. 선정 서비스 가입·계정 생성 (Swain 또는 메인 위임)
2. 발신번호 신청 (KISA 통신사 연동 — 영업일 1~5일)
3. 알림톡 9종 이벤트별 템플릿 문구 작성 + 심사 신청 (영업일 3~5일)
4. SDK 인증 키 발급 + 환경변수 등록 (`.env.example` 갱신)

이게 진행되는 동안 A·B는 C Phase 8 검증 결과 대기. C 1번 머지 직후 코드 작업 시작 → 알림톡 심사 통과 시점에 카카오 어댑터 마무리.

---

---

## 7. ✅ Swain 결정 결과 (2026-05-10)

| 항목 | 결정 |
|---|---|
| **외부 서비스** | **Aligo 통합** (시나리오 B — SMS+알림톡 한 계정, 비용 우선) |
| **발신번호** | **협회 대표번호** 그대로 사용 |
| **알림톡 템플릿 책임** | **메인 위임** (메인 초안 → Swain 검토 → 시스템 심사 신청) |
| **결제 흐름** | **선결제** (충전 후 차감) |

### 결정 함의

- Aligo SDK가 단순함 → A·B Phase 9 코드 작업 시 자체 TypeScript 래퍼 1개 추가 필요 (1~2h)
- 협회 대표번호 발신 등록 → KISA 조회 시 협회 소유 확인 가능성 ↑ (등록 빠름)
- 메인 위임 → 9종 이벤트 템플릿 문구 초안 작성 후 Swain 검토 단계 1회
- 선결제 → 잘못된 대량 발송 방지, NPO 비용 통제 ↑

### 알림톡 템플릿 등록 범위 (메인 결정)

설계서 §3.2 기본 채널 정책상 **알림톡 필수 이벤트는 2종**:
- `billing.failed` (정기 결제 실패)
- `card.expiring` (카드 만료 임박)

다른 7종은 인앱+이메일 채널만이라 알림톡 미사용. **Phase 9에서는 위 2종만 사전 등록**. 나머지는 Phase 10·11에서 채널 추가 시 그때 등록.

이유: 카카오 심사 영업일 3~5일 + 광고성 알림 제약 + 정보성 알림(결제 실패·카드 만료)이 카카오 정책상 가장 안전.

---

## 8. 알림톡 템플릿 문구 초안 (메인 작성, Swain 검토 필요)

알림톡 템플릿은 카카오 심사 시 변수(#{이름}, #{금액} 등) 포함 가능. 정보성 알림 카테고리로 신청.

### 템플릿 1 — `billing.failed` 정기 결제 실패

**카테고리**: 정보성 알림 / 결제 안내
**버튼**: [후원 정보 확인]

```
[교사유가족협의회] 정기 후원 결제가 실패했습니다

#{회원이름}님, 안녕하세요. 교사유가족협의회입니다.

귀하의 정기 후원 #{금액}원이 결제되지 않았습니다.

▪ 사유: #{실패사유}
▪ 연속 실패: #{연속실패횟수}회
▪ 다음 재시도: #{재시도일자}

카드 한도·잔액 또는 카드 정보를 확인해 주시고,
계속 실패 시 자동으로 후원이 해지될 수 있습니다.

[후원 정보 확인] 버튼으로 즉시 점검 가능합니다.
감사합니다.
```

변수: `회원이름`, `금액`, `실패사유`, `연속실패횟수`, `재시도일자` (5개)
링크: `https://tbfa-siren-cms.netlify.app/mypage/donation` (마이페이지 후원 정보)

### 템플릿 2 — `card.expiring` 카드 만료 임박

**카테고리**: 정보성 알림 / 결제 안내
**버튼**: [카드 정보 갱신]

```
[교사유가족협의회] 등록 카드 만료가 #{잔여일수}일 남았습니다

#{회원이름}님, 안녕하세요. 교사유가족협의회입니다.

귀하의 정기 후원에 등록된 카드 만료일이 임박했습니다.

▪ 카드 만료일: #{카드만료일}
▪ 잔여 일수: #{잔여일수}일

만료 전에 새 카드 정보로 갱신해 주셔야
정기 후원이 중단 없이 계속됩니다.

[카드 정보 갱신] 버튼으로 즉시 갱신 가능합니다.
감사합니다.
```

변수: `회원이름`, `카드만료일`, `잔여일수` (3개)
링크: `https://tbfa-siren-cms.netlify.app/mypage/donation` (마이페이지 후원 정보)

### 검토 포인트 (Swain용)

1. 톤·문구가 협회 정체성과 맞나?
2. 변수 5개·3개 구조 OK? (Aligo 시스템에 입력해 그대로 등록)
3. 버튼 링크 마이페이지 경로가 정확한가? (실제 페이지 경로 확인 필요)
4. 발송 시점 — 카드 만료는 d-30 / d-14 / d-7 / d-3 / d-1 중 어느 시점에 알림톡 보낼지 (현재 코드는 d-30/d-14/expired만 분기)

---

## 9. Swain 사전 액션 (Phase 9 코드 시작 전)

A·B Phase 9 코드 작업이 시작 가능하려면 운영 측 사전 등록이 필요. 시간 순서:

### 9-1. Aligo 가입 + 협회 정보 등록 (1일 이내)

- Aligo 홈페이지(www.aligo.in 또는 동급 URL)에서 협회 명의 가입
- 사업자등록증 업로드 (협회 명의)
- 결제수단 등록 (선결제 충전 — 초기 충전 5만원 권장)
- API 인증 키 발급 (`ALIGO_API_KEY`, `ALIGO_USER_ID`)

### 9-2. 발신번호 등록 (1~2일)

- 협회 대표번호 + 통신서비스 가입증명서 (이동통신사 모바일 또는 KT/SKT/LGU+ 사이트 발급)
- Aligo 콘솔에서 발신번호 등록 신청
- 등록 완료까지 영업일 1~2일

### 9-3. 카카오톡 채널 연동 + 알림톡 템플릿 신청 (3~5일)

선결: 협회 카카오톡 채널 존재 (검색 시 노출되는 협회 공식 채널)
- 카카오톡 채널이 없다면 먼저 카카오 비즈니스 채널 개설 (1일)
- Aligo 콘솔에서 카카오톡 채널 연동 (인증)
- 위 §8 템플릿 2종 등록 신청
- 카카오 심사 영업일 3~5일

### 9-4. 환경변수 등록 (메인이 안내)

A·B 코드 머지 시점에 다음 환경변수 추가:
- `ALIGO_API_KEY`
- `ALIGO_USER_ID`
- `ALIGO_SENDER` (등록한 발신번호)
- `ALIGO_KAKAO_CHANNEL_ID` (알림톡용)
- 템플릿 ID 2종 (`ALIGO_TEMPLATE_BILLING_FAILED`, `ALIGO_TEMPLATE_CARD_EXPIRING`)

### 9-5. 메인 측 사전 작업

- 위 §8 템플릿 2종 초안 작성 ✅ (이 문서)
- A·B Phase 9 분배 메시지 준비 (C 1번 머지 직후 발송용)

---

## 10. 일정 윤곽

```
[지금]
  메인:  §8 템플릿 초안 작성 ✅
  Swain: §9-1·9-2·9-3 사전 등록 시작 (1~5일)
  C:     Phase 8 어드민 화면 + Q24~Q28 라이브 검증 (새 채팅)

[C 1번 머지 시점]
  Phase 8 100% 선언
  메인이 A·B Phase 9 분배 메시지 발송
  A: SMS 어댑터 (Aligo SDK 래퍼 + 실연동)
  B: 알림톡 어댑터 (Aligo 카카오 + 템플릿 ID 매핑)
  C: 9-B 사용자 수신 설정 UI 또는 #BACKFILL-1 옛 효성 백필

[알림톡 심사 통과]
  B 카카오 어댑터 마무리 (placeholder → 실연동)
  Phase 9 100% 선언

[Phase 10 시작]
```

---

---

## 11. 환경변수 등록 가이드 (Swain 직접 / Netlify 콘솔)

A·B Phase 9 코드 머지 후 즉시 작동하려면 다음 환경변수를 Netlify 콘솔에 등록해야 한다. 보안상 키 값은 메인·코드 채팅에 공유하지 말고 Swain이 콘솔에 직접 입력.

### 필수 키 5개

| 환경변수 키 | 용도 | 출처 |
|---|---|---|
| `ALIGO_API_KEY` | Aligo API 인증 키 | Aligo 콘솔 → API Key 발급 |
| `ALIGO_USER_ID` | Aligo 계정 ID | Aligo 가입 시 ID |
| `ALIGO_SENDER` | 등록 발신번호 (협회 대표번호) | Aligo 콘솔 → 발신번호 등록 후 |
| `ALIGO_KAKAO_CHANNEL_ID` | 협회 카카오톡 채널 ID | 카카오 채널 연동 후 |
| `NOTIFICATION_TEST_MODE` | 테스트 모드 (true/false) | 운영 시 `false`, 개발 시 `true` 권장 |

### 알림톡 템플릿 ID (심사 통과 후)

| 환경변수 키 | 매핑 이벤트 | 등록 시점 |
|---|---|---|
| `ALIGO_TEMPLATE_BILLING_FAILED` | `billing.failed` | 카카오 심사 통과 시 |
| `ALIGO_TEMPLATE_CARD_EXPIRING` | `card.expiring` | 카카오 심사 통과 시 |

심사 통과 전에는 위 두 키를 빈 값 또는 미등록 상태로 두면 B 어댑터가 placeholder로 fallback (콘솔 로그만, 실 발송 X). 통과 후 값 입력하면 즉시 실 발송 작동.

### Netlify 콘솔 경로

1. https://app.netlify.com → tbfa-siren-cms 프로젝트
2. Site settings → Environment variables → Add new variable
3. 위 7개 키·값 입력 (필수 5개 즉시 + 템플릿 2개는 심사 통과 시)
4. 저장 → 다음 배포 시 자동 적용 (또는 수동 재배포)

---

## 12. A 채팅 — Phase 9 SMS 어댑터 (C 1번 머지 후 발송)

```
[A 채팅 — Phase 9 SMS 어댑터 실연동 (Aligo)]

워크트리: ../tbfa-mis-A
브랜치: 새로 분기 — feature/phase9-sms-aligo (베이스 main @ 9aacc48 또는 그 이후)
설계서 정독 (필수): docs/milestones/2026-05-10-phase9-external-services.md
선행: ✅ Aligo 가입·발신번호 등록 완료 / ✅ Phase 8 100% (C 1번 머지 후)
추정: 3~5h (Aligo SDK 단순 → 자체 TypeScript 래퍼 1~2h 포함)

작업:
  1) lib/aligo-client.ts (신규) — Aligo SMS API 자체 래퍼
     - POST https://apis.aligo.in/send/ (또는 공식 엔드포인트)
     - 인증: ALIGO_API_KEY + ALIGO_USER_ID
     - 응답 파싱 + providerMessageId(msg_id) 추출
     - 에러 처리·재시도 책임은 디스패처에 위임 (단일 호출 1회)
     - TypeScript 타입 정의 — Aligo 응답 스키마

  2) lib/notify-adapters/sms-aligo.ts (신규) — sms-placeholder.ts 대체
     - send(opts) 인터페이스 그대로 (디스패처 변경 0)
     - aligo-client 호출 + AdapterResult 매핑
     - NOTIFICATION_TEST_MODE=true 시 콘솔 로그 + DB sent 기록만

  3) lib/notify-dispatcher.ts — sms 어댑터 등록 변경
     - sms-placeholder import 제거 → sms-aligo import
     - 다른 채널(인앱·이메일·카카오)는 변경 없음

  4) lib/notify-adapters/sms-placeholder.ts — 삭제

  5) 환경변수 검증 (.env.example 갱신)
     - ALIGO_API_KEY, ALIGO_USER_ID, ALIGO_SENDER

  6) 단위 검증
     - 빌링 실패 케이스 강제 → SMS 어댑터 호출 → Aligo 라이브 응답 → dispatch_logs sent
     - 한 번 실제 발송 (테스트 번호)
     - 잘못된 발신번호 케이스 → 에러 로그 + status=failed

영역 회피:
  - lib/notify-adapters/kakao-* (B 영역, 변경 없음)
  - lib/notify-events.ts (이벤트 카탈로그, 변경 없음)
  - 디스패처 본체는 어댑터 등록만 변경

머지 전 체크 (CLAUDE.md §6 사전 점검):
  - 응답 키 다중 fallback (Aligo 응답 구조 확인)
  - 발신번호 잘못 입력 시 에러 메시지 명확
  - 1회 실제 발송 검증 결과 메인 보고
```

---

## 13. B 채팅 — Phase 9 카카오 알림톡 어댑터 (C 1번 머지 후 발송)

```
[B 채팅 — Phase 9 카카오 알림톡 어댑터 실연동 (Aligo)]

워크트리: ../tbfa-mis-B
브랜치: 새로 분기 — feature/phase9-kakao-aligo (베이스 main @ 9aacc48 또는 그 이후)
설계서 정독 (필수): docs/milestones/2026-05-10-phase9-external-services.md
선행: ✅ Aligo 가입·카카오 채널 연동 완료 / ⏸ 카카오 심사 진행 중 (코드 작업은 가능, 실 발송은 심사 통과 후)
추정: 4~6h

작업:
  1) lib/aligo-kakao-client.ts (신규) — Aligo 알림톡 API 래퍼
     - A의 lib/aligo-client.ts와 분리 (공통 인증만 공유 가능, 호출 엔드포인트 다름)
     - POST 알림톡 엔드포인트
     - 템플릿 ID + 변수 치환 페이로드 구성
     - 응답 파싱 + providerMessageId 추출

  2) lib/notify-adapters/kakao-aligo.ts (신규) — kakao-placeholder.ts 대체
     - send(opts) 인터페이스 그대로
     - 이벤트 → 템플릿 ID 매핑:
        NotifyEvent.BILLING_FAILED   → process.env.ALIGO_TEMPLATE_BILLING_FAILED
        NotifyEvent.CARD_EXPIRING    → process.env.ALIGO_TEMPLATE_CARD_EXPIRING
     - 변수 치환 (params → 템플릿 변수)
        billing.failed: 회원이름·금액·실패사유·연속실패횟수·재시도일자
        card.expiring: 회원이름·카드만료일·잔여일수
     - 템플릿 ID 환경변수가 비었거나 undefined면 placeholder 동작 (콘솔 로그만, status=sent로 기록)
        → 카카오 심사 통과 전에도 전체 흐름 검증 가능
     - NOTIFICATION_TEST_MODE=true 시 동일 placeholder 동작

  3) lib/notify-dispatcher.ts — kakao 어댑터 등록 변경
     - kakao-placeholder import 제거 → kakao-aligo import

  4) lib/notify-adapters/kakao-placeholder.ts — 삭제

  5) 환경변수 검증 (.env.example 갱신)
     - ALIGO_API_KEY (A와 공유), ALIGO_KAKAO_CHANNEL_ID
     - ALIGO_TEMPLATE_BILLING_FAILED (심사 통과 후 등록)
     - ALIGO_TEMPLATE_CARD_EXPIRING (심사 통과 후 등록)

  6) 단위 검증
     - 카드 만료 d-1 케이스 강제 → 카카오 어댑터 호출
     - 템플릿 ID 미등록 상태 → placeholder fallback 동작 확인 (콘솔 로그)
     - 템플릿 ID 등록 상태 (심사 통과 시) → 실 발송 라이브 검증

영역 회피:
  - lib/notify-adapters/sms-* (A 영역, 변경 없음)
  - lib/aligo-client.ts (A 작성, B는 사용만 가능 — 알림톡 엔드포인트는 별도 클라이언트)

머지 전 체크:
  - 템플릿 ID 미등록 fallback 검증 (회귀 보장)
  - 변수 치환 결과 카카오 심사 문구와 정확히 일치
  - 1회 실제 발송 (심사 통과 후) 결과 메인 보고
```

---

## 14. C 채팅 — Phase 9 9-B 사용자 수신 설정 UI (B 머지 후 또는 C 1번 머지 후)

C 1번 끝나면 다음 작업으로 9-B 사용자 수신 설정 UI 또는 #BACKFILL-1 옛 효성 백필 중 선택. 9-B 메시지는 시점에 별도 작성.

---

## 15. 참고

- Phase 8·9 통합 설계서: [2026-05-10-notifications.md](2026-05-10-notifications.md)
- Phase 10~22 카탈로그: [2026-05-10-phase10-22-catalog.md](2026-05-10-phase10-22-catalog.md)
