# 직원 전자 근로계약 시스템 — 설계서 (2026-07-27)

> 슈퍼어드민이 직원에게 근로계약서를 만들어 전달 → 직원이 워크스페이스에서 서명(또는 반려) → 완료 시 R2 박제 → 양측 다운로드.
> 급여 명세서 전자서명 인프라를 토대로 재사용. 함께워크 ON 전자계약(`econtract`) 패턴 참고(단일서명→2자 확장).

## 0. Swain 확정 결정 (2026-07-27)
1. **주민번호**: 암호화하여 DB 저장 (AES-256-GCM · env 키 · 화면은 마스킹).
2. **계약서 양식**: 사업자별 양식 CRUD (조항 본문 편집 가능 · `{{치환}}`).
3. **서명 순서**: 작성 시 회사 도장 자동 날인 → 직원 서명 → 즉시 완료·박제.
4. **직원 반려**: 서명 또는 반려(사유 입력) 둘 다. 반려 시 슈퍼어드민 알림 → 수정 후 재발송.

## 1. 재사용 (검증된 급여 인프라 — 거의 그대로 복제)
- **PDF**: `lib/payroll-pdf.ts` — `loadKoreanFont()`·`subset:false`·`drawRun` 글자별 배치·`embedPng` 서명/도장 합성. netlify.toml `included_files=["assets/fonts/**"]`를 **새 PDF 쓰는 함수마다** 등록(누락 시 라이브만 조용히 실패).
- **박제**: `lib/payroll-document.ts` — `sha256Hex`·`uploadToR2(isPublic:false,expiresInDays:null)`·멱등·`bumpVersion` 재발행. → `lib/contract-document.ts`로 복제.
- **서명 캔버스**: `public/js/workspace-payroll.js` `bindSignUI`/`submitSignature` + 서버 `normalizeSignaturePng`(sharp 재인코딩·깨진 PNG 무한루프 차단).
- **R2**: `lib/r2-server.ts` `uploadToR2`/`downloadFromR2`, 서빙 `/api/blob-image?id=`.
- **권한**: `lib/role-permission-check.ts` `canAccess`(super_admin 항상 true) + 급여식 백엔드 `role!=='super_admin'` 하드코딩(최종 방어선).
- **CMS 등록**: iframe 4곳(`cms-tbfa.html` 사이드바 li·section / `cms-tbfa.js` titles·setupTabs) + MENU_PERM 1곳.
- **직원 게이트**: `lib/operator-guard.ts` `requireOperator`(직원 본인만).

## 2. 신규 DB 테이블 4개 (raw SQL 마이그 → schema.ts append-only 추가)

### contract_business_entities — 계약 주체(사업자)
`id, name(상호), entity_type('corporation'|'individual'), representative(대표자), biz_no, address, phone, seal_r2_key(도장·nullable), sort_order, is_active, created_at, updated_at`

### contract_templates — 계약서 양식 (사업자별)
`id, entity_id(FK), title, kind('employment'), body(조항 {{치환}}), version, is_active, created_at, updated_at`

### employment_contracts — 계약 본체
`id, entity_id(FK), template_id(FK), member_id(근로자), status('draft'|'sent'|'completed'|'rejected'|'voided'), title,`
`fields(jsonb 가변필드 스냅샷), body_snapshot(치환완료 본문 전문 — 서명당시 박제·ON 함정 회피),`
`resident_no_enc(주민번호 암호화), resident_no_mask(앞6-뒤*),`
`company_seal_r2_key(날인 스냅샷), company_signed_at, company_signed_by(슈퍼어드민),`
`employee_sig_r2_key, employee_sig_type('draw'|'type'|'seal'), employee_signed_name, employee_signed_at, employee_sign_ip, employee_sign_device,`
`rejected_reason, rejected_at,`
`document_r2_key, document_sha256, document_version,`
`voided_at, voided_reason, voided_by, created_by, created_at, updated_at, sent_at`

### contract_signature_events — 증적 append-only (급여 payroll_acknowledgments 대응)
`id, contract_id(FK), actor('company'|'employee'|'system'), action('CREATED'|'SENT'|'VIEWED'|'SIGNED'|'REJECTED'|'VOIDED'|'REISSUED'|'ATTACH'), signature_type, signed_name, document_sha256, ip, user_agent, meta(jsonb), created_at`

### contract_attachments — 부속 서류 (신분증·통장 사본 등 · 2026-07-27 Swain 추가)
`id, contract_id(FK), kind('id_card'|'bankbook'|'etc'), label(표시명), blob_id(FK blob_uploads)·blob_key, file_name, mime_type, size_bytes, uploaded_by(member.id), uploaded_role('employee'|'company'), created_at, deleted_at(소프트삭제)`
- 세금관리·4대보험 등록용. 민감 PII → `isPublic:false`·blob-image 접근 super_admin+본인만.
- 업로드: **blob-presign 3단계**(대용량·급여 서명 PNG의 단순경로와 다름). 직원이 서명 후 유도 + 슈퍼어드민도 첨부·열람.

**members 테이블은 건드리지 않음** — 계약 필드는 전부 employment_contracts.fields 스냅샷. 다음 계약 시 이전 계약에서 prefill.

