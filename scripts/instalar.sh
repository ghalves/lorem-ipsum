#!/usr/bin/env bash
# Instala ou atualiza o Miaou no servidor (Ubuntu + WordOps, nginx como proxy).
#
# Uso, depois de copiar o projeto para /var/www/<dominio>/htdocs:
#   sudo ./scripts/instalar.sh
#
# Pode rodar quantas vezes quiser: na primeira cria o .env, a pasta de dados e o
# serviço; nas seguintes só reinstala as dependências e reinicia.
#
# Onde fica cada coisa:
#   /var/www/<dominio>/htdocs      código (substituído a cada atualização)
#   /var/www/<dominio>/miaou.env   configuração (htdocs/.env aponta para ele)
#   /var/www/<dominio>/data        banco, fotos e provas (nunca tocado pelo rsync)
#   /var/www/<dominio>/backup      cópia diária do banco (14 dias)
#
# Variáveis opcionais: PORT (3009), SERVICE (miaou), APP_USER (www-data), DOMAIN.
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SITE_DIR="$(dirname "$APP_DIR")"
DOMAIN="${DOMAIN:-$(basename "$SITE_DIR")}"
PORT="${PORT:-3009}"
SERVICE="${SERVICE:-miaou}"
APP_USER="${APP_USER:-www-data}"
DATA_DIR="$SITE_DIR/data"
BACKUP_DIR="$SITE_DIR/backup"
ENV_FILE="$SITE_DIR/miaou.env"
NODE_DIR=/opt/miaou-node

ok()   { printf '\033[32m✔\033[0m %s\n' "$*"; }
info() { printf '\033[36m→\033[0m %s\n' "$*"; }
warn() { printf '\033[33m!\033[0m %s\n' "$*"; }
fail() { printf '\033[31m✘ %s\033[0m\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || fail "Rode com sudo: sudo ./scripts/instalar.sh"
[ -f "$APP_DIR/package.json" ] || fail "package.json não encontrado em $APP_DIR"
id "$APP_USER" >/dev/null 2>&1 || fail "Usuário $APP_USER não existe"
info "Instalando $DOMAIN em $APP_DIR (porta $PORT, serviço $SERVICE)"

# ---------- Node ----------
# node:sqlite funciona sem flag a partir do Node 22.13. Se o Node do sistema for
# mais velho, baixamos um Node 22 só para o Miaou (em /opt), sem mexer nos outros
# projetos do servidor.
node_ok() { "$1" -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>22||(a===22&&b>=13)?0:1)' 2>/dev/null; }

NODE_BIN=""
if command -v node >/dev/null 2>&1 && node_ok "$(command -v node)"; then
  NODE_BIN="$(command -v node)"
elif [ -x "$NODE_DIR/bin/node" ] && node_ok "$NODE_DIR/bin/node"; then
  NODE_BIN="$NODE_DIR/bin/node"
else
  case "$(uname -m)" in
    x86_64) ARCH=x64 ;;
    aarch64|arm64) ARCH=arm64 ;;
    *) fail "Arquitetura $(uname -m) não suportada" ;;
  esac
  info "Baixando Node 22 para $NODE_DIR (o Node do sistema não é alterado)"
  BASE=https://nodejs.org/dist/latest-v22.x
  TMP="$(mktemp -d)"
  curl -fsSL "$BASE/SHASUMS256.txt" -o "$TMP/SHASUMS256.txt"
  TARBALL="$(grep -oE "node-v22\.[0-9]+\.[0-9]+-linux-$ARCH\.tar\.xz" "$TMP/SHASUMS256.txt" | head -1)"
  [ -n "$TARBALL" ] || fail "Não achei o pacote do Node 22 para $ARCH"
  curl -fsSL "$BASE/$TARBALL" -o "$TMP/$TARBALL"
  (cd "$TMP" && grep " $TARBALL\$" SHASUMS256.txt | sha256sum -c --quiet) || fail "Checksum do Node não confere"
  rm -rf "$NODE_DIR" && mkdir -p "$NODE_DIR"
  tar -xJf "$TMP/$TARBALL" -C "$NODE_DIR" --strip-components=1
  rm -rf "$TMP"
  NODE_BIN="$NODE_DIR/bin/node"
fi
export PATH="$(dirname "$NODE_BIN"):$PATH"
ok "Node $("$NODE_BIN" -v) ($NODE_BIN)"

# ---------- Pastas ----------
mkdir -p "$DATA_DIR/tryon" "$BACKUP_DIR"
chown -R "$APP_USER:$APP_USER" "$DATA_DIR" "$BACKUP_DIR"
chmod 750 "$DATA_DIR" "$BACKUP_DIR"
# versões antigas guardavam os dados dentro do htdocs
if [ -f "$APP_DIR/data/provador.db" ] && [ ! -f "$DATA_DIR/provador.db" ]; then
  info "Movendo dados de $APP_DIR/data para $DATA_DIR"
  cp -a "$APP_DIR/data/." "$DATA_DIR/" && chown -R "$APP_USER:$APP_USER" "$DATA_DIR"
