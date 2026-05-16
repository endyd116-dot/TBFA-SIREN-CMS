# Oracle Cloud Free Tier 알리고 카카오 프록시 구축 가이드

이 가이드는 SIREN 시스템이 Netlify 변동 IP 환경에서 알리고 카카오 알림톡을 안정 발송하도록 **무료 프록시 서버**를 구축하는 단계별 절차입니다. 1회 구축 후 영구 운영. 총 소요 시간 약 60분.

---

## 1단계 — Oracle Cloud 가입 (약 15분)

1. https://cloud.oracle.com/free 접속 → **무료로 시작하기**
2. 이메일·이름·국가(대한민국) 입력 → **다음**
3. 신용카드 등록 (한도 검증용, 결제 없음. **Always Free 한도 안에서만 사용 시 영구 무료**)
4. **홈 리전: Korea Central (Chuncheon)** 선택 — **중요**: 한번 정하면 변경 불가, 한국 IP 확보를 위해 춘천 선택
5. 가입 완료 후 OCI 콘솔(`cloud.oracle.com`) 로그인

---

## 2단계 — Reserved Public IP 발급 (약 5분)

1. OCI 콘솔 좌측 햄버거 → **Networking → Reserved Public IPs**
2. **Create reserved public IP** 클릭
3. 이름: `aligo-proxy-ip`, Compartment: 기본 → **Create**
4. 생성된 IP 주소 메모 (예: `158.180.123.45`) — **알리고에 등록할 고정 IP**

---

## 3단계 — VM 인스턴스 생성 (약 15분)

1. OCI 콘솔 햄버거 → **Compute → Instances** → **Create instance**
2. 설정:
   - **Name**: `aligo-proxy`
   - **Image**: Canonical Ubuntu 22.04 (Always Free 적격)
   - **Shape**: `VM.Standard.A1.Flex` (ARM, 1 OCPU, 6GB) — **Always Free 한도**
   - **Networking**:
     - VCN: 기본 생성
     - **Public IPv4 address**: **Do not assign a public IPv4 address** 선택 (Reserved IP 따로 붙임)
     - 또는 **Assign a public IPv4 address** 선택 후 나중에 Reserved IP로 교체
   - **SSH keys**: **Generate a key pair** → **Save Private Key**(`ssh-key-XXXX.key` 파일 다운로드, 안전한 곳에 보관)
3. **Create** → 인스턴스 생성 (약 1~2분)
4. 인스턴스 상세 화면 → **Attached VNICs** → 기본 VNIC 클릭 → **IPv4 Addresses** → 기존 Public IP **편집** → **No public IP** → 저장
5. 같은 화면에서 **Assign public IP** → **Reserved public IP** → 2단계에서 만든 `aligo-proxy-ip` 선택 → 할당

---

## 4단계 — 보안 그룹(8080·443 포트 열기) (약 5분)

1. 인스턴스 상세 화면 → **Primary VNIC** → **Subnet 링크 클릭**
2. Subnet 상세 → **Security Lists** → 기본 보안 목록 클릭
3. **Add Ingress Rules**:
   - Source CIDR: `0.0.0.0/0`
   - IP Protocol: `TCP`
   - Destination Port Range: `8080`
   - Description: `Aligo proxy from Netlify`
4. **Add Ingress Rules** 클릭 → 저장

---

## 5단계 — SSH 접속 (약 5분)

Windows PowerShell에서:

```powershell
# 다운로드한 ssh-key-XXXX.key의 권한 정정
icacls "C:\path\to\ssh-key-XXXX.key" /inheritance:r /grant:r "$($env:USERNAME):(R)"

# 접속 (Reserved IP 사용)
ssh -i "C:\path\to\ssh-key-XXXX.key" ubuntu@158.180.123.45
```

접속 성공하면 `ubuntu@aligo-proxy:~$` 프롬프트 표시.

---

## 6단계 — Node.js + 프록시 코드 배포 (약 10분)

VM 안에서:

```bash
# Node.js 20 설치
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# 프록시 폴더 생성
mkdir -p ~/aligo-proxy
cd ~/aligo-proxy

# server.js·systemd 유닛 가져오기 (방법 1: 직접 붙여넣기)
nano server.js
# → tbfa-mis 리포의 proxy-server/server.js 내용 전체 붙여넣기 → Ctrl+O 저장 → Ctrl+X 종료

# (또는 방법 2: GitHub raw URL로 wget)
# wget -O server.js https://raw.githubusercontent.com/endyd116-dot/TBFA-SIREN-CMS/main/proxy-server/server.js

# .env 파일 생성 (알리고 자격 정보)
nano .env
```

