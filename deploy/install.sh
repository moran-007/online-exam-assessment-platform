#!/usr/bin/env bash
set -Eeuo pipefail

APP_NAME="online-exam-platform"
APP_ROOT="/opt/online-exam-platform"
REPO_URL="https://github.com/<owner>/<repo>.git"
BRANCH="main"
SERVER_NAME="_"
PORT="3000"
RUN_SEED="true"
USE_CHINA_MIRROR="false"
NPM_REGISTRY="https://registry.npmjs.org"

usage() {
  cat <<'USAGE'
Usage: bash deploy/install.sh [options]

Options:
  --repo URL          Git repository URL.
  --branch NAME      Git branch or tag to deploy.
  --app-root PATH    Install path. Default: /opt/online-exam-platform
  --server-name NAME Nginx server_name. Default: _
  --port PORT        Backend port. Default: 3000
  --skip-seed        Do not run pnpm db:seed.
  --china-mirror     Use registry.npmmirror.com for npm/pnpm/corepack.
  -h, --help         Show help.
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --repo)
      REPO_URL="${2:?Missing value for --repo}"
      shift 2
      ;;
    --branch)
      BRANCH="${2:?Missing value for --branch}"
      shift 2
      ;;
    --app-root)
      APP_ROOT="${2:?Missing value for --app-root}"
      shift 2
      ;;
    --server-name)
      SERVER_NAME="${2:?Missing value for --server-name}"
      shift 2
      ;;
    --port)
      PORT="${2:?Missing value for --port}"
      shift 2
      ;;
    --skip-seed)
      RUN_SEED="false"
      shift
      ;;
    --china-mirror)
      USE_CHINA_MIRROR="true"
      NPM_REGISTRY="https://registry.npmmirror.com"
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

if [[ "$(id -u)" != "0" ]]; then
  echo "Please run as root." >&2
  exit 1
fi

log() {
  printf '\n[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"
}

has_command() {
  command -v "$1" >/dev/null 2>&1
}

configure_package_mirror() {
  export PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
  export npm_config_registry="$NPM_REGISTRY"
  export COREPACK_NPM_REGISTRY="$NPM_REGISTRY"

  if has_command npm; then
    npm config set registry "$NPM_REGISTRY" >/dev/null 2>&1 || true
  fi
  if has_command pnpm; then
    pnpm config set registry "$NPM_REGISTRY" >/dev/null 2>&1 || true
  fi
  if [[ "$USE_CHINA_MIRROR" == "true" ]]; then
    log "Using China package mirror: $NPM_REGISTRY"
  fi
}

install_base_packages() {
  log "Installing base packages"
  if has_command apt-get; then
    apt-get update
    DEBIAN_FRONTEND=noninteractive apt-get install -y ca-certificates curl git gzip nginx openssl tar docker.io docker-compose-plugin
    systemctl enable --now docker nginx
  elif has_command dnf; then
    dnf install -y ca-certificates curl git gzip nginx openssl tar docker docker-compose-plugin
    systemctl enable --now docker nginx
  elif has_command yum; then
    yum install -y ca-certificates curl git gzip nginx openssl tar docker nginx
    systemctl enable --now docker nginx
  else
    echo "Unsupported Linux distribution: apt-get/dnf/yum not found." >&2
    exit 1
  fi
}

install_node_runtime() {
  if has_command node; then
    local major
    major="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
    if [[ "$major" -ge 20 ]]; then
      log "Node.js $(node -v) is available"
    else
      log "Node.js is too old; installing Node.js 22"
      install_node22
    fi
  else
    log "Installing Node.js 22"
    install_node22
  fi

  if has_command corepack; then
    corepack enable
    COREPACK_NPM_REGISTRY="$NPM_REGISTRY" corepack prepare pnpm@latest --activate
  fi
  if ! has_command pnpm; then
    npm install -g pnpm --registry="$NPM_REGISTRY"
  fi
  if ! has_command pm2; then
    npm install -g pm2 --registry="$NPM_REGISTRY"
  fi
  configure_package_mirror
}

install_node22() {
  if has_command apt-get; then
    curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
    DEBIAN_FRONTEND=noninteractive apt-get install -y nodejs
  elif has_command dnf; then
    dnf module reset -y nodejs || true
    dnf module enable -y nodejs:22 || dnf module enable -y nodejs:20 || true
    dnf install -y nodejs npm
  elif has_command yum; then
    curl -fsSL https://rpm.nodesource.com/setup_22.x | bash -
    yum install -y nodejs
  fi
}

docker_compose() {
  if docker compose version >/dev/null 2>&1; then
    docker compose "$@"
  elif has_command docker-compose; then
    docker-compose "$@"
  else
    echo "Docker Compose is not installed." >&2
    exit 1
  fi
}

random_secret() {
  openssl rand -base64 48 | tr -dc 'A-Za-z0-9' | head -c 48
}