fi
ok "Dados em $DATA_DIR"

# ---------- .env ----------
set_env() { # set_env CHAVE VALOR: troca a linha ou acrescenta no fim
  if grep -qE "^$1=" "$ENV_FILE"; then
    sed -i "s|^$1=.*|$1=$2|" "$ENV_FILE"
  else
    printf '%s=%s\n' "$1" "$2" >> "$ENV_FILE"
  fi
}
get_env() { { grep -E "^$1=" "$ENV_FILE" 2>/dev/null || true; } | tail -1 | cut -d= -f2- | sed -E "s/^[\"']|[\"']$//g"; }

# um .env que veio junto com o código vira o arquivo de configuração (só na 1ª vez)
if [ -f "$APP_DIR/.env" ] && [ ! -L "$APP_DIR/.env" ]; then
  if [ ! -f "$ENV_FILE" ]; then
    mv "$APP_DIR/.env" "$ENV_FILE"
    info "Usando o .env enviado junto com o código"
  else
    warn "Ignorando o .env enviado junto com o código (vale $ENV_FILE)"
    rm -f "$APP_DIR/.env"
  fi
fi

if [ ! -f "$ENV_FILE" ]; then
  cp "$APP_DIR/.env.example" "$ENV_FILE"
  set_env APP_URL "https://$DOMAIN"
  set_env PORT "$PORT"
  set_env DATABASE_PATH "$DATA_DIR/provador.db"
  set_env TRYON_STORAGE_DIR "$DATA_DIR/tryon"
  set_env DEV_MODE false
  set_env SESSION_SECRET "$("$NODE_BIN" -e 'console.log(require("crypto").randomBytes(32).toString("hex"))')"
  ok "Criado $ENV_FILE (SESSION_SECRET gerado)"
fi
# variáveis novas das versões seguintes entram vazias no fim do arquivo
ADDED=()
while IFS= read -r line; do
  key="${line%%=*}"
  if [[ "$line" =~ ^[A-Z0-9_]+= ]] && ! grep -qE "^$key=" "$ENV_FILE"; then
    printf '%s=\n' "$key" >> "$ENV_FILE"; ADDED+=("$key")
  fi
done < "$APP_DIR/.env.example"
[ ${#ADDED[@]} -gt 0 ] && info "Variáveis novas no $ENV_FILE: ${ADDED[*]}"
chown "root:$APP_USER" "$ENV_FILE"
chmod 640 "$ENV_FILE"
ln -sfn "$ENV_FILE" "$APP_DIR/.env"

PORT="$(get_env PORT)"; PORT="${PORT:-3009}"
MISSING=()
[ -n "$(get_env NUVEMSHOP_APP_ID)" ] || MISSING+=(NUVEMSHOP_APP_ID)
[ -n "$(get_env NUVEMSHOP_CLIENT_SECRET)" ] || MISSING+=(NUVEMSHOP_CLIENT_SECRET)
EMAIL="$(get_env NUVEMSHOP_CONTACT_EMAIL)"
{ [ -n "$EMAIL" ] && [ "$EMAIL" != "voce@suaempresa.com.br" ]; } || MISSING+=(NUVEMSHOP_CONTACT_EMAIL)
[ -n "$(get_env SESSION_SECRET)" ] || MISSING+=(SESSION_SECRET)
[ "$(get_env DEV_MODE)" = "true" ] && warn "DEV_MODE=true no .env: a loja de demonstração fica aberta. Use false em produção."
[ -n "$(get_env OPENROUTER_API_KEY)" ] || warn "OPENROUTER_API_KEY vazio: as provas serão SIMULADAS (devolvem a própria foto)."
[ -n "$(get_env NUVEMSHOP_SCRIPT_ID)" ] || warn "NUVEMSHOP_SCRIPT_ID vazio: o botão não entra nas lojas até você cadastrar o script."

# ---------- Dependências ----------
info "Instalando dependências (npm ci)"
(cd "$APP_DIR" && npm ci --omit=dev --no-audit --no-fund --no-update-notifier --loglevel=error)
ok "Dependências instaladas"

# ---------- Script da vitrine ----------
(cd "$APP_DIR" && "$NODE_BIN" --no-warnings scripts/build-loader.js >/dev/null) \
  && ok "Script da vitrine (NubeSDK) gerado em $APP_DIR/dist/miaou-nube.js" \
  || warn "Não consegui gerar dist/miaou-nube.js"

# ---------- Comando "miaou" ----------
cat > /usr/local/bin/miaou <<EOF
#!/usr/bin/env bash
# Atalhos do Miaou (gerado por scripts/instalar.sh). Use com sudo.
cd "$APP_DIR"
case "\${1:-}" in
  plano)     shift; exec sudo -u "$APP_USER" "$NODE_BIN" --no-warnings scripts/set-plan.js "\$@" ;;
  qualidade) shift; exec sudo -u "$APP_USER" "$NODE_BIN" --no-warnings scripts/quality.js "\$@" ;;
  logs)      exec journalctl -u "$SERVICE" -f -n 100 ;;
  status)    exec systemctl status "$SERVICE" --no-pager ;;
  reiniciar) exec systemctl restart "$SERVICE" ;;
  backup)    exec sudo -u "$APP_USER" "$NODE_BIN" --no-warnings scripts/backup.js "$BACKUP_DIR" ;;
  *)
    echo "Uso: sudo miaou <comando>"
    echo "  plano <id da loja> [plano]   mostra ou troca o plano (essencial, crescer, escalar, volume-2500..., none)"
    echo "  qualidade [id da loja] [dias] realismo das provas (joinha do comprador)"
    echo "  logs                         acompanha o log"
    echo "  status | reiniciar           estado do serviço / reinicia"
    echo "  backup                       copia o banco para $BACKUP_DIR (14 dias)"
    exit 1 ;;
