# 교사유가족협의회 공식 웹사이트

> 존엄한 기억, 투명한 동행 — Siren NPO Platform

[![Netlify Status](https://api.netlify.com/api/v1/badges/d39cffd1-af21-4ec9-98d2-b2e60800e771/deploy-status)](https://app.netlify.com/projects/tbfa-siren-cms/deploys)

🌐 **Live Site**: https://tbfa-siren-cms.netlify.app

---

## ✨ Features

### 사용자 기능
- 🎗 **후원** — 정기/일시 후원 (CMS, 카드, 계좌이체)
- 👤 **회원** — 일반/유가족/봉사자 가입, 유가족은 승인 절차
- 🤝 **유가족 지원 신청** — 심리상담 / 법률자문 / 장학사업 (파일 첨부 가능)
- 📰 **공지/FAQ** — DB 기반 동적 콘텐츠
- 📊 **마이페이지** — 후원 내역, 영수증, 1:1 상담 진행 현황

### 관리자 기능
- 📊 **대시보드** — 실시간 KPI + 차트 (Chart.js)
- 👥 **회원 관리** — 승인/정지/탈퇴, 엑셀 추출
- 💰 **기부 관리** — 결제 내역 + 영수증 일괄 발행
- 🤝 **지원 관리** — 신청 검토 → 매칭 → 완료 워크플로우
- 🤖 **AI 추천 센터** — 봉사자 매칭 알고리즘 + 후원 이탈 예측
- 📝 **콘텐츠 관리** — 공지/FAQ
- 🔐 **보안** — 2FA, IP 화이트리스트, 5회 실패 시 30분 잠금, 감사 로그

---

## 🛠 Tech Stack

| Layer | Technology |
|-------|-----------|
| **Frontend** | Vanilla HTML/CSS/JS (No framework) |
| **Backend** | Netlify Functions (Serverless Node.js 20) |
| **Database** | Netlify DB (Postgres - Neon) |
| **ORM** | Drizzle ORM + postgres-js |
| **Auth** | JWT (사용자/관리자 분리) + bcrypt |
| **Validation** | Zod |
| **File Storage** | Netlify Blobs |
| **Charts** | Chart.js |
| **Hosting** | Netlify |

---

## 📁 Project Structure

\`\`\`
tbfa-siren-cms/
├── public/                       ← 정적 프론트엔드
│   ├── index.html, about.html, support.html, news.html
│   ├── report.html, mypage.html, admin.html
│   ├── partials/                 ← 공통 헤더/푸터/모달
│   ├── css/                      ← base, layout, components, home, pages, admin
│   └── js/                       ← common, auth, donate, support, news, home, admin, charts
├── netlify/functions/            ← 서버리스 API
│   ├── auth-*.ts                 ← 회원 인증
│   ├── admin-*.ts                ← 관리자 API
│   ├── donate.ts, donations-mine.ts
│   ├── support-*.ts              ← 유가족 지원
│   ├── notices.ts, faqs.ts, seed.ts
│   └── ...
├── db/
│   ├── schema.ts                 ← Drizzle 스키마 (6개 테이블)
│   └── index.ts                  ← DB 연결 객체
├── lib/                          ← 공용 유틸
│   ├── auth.ts                   ← bcrypt + JWT
│   ├── admin-guard.ts            ← 관리자 권한 검증
│   ├── validation.ts             ← Zod 스키마
│   ├── response.ts               ← API 응답 헬퍼
│   └── audit.ts                  ← 감사 로그
├── drizzle/                      ← 마이그레이션 SQL
├── netlify.toml
├── tsconfig.json
└── package.json
\`\`\`

---

## 🚀 Local Development

### 사전 준비
- Node.js 20+
- Netlify CLI: \`npm install -g netlify-cli\`
- Git Bash 또는 PowerShell

### 설치
\`\`\`bash
# 1. 클론
git clone https://github.com/endyd116-dot/TBFA-SIREN-CMS.git
cd TBFA-SIREN-CMS

# 2. 의존성 설치
npm install

# 3. 환경변수 설정
cp .env.example .env
# .env 파일에 NETLIFY_DATABASE_URL 등 입력

# 4. DB 스키마 적용
npm run db:push

# 5. 로컬 서버 (Functions 포함)
netlify dev
\`\`\`

→ http://localhost:8888

### 초기 시드 (1회)
\`\`\`bash
curl -X POST "http://localhost:8888/api/seed?key=YOUR_ADMIN_PW"
\`\`\`

---

## 👤 Admin Access

- **URL**: \`/admin.html\`
- **기본 계정**: \`admin / admin1234\` (배포 직후 즉시 변경 필수!)
- **2FA**: 운영 시 OTP 활성화 권장

비밀번호 변경은 위 README 의 [PART 2 보안 강화] 섹션 참고.

---

## 🗄 Database Schema

| Table | Description |
|-------|-------------|
| \`members\` | 회원 (regular/family/volunteer/admin) |
| \`donations\` | 기부 내역 |
| \`support_requests\` | 유가족 지원 신청 |
| \`notices\` | 공지사항 |
| \`faqs\` | 자주 묻는 질문 |
| \`audit_logs\` | 감사 로그 (1년 보관) |

---

## 🌐 API Endpoints

### Public
- \`GET  /api/notices\` — 공지 목록
- \`GET  /api/notices?id=N\` — 공지 상세
- \`GET  /api/faqs\` — FAQ 전체
- \`POST /api/donate\` — 후원 (비회원 가능)

### Authenticated User
- \`POST /api/auth/signup\` — 회원가입
- \`POST /api/auth/login\` — 로그인
- \`POST /api/auth/logout\` — 로그아웃
- \`GET  /api/auth/me\` — 내 정보 + 통계
- \`GET  /api/donations/mine\` — 내 후원 내역
- \`POST /api/support/create\` — 지원 신청
- \`GET  /api/support/mine\` — 내 신청 내역
- \`POST /api/support/upload\` — 첨부파일 업로드 (multipart)

### Admin (별도 토큰 \`siren_admin_token\`)
- \`POST /api/admin/login\` — 관리자 로그인
- \`POST /api/admin/logout\` — 관리자 로그아웃
- \`GET  /api/admin/me\` — 관리자 정보 + KPI
- \`GET  /api/admin/stats\` — 차트용 통계
- \`GET  /api/admin/members\` — 회원 목록
- \`GET  /api/admin/members?id=N\` — 회원 상세
- \`PATCH /api/admin/members\` — 회원 상태 변경
- \`GET  /api/admin/donations\` — 기부 내역
- \`PATCH /api/admin/donations\` — 영수증 일괄 발행
- \`GET  /api/admin/support\` — 지원 신청 관리
- \`PATCH /api/admin/support\` — 신청 상태/매칭/완료
- \`GET  /api/admin/ai/match\` — 봉사자 매칭 추천
- \`GET  /api/admin/ai/churn\` — 후원 이탈 예측
- \`GET  /api/admin/ai/distribution\` — 회원 위험도 분포

---

## 🔐 Security

- ✅ HTTPS 전면 적용 (Netlify 자동)
- ✅ HSTS preload
- ✅ X-Frame-Options: DENY
- ✅ bcrypt 비밀번호 해싱 (rounds 10)
- ✅ JWT httpOnly 쿠키 (XSS 방어)
- ✅ 사용자/관리자 토큰 분리
- ✅ 5회 실패 시 30분 IP 잠금
- ✅ Drizzle ORM (SQL Injection 방어)
- ✅ Zod 입력 검증
- ✅ 감사 로그 (모든 인증/관리 활동)

---

## 🤝 Contributing

협의회 내부 운영진만 contribute 합니다. PR 전 사무국 협의 필수.

---

## 📞 Contact

- 사무국: contact@siren-org.kr
- 대표전화: 02-0000-0000

---

## 📜 License

© 2026 Teachers' Bereaved Families Association. All Rights Reserved.
\`\`\`
