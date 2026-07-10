#!/bin/bash
# scripts/setup_vps.sh
# Configuração completa da VPS DigitalOcean
# Execute como root após criar o droplet Ubuntu 22.04

set -e

echo "========================================"
echo "  LCR Flow — Setup VPS"
echo "========================================"

# ── Atualiza sistema ──────────────────────────────────────────────────
echo "[1/7] Atualizando sistema..."
apt-get update -qq && apt-get upgrade -y -qq

# ── Instala dependências base ─────────────────────────────────────────
echo "[2/7] Instalando dependências..."
apt-get install -y -qq \
    curl git wget unzip p7zip-full unrar \
    python3 python3-pip \
    build-essential \
    ca-certificates gnupg

# ── Instala Docker ────────────────────────────────────────────────────
echo "[3/7] Instalando Docker..."
curl -fsSL https://get.docker.com | sh
usermod -aG docker $USER

# Instala Docker Compose
curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" \
    -o /usr/local/bin/docker-compose
chmod +x /usr/local/bin/docker-compose

# ── Instala Node.js 20 ────────────────────────────────────────────────
echo "[4/7] Instalando Node.js 20..."
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y -qq nodejs

# ── Cria estrutura do projeto ─────────────────────────────────────────
echo "[5/7] Criando estrutura de pastas..."
mkdir -p /opt/lcr-flow/{sessions,screenshots,outputs,config,logs}
cd /opt/lcr-flow

# ── Configura firewall ────────────────────────────────────────────────
echo "[6/7] Configurando firewall..."
ufw allow ssh
ufw allow 5678/tcp  # n8n
ufw allow 3000/tcp  # API Playwright
ufw --force enable

# ── Configura timezone ────────────────────────────────────────────────
echo "[7/7] Configurando timezone..."
timedatectl set-timezone America/Sao_Paulo

echo ""
echo "========================================"
echo "  Setup concluído!"
echo ""
echo "  Próximos passos:"
echo "  1. Copie os arquivos do projeto para /opt/lcr-flow/"
echo "  2. Configure o arquivo .env"
echo "  3. Execute: docker-compose up -d"
echo "  4. Acesse o n8n em: http://SEU_IP:5678"
echo "  5. Execute os scripts de sessão:"
echo "     npm run save-session:gestta"
echo "     npm run save-session:sci"
echo "     npm run save-session:leveldrive"
echo "========================================"
