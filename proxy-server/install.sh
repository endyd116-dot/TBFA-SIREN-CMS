#!/bin/bash
# Oracle Cloud Free Tier (Oracle Linux 9, E2.1.Micro) 알리고 카카오 프록시 자동 설치.
# 호출: curl -fsSL https://raw.githubusercontent.com/endyd116-dot/TBFA-SIREN-CMS/main/proxy-server/install.sh | bash
set -e

echo "===================="
echo "[1/6] Swap 1GB 추가"
echo "===================="
if [ ! -f /swapfile ]; then
  sudo fallocate -l 1G /swapfile
  sudo chmod 600 /swapfile
  sudo mkswap /swapfile
  sudo swapon /swapfile
  if ! grep -q '/swapfile' /etc/fstab; then
    echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
  fi
  echo "Swap 1GB 추가 완료"
else
  echo "Swap 이미 존재 (skip)"
fi
free -h

echo ""
echo "===================="
echo "[2/6] Node.js 20 설치"
echo "===================="
if ! command -v node >/dev/null 2>&1; then
  sudo dnf module install -y nodejs:20/common
else
  echo "Node.js 이미 설치됨 (skip)"
fi
node --version
npm --version

echo ""
echo "===================="
echo "[3/6] 프록시 폴더 + server.js"
echo "===================="
mkdir -p /home/opc/aligo-proxy
curl -fsSL https://raw.githubusercontent.com/endyd116-dot/TBFA-SIREN-CMS/main/proxy-server/server.js -o /home/opc/aligo-proxy/server.js
echo "server.js 다운로드 완료"
ls -la /home/opc/aligo-proxy/server.js

echo ""
echo "===================="
echo "[4/6] systemd 유닛 등록"
echo "===================="
sudo curl -fsSL https://raw.githubusercontent.com/endyd116-dot/TBFA-SIREN-CMS/main/proxy-server/aligo-proxy.service -o /etc/systemd/system/aligo-proxy.service
sudo sed -i 's|User=ubuntu|User=opc|g' /etc/systemd/system/aligo-proxy.service
sudo sed -i 's|/home/ubuntu/aligo-proxy|/home/opc/aligo-proxy|g' /etc/systemd/system/aligo-proxy.service
sudo touch /var/log/aligo-proxy.log
sudo chown opc:opc /var/log/aligo-proxy.log
sudo systemctl daemon-reload
echo "systemd 유닛 등록 완료"

echo ""
echo "===================="
echo "[5/6] .env 템플릿 작성"
echo "===================="
if [ ! -f /home/opc/aligo-proxy/.env ]; then
  cat > /home/opc/aligo-proxy/.env <<'EOF'
PROXY_SECRET=CHANGE_ME_RANDOM_32CHARS_OR_LONGER
ALIGO_API_KEY=2tr8k7hxgtw3cio5de6mmu8fuqpak67z
ALIGO_USER_ID=tbfa4utb
ALIGO_KAKAO_CHANNEL_ID=2b03f0eb08403b81d399e64f8214fd14ed6b9ebd
ALIGO_SENDER=CHANGE_ME_PHONE_NUMBER_DASHES_REMOVED
PORT=8080
EOF
  chmod 600 /home/opc/aligo-proxy/.env
  echo ".env 템플릿 작성됨 — 다음 두 값을 수정하세요:"
  echo "  - PROXY_SECRET : 임의의 긴 문자열 (Netlify와 동일하게 사용)"
  echo "  - ALIGO_SENDER : 협회 대표번호 (- 제거)"
else
  echo ".env 이미 존재 (skip)"
fi

echo ""
echo "===================="
echo "[6/6] 다음 단계 안내"
echo "===================="
echo "1) .env 작성:"
echo "     nano /home/opc/aligo-proxy/.env"
echo ""
echo "2) 서비스 시작:"
echo "     sudo systemctl enable --now aligo-proxy"
echo ""
echo "3) 헬스 체크:"
echo "     curl http://localhost:8080/health"
echo ""
echo "4) 외부에서 접근 확인 (브라우저):"
echo "     http://168.107.37.197:8080/health"
echo ""
echo "===================="
echo "설치 단계 완료. .env 수정 후 systemctl 시작하세요."
echo "===================="
