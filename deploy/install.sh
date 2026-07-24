#!/usr/bin/env bash
set -Eeuo pipefail
ulimit -c 0

APP_NAME="online-exam-platform"
APP_ROOT="/opt/online-exam-platform"
REPO_URL=""
SOURCE_ARCHIVE=""
ARCHIVE_URL=""
BRANCH="main"
SERVER_NAME="_"
PORT="3000"
RUN_SEED="false"
USE_CHINA_MIRROR="false"
NPM_REGISTRY="https://registry.npmjs.org"

usage() {
  cat <<'USAGE'
Usage: bash deploy/install.sh [options]

Options:
  --repo URL          Git repository URL.
  --source-archive    Existing source .tar/.tar.gz path on the server; skips git clone.
  --archive-url URL   Source archive URL used if git clone fails.
  --branch NAME      Git branch or tag to deploy.
  --app-root PATH    Install path. Default: /opt/online-exam-platform
  --server-name NAME Nginx server_name. Default: _
  --port PORT        Backend port. Default: 3000
  --seed             Explicitly run pnpm db:seed after migrations.
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
    --source-archive)
      SOURCE_ARCHIVE="${2:?Missing value for --source-archive}"
      shift 2
      ;;
    --archive-url)
      ARCHIVE_URL="${2:?Missing value for --archive-url}"
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
    --seed)
      RUN_SEED="true"
      shift
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

if [[ -z "$REPO_URL" && -z "$SOURCE_ARCHIVE" && -z "$ARCHIVE_URL" ]]; then
  echo "Please pass --repo https://github.com/<owner>/<repo>.git or --source-archive /path/source.tar.gz" >&2
  exit 1
fi

if [[ -z "$SERVER_NAME" || "$SERVER_NAME" == "_" || "$SERVER_NAME" == "*" || "$SERVER_NAME" == "localhost" ]]; then
  echo "Please pass --server-name with the public domain or IP used by browsers." >&2
  exit 1
fi

log() {
  printf '\n[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"
}

has_command() {
  command -v "$1" >/dev/null 2>&1
}

