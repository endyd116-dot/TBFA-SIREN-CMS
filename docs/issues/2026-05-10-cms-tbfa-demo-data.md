# #BUG-2 — cms-tbfa 통합 회원·웹후원자·태그 더미 데이터

> **상태**: 🔵 진행 예정 (마일스톤 #16 단계 B에서 해결)
> **발견 일시**: 2026-05-10
> **발견 맥락**: 작업 C(#15) CSV 자동 매핑 검증 중 — 효성 contracts CSV로 100% 매칭된 지주은·박두용이 통합 회원 화면에 안 보임 → 화면이 더미 7명만 표시 중인 것 확인
> **심각도**: 🟠 High (운영 시작 시 즉시 차질)

---

## 1. 위치

`public/js/cms-tbfa.js:60-90`

```js
const DEMO_MEMBERS = [
  { id: 1, name: '김유족', phone: '010-1111-2222', ... },
  { id: 2, name: '이후원', ... },
  ...
  { id: 7, name: '강봉사', ... },  // 7명 하드코딩 더미
];
const DEMO_WEB_DONORS = [...];  // 4명 더미
const DEMO_TAGS = [...];
```

## 2. 영향

| 화면 | 영향 |
|---|---|
| cms-tbfa 통합 회원 탭 | 🔴 진짜 회원 안 보임 (7명 더미만) |
| cms-tbfa 웹 후원자 이관 탭 | 🔴 더미 (4명) |
| cms-tbfa 태그 관리 탭 | 🔴 더미 |
| CSV 자동 매핑 → 매칭된 회원 확인 | 🔴 cms-tbfa에서 추적 불가 |

## 3. 임시 회피 (지금 사용 가능)

- **`admin.html` → 회원 관리** 화면이 진짜 DB 연결됨
- 거기서 회원 검색 + 후원 내역 확인 가능
- CSV 매칭 검증도 admin 회원 관리로 진행

## 4. 해결 절차 (마일스톤 #16 단계 B)

상세: [docs/milestones/2026-05-10-donor-system.md](../milestones/2026-05-10-donor-system.md) §2

요약:
1. DEMO_MEMBERS·DEMO_WEB_DONORS·DEMO_TAGS 제거
2. `admin-members.ts` API 재사용 + source/donorType 필터 추가
3. 가입경로/후원 상태 뱃지 표시
4. 회원 상세 모달 + 후원 내역 탭 신설
5. 캐시버스터 갱신

## 5. 관련

- 발견 채팅: 메인 채팅 (작업 C 검증 중)
- 트리거: 효성 contracts CSV 자동 매핑 검증
- 마일스톤 #16 단계 B에서 해결 예정