create_shared_env() {
  local env_file="$APP_ROOT/shared/.env"
  mkdir -p "$APP_ROOT/shared/uploads"
  if [[ -f "$env_file" ]]; then
    log "Keeping existing production env: $env_file"
    return
  fi

  local postgres_password jwt_access jwt_refresh hydro_secret
  postgres_password="$(random_secret)"
  jwt_access="$(random_secret)"
  jwt_refresh="$(random_secret)"
  hydro_secret="$(random_secret)"

  log "Creating production env: $env_file"
  cat >"$env_file" <<ENV
NODE_ENV=production
PORT=$PORT
APP_NAME=online-exam-assessment-platform
DATABASE_URL=postgresql://online_exam:$postgres_password@127.0.0.1:5432/online_exam?schema=public

JWT_ACCESS_SECRET=$jwt_access
JWT_REFRESH_SECRET=$jwt_refresh
JWT_ACCESS_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN=7d

CORS_ORIGINS=http://$SERVER_NAME,http://localhost:$PORT
SWAGGER_ENABLED=false

HYDRO_BASE_URL=https://oj.example.com
HYDRO_DEFAULT_LANGUAGES=cc.cc17o2,py.py3
HYDRO_CALLBACK_SECRET=$hydro_secret

POSTGRES_USER=online_exam
POSTGRES_PASSWORD=$postgres_password
POSTGRES_DB=online_exam
ENV
  chmod 600 "$env_file"
}

load_env_value() {
  local key="$1"
  local file="$2"
  grep -E "^${key}=" "$file" | tail -n 1 | cut -d= -f2-
}

deploy_release() {
  local stamp release env_file
  stamp="$(date +%Y%m%d-%H%M%S)"
  release="$APP_ROOT/releases/$stamp"
  env_file="$APP_ROOT/shared/.env"

  log "Cloning $REPO_URL ($BRANCH)"
  mkdir -p "$APP_ROOT/releases"
  git clone --depth 1 --branch "$BRANCH" "$REPO_URL" "$release"

  cp "$env_file" "$release/.env"
  ln -sfn "$APP_ROOT/shared/uploads" "$release/uploads"

  local pg_user pg_password pg_db
  pg_user="$(load_env_value POSTGRES_USER "$env_file")"
  pg_password="$(load_env_value POSTGRES_PASSWORD "$env_file")"
  pg_db="$(load_env_value POSTGRES_DB "$env_file")"

  log "Starting PostgreSQL"
  (
    cd "$release"
    POSTGRES_USER="$pg_user" POSTGRES_PASSWORD="$pg_password" POSTGRES_DB="$pg_db" \
      docker_compose -f deploy/docker-compose.prod.yml up -d postgres
  )

  log "Installing dependencies and building"
  (
    cd "$release"
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 pnpm install --frozen-lockfile --registry="$NPM_REGISTRY"
    pnpm build:all
    pnpm prisma generate
    pnpm prisma migrate deploy
    if [[ "$RUN_SEED" == "true" ]]; then
      pnpm db:seed
    fi
  )

  ln -sfn "$release" "$APP_ROOT/current"
  configure_pm2
  configure_nginx

  log "Restarting application"
  pm2 startOrReload "$APP_ROOT/shared/ecosystem.config.cjs" --update-env
  pm2 save
  pm2 startup systemd -u root --hp /root >/dev/null 2>&1 || true
  systemctl reload nginx

  log "Deployment finished: $release"
}

configure_pm2() {
  mkdir -p "$APP_ROOT/shared"
  cat >"$APP_ROOT/shared/ecosystem.config.cjs" <<PM2
module.exports = {
  apps: [
    {
      name: '$APP_NAME',
      cwd: '$APP_ROOT/current',
      script: '$APP_ROOT/current/dist/main.js',
      env: {
        NODE_ENV: 'production'
      }
    }
  ]
};
PM2
}

configure_nginx() {
  local nginx_conf="/etc/nginx/conf.d/$APP_NAME.conf"
  mkdir -p /etc/nginx/conf.d
  cat >"$nginx_conf" <<NGINX
server {
  listen 80;
  server_name $SERVER_NAME;
  client_max_body_size 50m;

  root $APP_ROOT/current/frontend/dist;
  index index.html;

  location /api/ {
    proxy_pass http://127.0.0.1:$PORT;
    proxy_http_version 1.1;
    proxy_set_header Host \$host;
    proxy_set_header X-Real-IP \$remote_addr;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto \$scheme;
  }

  location /uploads/ {
    proxy_pass http://127.0.0.1:$PORT;
    proxy_set_header Host \$host;
    proxy_set_header X-Real-IP \$remote_addr;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
  }

  location / {
    try_files \$uri \$uri/ /index.html;
  }
}
NGINX
  rm -f /etc/nginx/sites-enabled/default 2>/dev/null || true
  nginx -t
}

smoke_test() {
  log "Running smoke tests"
  curl -fsS "http://127.0.0.1:$PORT/api/v1/health" >/dev/null
  curl -fsS "http://127.0.0.1/" >/dev/null
  pm2 status "$APP_NAME"
}

install_base_packages
install_node_runtime
create_shared_env
deploy_release
smoke_test

log "One-click install completed."