esac
EOF
chmod 755 /usr/local/bin/miaou
echo "17 4 * * * root /usr/local/bin/miaou backup >/dev/null 2>&1" > /etc/cron.d/miaou
ok "Comando 'sudo miaou' instalado (backup diário às 4h17)"

# ---------- Serviço ----------
cat > "/etc/systemd/system/$SERVICE.service" <<EOF
[Unit]
Description=Miaou - provador virtual Nuvemshop ($DOMAIN)
After=network.target

[Service]
Type=simple
User=$APP_USER
WorkingDirectory=$APP_DIR
Environment=NODE_ENV=production
ExecStart=$NODE_BIN --no-warnings src/server.js
Restart=always
RestartSec=3
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ReadWritePaths=$DATA_DIR

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable "$SERVICE" >/dev/null 2>&1

if [ ${#MISSING[@]} -gt 0 ]; then
  systemctl stop "$SERVICE" 2>/dev/null || true
  echo
  warn "Falta preencher no $ENV_FILE: ${MISSING[*]}"
  echo "  sudo vim $ENV_FILE"
  echo "  depois rode de novo: sudo ./scripts/instalar.sh"
  exit 0
fi

# a porta não pode estar ocupada por outro programa
OWNER_PID="$(ss -ltnpH "sport = :$PORT" 2>/dev/null | grep -oE 'pid=[0-9]+' | head -1 | cut -d= -f2 || true)"
if [ -n "$OWNER_PID" ] && [ "$OWNER_PID" != "$(systemctl show -p MainPID --value "$SERVICE")" ]; then
  fail "A porta $PORT já está em uso por outro programa (pid $OWNER_PID: $(ps -o comm= -p "$OWNER_PID"))"
fi

systemctl restart "$SERVICE"
info "Aguardando o servidor responder em 127.0.0.1:$PORT"
for _ in $(seq 1 20); do
  curl -fsS "http://127.0.0.1:$PORT/health" >/dev/null 2>&1 && break
  sleep 1
done
if ! curl -fsS "http://127.0.0.1:$PORT/health" >/dev/null 2>&1; then
  journalctl -u "$SERVICE" -n 40 --no-pager
  fail "O Miaou não respondeu. Veja o log acima."
fi
ok "Miaou rodando (serviço $SERVICE)"

# ---------- nginx ----------
if command -v nginx >/dev/null 2>&1; then
  NGINX_CONF="$(nginx -T 2>/dev/null || true)"
  if ! grep -q "127.0.0.1:$PORT" <<<"$NGINX_CONF"; then
    warn "O nginx não aponta para a porta $PORT. Crie o site com:"
    echo "  sudo wo site create $DOMAIN --proxy=127.0.0.1:$PORT --le"
  elif ! grep -qi "X-Forwarded-For" <<<"$NGINX_CONF"; then
    warn "O nginx não repassa X-Forwarded-For: todos os compradores vão parecer o mesmo IP"
    IP_LIMIT="$(get_env TRYON_IP_DAILY_LIMIT)"
    warn "e o limite de ${IP_LIMIT:-20} provas por IP por dia trava a loja. Adicione no location /:"
    echo '  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;'
  fi
fi
if curl -fsS --max-time 10 "https://$DOMAIN/health" >/dev/null 2>&1; then
  ok "https://$DOMAIN respondendo"
else
  warn "https://$DOMAIN ainda não responde (DNS, certificado ou nginx)"
fi

echo
ok "Pronto. Dashboard: https://$DOMAIN/dashboard/  ·  Log: sudo miaou logs"