## 3. 치환 키 (`{{key}}`)
- 회사(entity 자동): `{{회사상호}} {{회사대표자}} {{회사사업자번호}} {{회사주소}}`
- 근로자(생성 시 입력·prefill): `{{성명}} {{생년월일}} {{주소}} {{연락처}} {{주민번호}}`
- 조건: `{{계약시작일}} {{연봉}} {{월지급액}} {{지급일}} {{근무장소}} {{담당업무}} {{근무시작시각}} {{근무종료시각}} {{수습개월}}`
- 도장 마커: `[[SEAL:company]]`(회사 도장 위치) · 근로자 서명란은 PDF 메타블록에서 합성
- 미매칭 키는 `{{key}}` 그대로 둠(안전 폴백).

## 4. 워크플로우 (상태 머신)
```
[슈퍼어드민] 사업자·양식 선택 → 근로자 선택 → 가변필드 입력(이전계약 prefill) → 미리보기
      ↓ 발송 (회사 도장 자동 날인 · body_snapshot 박제)
draft ──────────────→ sent  (직원에게 인앱+알림톡 알림 · "내 근로계약" 배지)
                        ↓
      [직원] 워크스페이스 "내 근로계약" → 열람(VIEWED) → 계산 확인
                        ├─ 서명(손글씨/타이핑/도장) → completed → PDF 박제(양측 도장·서명) → 슈퍼어드민 알림
                        │        ↓ 서명 후 "필요 서류 제출" 유도 (신분증·통장 사본 첨부·선택)
                        └─ 반려(사유) → rejected → 슈퍼어드민 알림 → 수정 후 재발송(새 차수)
completed → [슈퍼어드민] 부속서류 열람·다운로드(세금등록) / 정정 재발행(bumpVersion·이전 증적 보존) / 무효(voided·소프트)
```

## 5. 주민번호 암호화 (`lib/crypto-pii.ts` 신규)
- AES-256-GCM. env `CONTRACT_PII_KEY`(32바이트·base64 또는 hex). 미설정 시 fail-closed(주민번호 입력만 막고 나머지 계약은 진행).
- 저장: `encryptPII(주민번호)` → `iv:tag:ciphertext` base64 → `resident_no_enc`. 마스킹 `앞6-*******` → `resident_no_mask`.
- 복호화: PDF 생성·재발행 시에만 서버 메모리. 화면·API 응답엔 마스킹만.

## 6. API (급여 함수군 복제)
관리자(super_admin 전용): `admin-contract-entities`(사업자 CRUD+도장업로드) · `admin-contract-templates`(양식 CRUD) · `admin-contracts`(목록·생성·발송·재발행·무효) · `admin-contract-pdf`(전문/증적) · `admin-contract-evidence`(증적+부속서류 ZIP) · `admin-contract-attachments`(부속서류 목록·삭제)
직원(requireOperator): `contract-my`(내 계약 목록·상세) · `contract-my-sign`(서명/반려) · `contract-my-attach`(부속서류 업로드 confirm)
공용(3단계 업로드): 기존 `blob-presign`/`blob-confirm`/`blob-image` 재사용(context `contract-doc`).

## 7. 프론트
- 어드민: `public/admin-contract.html` + `public/js/admin-contract.js` (사업자·양식·계약 3영역) → CMS iframe 4곳 등록(`data-tab="contract"`, 운영 관리 그룹, super 전용).
- 직원: `public/workspace-attendance.html`에 "내 근로계약" 탭 추가(급여 탭 옆) 또는 `workspace-contract.html`. 서명 캔버스 재사용.

## 8. 프리셋 시드 (마이그)
1. **(사)교사유가족협의회** — corporation · 대표 박두용(이사장) · biz_no 1188271215 · 도장 없음(나중 등록).
2. **함께워크 ON** — individual · 박두용 · 744-35-01509 · "서울특별시 강서구 공항대로 426, VIP오피스텔 6층 618·619호" · 도장=박두용(assets에서 R2 자동 업로드).
3. **함께워크 SI** — individual · 박두용 · biz_no·주소 placeholder(CRUD 수정) · 도장=박두용.
- 양식: ON 초안(`assets/근로계약서_함께워크ON_V1.0.docx`)을 `{{치환}}`으로 변환해 3사 양식 시드(사업자 정보는 치환).
- 도장: `assets/박두용 도장.png` → R2 업로드(context `contract-seal`) → ON·SI `seal_r2_key` 연결.

## 9. 보안·회귀 주의
- 계약 PDF `isPublic:false`·`expiresInDays:null`(법정 보존). blob-image 접근은 super_admin+본인만(급여식 IDOR 가드).
- 주민번호: 평문 로그 금지·API 응답 마스킹만·env 키 미설정 fail-closed.
- schema.ts append-only(본인 섹션 헤더) · 마이그 호출 후 정의 추가 · netlify.toml 폰트+도장 included_files.
- 신규 env: `CONTRACT_PII_KEY`(주민번호 암호화). 배포 게이트에 포함.

## 10. 진행 단계
1. ✅ 설계 + 마이그(테이블4·프리셋3·도장R2·양식시드) + 암호화 유틸 → **Swain 마이그 호출**
2. 백엔드 API + `lib/contract-document.ts` + `lib/contract-pdf.ts`
3. 어드민 프론트 + CMS 등록
4. 워크스페이스 "내 근로계약" + 서명
5. 알림·메뉴얼·소식 + 배포·검증