`.env` 내용 (실제 값으로):

```
PROXY_SECRET=임의의_긴_문자열_32자_이상
ALIGO_API_KEY=(알리고 콘솔 → API Key)
ALIGO_USER_ID=(알리고 콘솔 → 등록한 USER ID)
ALIGO_KAKAO_CHANNEL_ID=(알리고 콘솔 → Senderkey)
ALIGO_SENDER=(협회 발신번호, - 제거)
PORT=8080
```

저장 후 권한 제한:
```bash
chmod 600 .env
```

---

## 7단계 — systemd 서비스 등록 (약 5분)

```bash
# 유닛 파일 가져오기
sudo nano /etc/systemd/system/aligo-proxy.service
# → tbfa-mis 리포의 proxy-server/aligo-proxy.service 내용 붙여넣기

# 로그 파일 미리 생성
sudo touch /var/log/aligo-proxy.log
sudo chown ubuntu:ubuntu /var/log/aligo-proxy.log

# 활성화
sudo systemctl daemon-reload
sudo systemctl enable --now aligo-proxy

# 상태 확인 — active (running) 이어야 함
sudo systemctl status aligo-proxy
```

---

## 8단계 — 헬스 체크 (약 2분)

로컬 PC 브라우저에서:
```
http://158.180.123.45:8080/health
```

응답 예시:
```json
{"ok":true,"service":"aligo-kakao-proxy","configured":{"api_key":true,"user_id":true,"kakao_channel_id":true,"sender":true,"proxy_secret":true}}
```

모든 `configured`가 `true`면 OK.

---

## 9단계 — 알리고 콘솔 IP 정정 (약 2분)

1. 알리고 콘솔(`smartsms.aligo.in`) → 발송 서버 IP
2. **기존 등록한 6개 IP 모두 삭제**
3. **2단계에서 메모한 Oracle Reserved IP 1개만 등록** (예: `158.180.123.45`)

---

## 10단계 — Netlify 환경변수 추가

Netlify 사이트 설정 → Site configuration → Environment variables → **Add a variable**

| Key | Value |
|---|---|
| `ALIGO_PROXY_URL` | `http://158.180.123.45:8080/aligo/alimtalk` |
| `ALIGO_PROXY_SECRET` | (6단계 `.env`의 `PROXY_SECRET` 값 그대로) |

**기존** `ALIGO_API_KEY`·`ALIGO_USER_ID`·`ALIGO_KAKAO_CHANNEL_ID`·`ALIGO_SENDER`는 **이제 프록시에만 있으면 되므로 Netlify에서는 삭제해도 됨** (단 SMS도 알리고를 쓰면 ALIGO_API_KEY·ALIGO_USER_ID·ALIGO_SENDER는 SMS 발송 경로에 필요 — 일단 유지 권장).

저장 후 사이트 재배포 (Deploys → Trigger deploy → Clear cache and deploy site).

---

## 11단계 — 발송 검증

1. 어드민 → 발송 작업 만들기 → **카카오 단독** + `UH_7533 정기 결제 실패` 선택
2. 본인 번호 1명짜리 그룹 → 즉시 발송 → [등록]
3. 1~2분 후 작업 상세 새로고침
4. **성공 + 실제 카카오톡 도착** 확인

---

## 트러블슈팅

- VM에 SSH 안 됨 → 4단계 보안 그룹에 22번 포트도 열려 있는지 확인 (기본 자동 열림)
- 헬스 체크 안 됨 → 4단계 보안 그룹의 8080 포트 + 6단계 `.env` 권한·내용 확인
- 알리고 호출 실패 → `ssh`로 들어가 `sudo journalctl -u aligo-proxy -n 50 -f` 로 로그 확인
- 비용 청구됨 → 인스턴스가 Always Free 한도 초과(Shape이 A1 Flex 1 OCPU·6GB 이내) 확인

---

## 운영 메모

- VM은 영구 무료지만 **OCI 약관상 90일 미사용 시 회수** — 한 달에 한 번 SSH 로그인하면 안전
- 비밀번호·키 분실 시 OCI 콘솔에서 SSH 키 재설정 가능
- 알리고 API key 변경 시 `~/aligo-proxy/.env` 수정 + `sudo systemctl restart aligo-proxy`