wait_for_url() {
  local url="$1"
  local attempt
  for attempt in $(seq 1 30); do
    if curl -fsS --max-time 5 "$url" >/dev/null; then
      return 0
    fi
    sleep 2
  done
  return 1
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

install_dependencies() {
  local registry
  local install_ok="false"
  local -a registries=(
    "$NPM_REGISTRY"
    "https://registry.npmmirror.com"
    "https://repo.huaweicloud.com/repository/npm"
    "https://registry.npmjs.org"
  )

  for registry in "${registries[@]}"; do
    log "Installing dependencies from $registry"
    if timeout 420 env \
      PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 \
      npm_config_registry="$registry" \
      pnpm install --frozen-lockfile --prefer-offline --reporter=append-only \
        --child-concurrency=1 --network-concurrency=4 --fetch-retries=2 \
        --fetch-timeout=60000; then
      install_ok="true"
      break
    fi
    log "Registry failed or timed out; switching mirror"
  done

  [[ "$install_ok" == "true" ]]
}

wait_for_apt() {
  if ! has_command apt-get; then
    return
  fi
  local attempt
  for attempt in $(seq 1 90); do
    if has_command fuser; then
      if ! fuser /var/lib/dpkg/lock-frontend /var/lib/dpkg/lock /var/lib/apt/lists/lock /var/cache/apt/archives/lock >/dev/null 2>&1; then
        return
      fi
    elif ! ps -eo comm= | grep -Eq '^(apt|apt-get|dpkg)$'; then
      return
    fi
    log "Waiting for another apt/dpkg process to finish ($attempt/90)"
    sleep 2
  done
  echo "Timed out waiting for apt/dpkg lock." >&2
  return 1
}

install_base_packages() {
  log "Installing base packages"
  if has_command apt-get; then
    wait_for_apt
    apt-get update
    wait_for_apt
    DEBIAN_FRONTEND=noninteractive apt-get install -y ca-certificates curl git gnupg gzip nginx openssl tar
    if ! has_command docker; then
      wait_for_apt
      DEBIAN_FRONTEND=noninteractive apt-get install -y docker.io docker-compose-plugin
    fi
    systemctl enable --now nginx
    systemctl enable --now docker || true
  elif has_command dnf; then
    dnf install -y ca-certificates curl git gzip nginx openssl postgresql tar
    if ! has_command docker; then
      dnf install -y docker docker-compose-plugin
    fi
    systemctl enable --now nginx
    systemctl enable --now docker || true
  elif has_command yum; then
    yum install -y ca-certificates curl git gzip nginx openssl postgresql tar nginx
    if ! has_command docker; then
      yum install -y docker
    fi
    systemctl enable --now nginx
    systemctl enable --now docker || true
  else
    echo "Unsupported Linux distribution: apt-get/dnf/yum not found." >&2
    exit 1
  fi
}

install_node_runtime() {
  if has_command node; then
    local major
    major="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
    if [[ "$major" -ge 22 ]]; then
      log "Node.js $(node -v) is available"
    else
      log "Node.js $(node -v 2>/dev/null || echo unknown) is below required major 22; installing Node.js 22"
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

ensure_postgresql_client() {
  local major="0"
  if has_command pg_dump; then
    major="$(pg_dump --version | sed -E 's/.* ([0-9]+)(\..*)?$/\1/' || printf '0')"
  fi
  if [[ "$major" =~ ^[0-9]+$ ]] && (( major >= 16 )); then
    return
  fi

  if ! has_command apt-get; then
    echo "PostgreSQL client 16 or newer is required for production backups." >&2
    return 1
  fi

  local codename key_url repository
  # shellcheck disable=SC1091
  source /etc/os-release
  codename="${UBUNTU_CODENAME:-${VERSION_CODENAME:-}}"
  [[ -n "$codename" ]]
  install -d -m 755 /usr/share/postgresql-common/pgdg

  for key_url in \
    https://mirrors.aliyun.com/postgresql/repos/apt/ACCC4CF8.asc \
    https://apt.postgresql.org/pub/repos/apt/ACCC4CF8.asc; do
    if curl -fsSL --max-time 30 "$key_url" | gpg --dearmor --yes -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.gpg; then
      break
    fi
  done
  test -s /usr/share/postgresql-common/pgdg/apt.postgresql.org.gpg

  for repository in \
    https://mirrors.aliyun.com/postgresql/repos/apt \
    https://apt.postgresql.org/pub/repos/apt; do
    printf 'deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.gpg] %s %s-pgdg main\n' \
      "$repository" "$codename" >/etc/apt/sources.list.d/pgdg.list
    if apt-get update -o Acquire::Retries=2 && \
      DEBIAN_FRONTEND=noninteractive apt-get install -y postgresql-client-16; then
      return
    fi
    log "PostgreSQL package mirror failed; switching mirror"
  done
  return 1
}

extract_release_archive() {
  local target="$1"
  local archive="$2"
  local temp_dir
  temp_dir="$(mktemp -d)"

  log "Extracting source archive: $archive"
  if [[ "$archive" == *.tar ]]; then
    tar -xf "$archive" -C "$temp_dir"
  else
    tar -xzf "$archive" -C "$temp_dir"
  fi

  rm -rf "$target"
  mkdir -p "$target"
  shopt -s dotglob nullglob
  local entries=("$temp_dir"/*)
  if (( ${#entries[@]} == 1 )) && [[ -d "${entries[0]}" ]]; then
    mv "${entries[0]}"/* "$target"/
  else
    mv "$temp_dir"/* "$target"/
  fi
  shopt -u dotglob nullglob
  rm -rf "$temp_dir"
}

github_archive_url() {
  local repo="$REPO_URL"
  repo="${repo%.git}"
  if [[ "$repo" =~ ^https://github\.com/([^/]+)/([^/]+)$ ]]; then
    printf 'https://codeload.github.com/%s/%s/tar.gz/%s\n' "${BASH_REMATCH[1]}" "${BASH_REMATCH[2]}" "$BRANCH"
  fi
}

download_release_archive() {
  local target="$1"
  local url archive mirror
  local -a urls=()
  if [[ -n "$ARCHIVE_URL" ]]; then
    urls+=("$ARCHIVE_URL")
  fi
  url="$(github_archive_url || true)"
  if [[ -n "$url" ]]; then
    urls+=("$url")
    if [[ -n "${GITHUB_ARCHIVE_MIRRORS:-}" ]]; then
      IFS=',' read -r -a archive_mirrors <<< "$GITHUB_ARCHIVE_MIRRORS"
      for mirror in "${archive_mirrors[@]}"; do
        mirror="${mirror//[[:space:]]/}"
        [[ -n "$mirror" ]] || continue
        urls+=("${mirror}${url}")
      done
    fi
  fi

  (( ${#urls[@]} > 0 )) || return 1

  archive="$(mktemp --suffix=.tar.gz)"
  for url in "${urls[@]}"; do
    log "Downloading source archive from $url"
    if curl -fL --retry 3 --retry-delay 5 --connect-timeout 20 --max-time 420 "$url" -o "$archive"; then
      extract_release_archive "$target" "$archive"
      rm -f "$archive"
      return 0
    fi
    log "Archive download failed or timed out; switching source"
  done
  rm -f "$archive"
  return 1
}

clone_release() {
  local target="$1"
  local attempt

  if [[ -n "$SOURCE_ARCHIVE" ]]; then
    extract_release_archive "$target" "$SOURCE_ARCHIVE"
    return
  fi

  for attempt in 1 2 3; do
    log "Cloning $REPO_URL ($BRANCH), attempt $attempt/3"
    if timeout 420 git \
      -c http.version=HTTP/1.1 \
      -c http.lowSpeedLimit=1024 \
      -c http.lowSpeedTime=60 \
      clone --depth 1 --filter=blob:none --single-branch --branch "$BRANCH" "$REPO_URL" "$target"; then
      return
    fi
    rm -rf "$target"
    sleep $((attempt * 5))
  done

  log "Git clone failed; trying source archive fallback"
  if download_release_archive "$target"; then
    return
  fi

  echo "Failed to clone repository after 3 attempts." >&2
  return 1
}

install_node22() {
  if has_command apt-get; then
    wait_for_apt
    install -d -m 755 /usr/share/keyrings
    curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | \
      gpg --dearmor --yes -o /usr/share/keyrings/nodesource.gpg
    rm -f /etc/apt/sources.list.d/nodesource.list /etc/apt/sources.list.d/nodesource.sources
    printf 'deb [signed-by=/usr/share/keyrings/nodesource.gpg] https://deb.nodesource.com/node_22.x nodistro main\n' \
      >/etc/apt/sources.list.d/nodesource.list
    apt-get update
    wait_for_apt
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

upsert_env() {
  local file="$1" key="$2" value="$3"
  if grep -qE "^${key}=" "$file"; then
    sed -i "s|^${key}=.*|${key}=${value}|" "$file"
  else
    printf '%s=%s\n' "$key" "$value" >>"$file"
  fi
}

create_shared_env() {
  local env_file="$APP_ROOT/shared/.env"
  mkdir -p "$APP_ROOT/shared/uploads"
  if [[ -f "$env_file" ]]; then
    log "Keeping existing production env: $env_file"
    upsert_env "$env_file" CORS_ORIGINS "http://$SERVER_NAME"
    upsert_env "$env_file" TRUST_PROXY "1"
    upsert_env "$env_file" LOG_LEVEL "info"
    upsert_env "$env_file" LOG_PRETTY "false"
    upsert_env "$env_file" JWT_SESSION_EXPIRES_IN "8h"
    upsert_env "$env_file" JWT_REMEMBER_EXPIRES_IN "7d"
    upsert_env "$env_file" JWT_IDLE_EXPIRES_IN "30m"
    upsert_env "$env_file" RATE_LIMIT_TTL_MS "60000"
    upsert_env "$env_file" RATE_LIMIT_MAX "120"
    upsert_env "$env_file" LOGIN_RATE_LIMIT_TTL_MS "600000"
    upsert_env "$env_file" LOGIN_RATE_LIMIT_MAX "5"
    upsert_env "$env_file" REFRESH_RATE_LIMIT_TTL_MS "600000"
    upsert_env "$env_file" REFRESH_RATE_LIMIT_MAX "30"
    upsert_env "$env_file" ASSET_URL_EXPIRES_IN "5m"
    upsert_env "$env_file" UPLOADS_DIR "$APP_ROOT/shared/uploads"
    upsert_env "$env_file" BACKUP_DIR "$APP_ROOT/shared/backups"
    upsert_env "$env_file" BACKUP_DAILY_RETENTION "14"
    upsert_env "$env_file" BACKUP_WEEKLY_RETENTION "8"
    if [[ -x /usr/lib/postgresql/16/bin/pg_dump ]]; then
      upsert_env "$env_file" POSTGRES_BIN_DIR "/usr/lib/postgresql/16/bin"
    fi
    if ! grep -qE '^ASSET_URL_SECRET=.{32,}$' "$env_file"; then
      upsert_env "$env_file" ASSET_URL_SECRET "$(random_secret)"
    fi
    chmod 600 "$env_file"
    return
  fi

  local postgres_password jwt_access jwt_refresh asset_secret hydro_secret
  postgres_password="$(random_secret)"
  jwt_access="$(random_secret)"
  jwt_refresh="$(random_secret)"
  asset_secret="$(random_secret)"
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
JWT_SESSION_EXPIRES_IN=8h
JWT_REMEMBER_EXPIRES_IN=7d
JWT_IDLE_EXPIRES_IN=30m

CORS_ORIGINS=http://$SERVER_NAME
TRUST_PROXY=1
SWAGGER_ENABLED=false
LOG_LEVEL=info
LOG_PRETTY=false

RATE_LIMIT_TTL_MS=60000
RATE_LIMIT_MAX=120
LOGIN_RATE_LIMIT_TTL_MS=600000
LOGIN_RATE_LIMIT_MAX=5
REFRESH_RATE_LIMIT_TTL_MS=600000
REFRESH_RATE_LIMIT_MAX=30

ASSET_URL_SECRET=$asset_secret
ASSET_URL_EXPIRES_IN=5m

UPLOADS_DIR=$APP_ROOT/shared/uploads
BACKUP_DIR=$APP_ROOT/shared/backups
BACKUP_DAILY_RETENTION=14
BACKUP_WEEKLY_RETENTION=8
# BACKUP_REMOTE=s3:online-exam-backups

HYDRO_BASE_URL=https://oj.example.com
HYDRO_DEFAULT_LANGUAGES=cc.cc17o2,py.py3
HYDRO_CALLBACK_SECRET=$hydro_secret

POSTGRES_USER=online_exam
POSTGRES_PASSWORD=$postgres_password
POSTGRES_DB=online_exam
ENV
  if [[ -x /usr/lib/postgresql/16/bin/pg_dump ]]; then
    upsert_env "$env_file" POSTGRES_BIN_DIR "/usr/lib/postgresql/16/bin"
  fi
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

  mkdir -p "$APP_ROOT/releases"
  clone_release "$release"

  cp "$env_file" "$release/.env"
  ln -sfn "$APP_ROOT/shared/uploads" "$release/uploads"
  if [[ -d "$APP_ROOT/current/node_modules" ]]; then
    cp -al "$APP_ROOT/current/node_modules" "$release/node_modules"
  fi

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
    install_dependencies
    NODE_OPTIONS=--max-old-space-size=512 pnpm prisma generate
    NODE_OPTIONS=--max-old-space-size=1280 pnpm build:all
    if [[ -e "$APP_ROOT/current" ]]; then
      log "Creating a pre-migration backup"
      pnpm backup:create
    fi
    pnpm prisma migrate deploy
    pnpm permissions:sync
    pnpm assets:migrate
    if [[ "$RUN_SEED" == "true" ]]; then
      pnpm db:seed
    fi
  )

  ln -sfn "$release" "$APP_ROOT/current"
  configure_pm2
  configure_nginx
  configure_backup_timer

  log "Restarting application"
  restart_application
  systemctl reload nginx

  log "Deployment finished: $release"
}

restart_application() {
  local expected_cwd current_real pm2_cwd pm2_cwd_real
  expected_cwd="$APP_ROOT/current"
  current_real="$(readlink -f "$expected_cwd")"

  pm2 startOrReload "$APP_ROOT/shared/ecosystem.config.cjs" --update-env || true

  pm2_cwd="$(
    pm2 jlist | node -e "
let input = '';
process.stdin.on('data', (chunk) => input += chunk);
process.stdin.on('end', () => {
  const app = JSON.parse(input).find((item) => item.name === '$APP_NAME');
  process.stdout.write(app?.pm2_env?.pm_cwd || '');
});
" 2>/dev/null || true
  )"
  pm2_cwd_real="$(readlink -f "$pm2_cwd" 2>/dev/null || printf '%s' "$pm2_cwd")"

  if [[ "$pm2_cwd" != "$expected_cwd" && "$pm2_cwd_real" != "$current_real" ]]; then
    log "PM2 still points to an old release; recreating application process"
    pm2 delete "$APP_NAME" >/dev/null 2>&1 || true
    (
      cd "$APP_ROOT/current"
      pm2 start dist/main.js --name "$APP_NAME" --update-env
    )
  fi

  pm2 save
  pm2 startup systemd -u root --hp /root >/dev/null 2>&1 || true
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
    proxy_set_header X-Request-ID \$http_x_request_id;
  }

  location /uploads/ {
    return 404;
  }

  location / {
    try_files \$uri \$uri/ /index.html;
  }
}
NGINX
  rm -f /etc/nginx/sites-enabled/default 2>/dev/null || true
  nginx -t
}

configure_backup_timer() {
  local pnpm_path
  pnpm_path="$(command -v pnpm)"
  mkdir -p "$APP_ROOT/shared/backups" "$APP_ROOT/shared/restore-reports"
  chmod 700 "$APP_ROOT/shared/backups" "$APP_ROOT/shared/restore-reports"

  cat >"/etc/systemd/system/$APP_NAME-backup.service" <<SERVICE
[Unit]
Description=Online exam PostgreSQL and uploads backup
After=docker.service network-online.target

[Service]
Type=oneshot
WorkingDirectory=$APP_ROOT/current
EnvironmentFile=$APP_ROOT/shared/.env
UMask=0077
ExecStart=$pnpm_path backup:create
SERVICE

  cat >"/etc/systemd/system/$APP_NAME-backup.timer" <<TIMER
[Unit]
Description=Run online exam backup daily at 02:30 Asia/Shanghai

[Timer]
OnCalendar=*-*-* 02:30:00 Asia/Shanghai
Persistent=true
RandomizedDelaySec=120

[Install]
WantedBy=timers.target
TIMER

  systemctl daemon-reload
  systemctl enable --now "$APP_NAME-backup.timer"
}

smoke_test() {
  log "Running smoke tests"
  wait_for_url "http://127.0.0.1:$PORT/api/v1/health"
  wait_for_url "http://127.0.0.1/"
  pm2 status "$APP_NAME"
}

install_base_packages
ensure_postgresql_client
install_node_runtime
create_shared_env
deploy_release
smoke_test

log "One-click install completed."
