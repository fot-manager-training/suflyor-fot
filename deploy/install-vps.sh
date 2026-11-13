#!/usr/bin/env bash
set +x
set -Eeuo pipefail

SUF_ROOT=/opt/suflyor
SUF_SOURCE=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
SUF_MODE=install
SUF_HOST=''
SUF_EMAIL=''
SUF_BUILD_DIR=''
SUF_DOWNLOAD_DIR=''

fail() { printf 'Ошибка: %s\n' "$*" >&2; exit 1; }
help() {
  cat <<'TXT'
Суфлёр: установка на Ubuntu 22.04+ / Debian 12+.
  bash deploy/install-vps.sh --host PUBLIC_IP_OR_DOMAIN [--email EMAIL]
  bash deploy/install-vps.sh --update
  bash deploy/install-vps.sh --rollback
Ключ DeepSeek и пароль приложения запрашиваются скрыто, а не передаются аргументами.
Нужны открытые TCP-порты 80 и 443. SSH обычно использует порт 22.
TXT
}
while (( $# )); do
  case "$1" in
    --host) (( $# >= 2 )) || fail '--host требует адрес'; SUF_HOST=${2,,}; shift 2 ;;
    --email) (( $# >= 2 )) || fail '--email требует почту'; SUF_EMAIL=$2; shift 2 ;;
    --update) SUF_MODE=update; shift ;;
    --rollback) SUF_MODE=rollback; shift ;;
    --help|-h) help; exit 0 ;;
    *) fail "Неизвестный аргумент: $1" ;;
  esac
done
(( EUID == 0 )) || fail 'Запустите установщик от root или через sudo.'
[[ -r /etc/os-release ]] || fail 'Не удалось определить ОС.'
# shellcheck disable=SC1091
. /etc/os-release
case "${ID:-}:${VERSION_ID:-}" in
  ubuntu:*) [[ ${VERSION_ID%%.*} -ge 22 ]] || fail 'Нужна Ubuntu 22.04 или новее.' ;;
  debian:*) [[ ${VERSION_ID%%.*} -ge 12 ]] || fail 'Нужна Debian 12 или новее.' ;;
  *) fail 'Этот установщик предназначен для Ubuntu/Debian.' ;;
esac
[[ -d /run/systemd/system ]] || fail 'Нужен сервер с systemd.'
[[ "$SUF_SOURCE" == /opt/suflyor/source ]] || fail 'Клонируйте репозиторий в /opt/suflyor/source.'
cleanup() {
  [[ -z "$SUF_BUILD_DIR" ]] || rm -rf -- "$SUF_BUILD_DIR"
  [[ -z "$SUF_DOWNLOAD_DIR" ]] || rm -rf -- "$SUF_DOWNLOAD_DIR"
}
trap cleanup EXIT
trap 'printf "Установка остановлена, строка %s. Подробности выше.\n" "$LINENO" >&2' ERR

health() {
  local attempt
  for attempt in {1..30}; do
    if curl --max-time 2 -fsS http://127.0.0.1:3000/healthz >/dev/null 2>&1; then return 0; fi
    sleep 1
  done
  return 1
}
activate() {
  local target=$1 previous=''
  previous=$(readlink -f "$SUF_ROOT/current" 2>/dev/null || true)
  if [[ -n "$previous" && "$previous" != "$target" ]]; then ln -sfn "$previous" "$SUF_ROOT/previous"; fi
  ln -sfn "$target" "$SUF_ROOT/current.next"
  mv -Tf "$SUF_ROOT/current.next" "$SUF_ROOT/current"
  systemctl restart suflyor
  if ! health; then
    if [[ -n "$previous" && "$previous" != "$target" ]]; then
      ln -sfn "$previous" "$SUF_ROOT/current.next"; mv -Tf "$SUF_ROOT/current.next" "$SUF_ROOT/current"
      systemctl restart suflyor || true
    fi
    fail 'Новая версия не прошла проверку /healthz. Предыдущая восстановлена, если была. Логи: journalctl -u suflyor -n 80.'
  fi
}
build_release() {
  printf 'Собираю приложение от отдельного пользователя...\n'
  SUF_BUILD_DIR=$(mktemp -d /var/tmp/suflyor-build.XXXXXX)
  tar -C "$SUF_SOURCE" --exclude=.git --exclude=node_modules --exclude=dist --exclude='.env*' -cf - . | tar -C "$SUF_BUILD_DIR" -xf -
  chown -R suflyor:suflyor "$SUF_BUILD_DIR"
  runuser -u suflyor -- env PATH="/opt/suflyor-node/bin:/usr/local/bin:/usr/bin:/bin" NPM_CONFIG_CACHE=/var/cache/suflyor/npm npm --prefix "$SUF_BUILD_DIR" ci --omit=dev --no-audit --no-fund
  (cd "$SUF_BUILD_DIR" && runuser -u suflyor -- env PATH="/opt/suflyor-node/bin:/usr/local/bin:/usr/bin:/bin" NPM_CONFIG_CACHE=/var/cache/suflyor/npm npm run build)
  SUF_NEW_RELEASE=$(mktemp -d "$SUF_ROOT/releases/release-$(date -u +%Y%m%d-%H%M%S)-XXXXXX")
  cp -a "$SUF_BUILD_DIR/dist" "$SUF_BUILD_DIR/server" "$SUF_BUILD_DIR/package.json" "$SUF_NEW_RELEASE/"
  chown -R root:root "$SUF_NEW_RELEASE"
  chmod -R u=rwX,go=rX "$SUF_NEW_RELEASE"
  git -C "$SUF_SOURCE" rev-parse HEAD > "$SUF_NEW_RELEASE/SOURCE_COMMIT"
}
if [[ "$SUF_MODE" == rollback ]]; then
  [[ -L "$SUF_ROOT/previous" ]] || fail 'Нет предыдущего выпуска для отката.'
  activate "$(readlink -f "$SUF_ROOT/previous")"
  printf 'Предыдущий выпуск восстановлен.\n'; exit 0
fi
if [[ "$SUF_MODE" == update ]]; then
  [[ -f /etc/suflyor/installed && -f /etc/suflyor/environment ]] || fail 'Сначала выполните установку.'
  build_release; activate "$SUF_NEW_RELEASE"
  printf 'Обновлено. Проверка /healthz пройдена.\n'; exit 0
fi
[[ ! -f /etc/suflyor/installed ]] || fail 'Приложение уже установлено. Для обновления используйте --update.'
[[ -n "$SUF_HOST" ]] || read -rp 'Публичный IPv4 или домен: ' SUF_HOST
SUF_HOST=${SUF_HOST,,}
[[ -n "$SUF_EMAIL" ]] || read -rp 'Email для регистрации HTTPS-сертификата: ' SUF_EMAIL
[[ "$SUF_EMAIL" == *@*.* && "$SUF_EMAIL" != *$'\n'* ]] || fail 'Укажите корректный email.'

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y ca-certificates curl git xz-utils python3 python3-venv iproute2
SUF_KIND=$(python3 "$SUF_SOURCE/deploy/render-vps.py" kind --host "$SUF_HOST")
while IFS= read -r SUF_PORT_LINE; do
  [[ -z "$SUF_PORT_LINE" || "$SUF_PORT_LINE" == *'"nginx"'* ]] || fail 'Порт 80/443 занят другим веб-сервером. Сначала согласуйте его конфигурацию.'
done < <(ss -H -ltnp '( sport = :80 or sport = :443 )')
if [[ ! -L "$SUF_ROOT/current" ]] && [[ -n $(ss -H -ltn '( sport = :3000 )') ]]; then fail 'Порт 3000 уже занят другим приложением.'; fi
apt-get install -y nginx
if [[ ! -f /etc/nginx/sites-available/suflyor.conf ]]; then
  nginx -T 2>/dev/null | python3 "$SUF_SOURCE/deploy/render-vps.py" check-host-unused --host "$SUF_HOST"
fi
id suflyor >/dev/null 2>&1 || useradd --system --user-group --create-home --home-dir /var/lib/suflyor --shell /usr/sbin/nologin suflyor
install -d -m 0755 "$SUF_ROOT/releases" /var/www/suflyor-acme
install -d -m 0700 /etc/suflyor
install -d -o suflyor -g suflyor -m 0700 /var/cache/suflyor/npm
if [[ ! -x /opt/suflyor-node/bin/node ]] || [[ $(/opt/suflyor-node/bin/node --version) != v24.* ]]; then
  case $(uname -m) in x86_64) SUF_ARCH=x64 ;; aarch64|arm64) SUF_ARCH=arm64 ;; *) fail 'Поддерживаются x86_64 и ARM64.' ;; esac
  SUF_DOWNLOAD_DIR=$(mktemp -d /var/tmp/suflyor-node.XXXXXX)
  curl --retry 3 --connect-timeout 15 -fsSL https://nodejs.org/dist/latest-v24.x/SHASUMS256.txt -o "$SUF_DOWNLOAD_DIR/SHASUMS256.txt"
  SUF_NODE_FILE=$(awk -v suffix="-linux-$SUF_ARCH.tar.xz" '$2 ~ suffix"$" {print $2}' "$SUF_DOWNLOAD_DIR/SHASUMS256.txt")
  [[ "$SUF_NODE_FILE" =~ ^node-v24\.[0-9]+\.[0-9]+-linux-(x64|arm64)\.tar\.xz$ ]] || fail 'Не удалось определить файл Node.js.'
  curl --retry 3 --connect-timeout 15 -fsSL "https://nodejs.org/dist/latest-v24.x/$SUF_NODE_FILE" -o "$SUF_DOWNLOAD_DIR/$SUF_NODE_FILE"
  (cd "$SUF_DOWNLOAD_DIR" && awk -v name="$SUF_NODE_FILE" '$2 == name' SHASUMS256.txt | sha256sum --check -)
  mkdir "$SUF_DOWNLOAD_DIR/node"
  tar -xJf "$SUF_DOWNLOAD_DIR/$SUF_NODE_FILE" -C "$SUF_DOWNLOAD_DIR/node" --strip-components=1 --no-same-owner
  if [[ -d /opt/suflyor-node ]]; then mv /opt/suflyor-node "/opt/suflyor-node.previous-$(date -u +%Y%m%d%H%M%S)"; fi
  mv "$SUF_DOWNLOAD_DIR/node" /opt/suflyor-node
fi
if [[ ! -f /etc/suflyor/environment ]]; then
  IFS= read -rsp 'Ключ API DeepSeek (ввод скрыт): ' SUF_KEY; printf '\n'
  IFS= read -rsp 'Придумайте пароль входа в Суфлёр (не пароль root): ' SUF_PASSWORD; printf '\n'
  IFS= read -rsp 'Повторите пароль приложения: ' SUF_CONFIRM; printf '\n'
  [[ -n "$SUF_PASSWORD" && "$SUF_PASSWORD" == "$SUF_CONFIRM" ]] || fail 'Пароли не совпадают или пустые.'
  printf '%s\0%s' "$SUF_KEY" "$SUF_PASSWORD" | python3 "$SUF_SOURCE/deploy/render-vps.py" environment --path /etc/suflyor/environment
  unset SUF_KEY SUF_PASSWORD SUF_CONFIRM
fi
install -m 0644 "$SUF_SOURCE/deploy/suflyor.service" /etc/systemd/system/suflyor.service
systemctl daemon-reload
systemctl enable suflyor
build_release; activate "$SUF_NEW_RELEASE"
python3 "$SUF_SOURCE/deploy/render-vps.py" nginx --host "$SUF_HOST" > /etc/nginx/sites-available/suflyor.conf
ln -sfn /etc/nginx/sites-available/suflyor.conf /etc/nginx/sites-enabled/suflyor.conf
nginx -t
systemctl enable --now nginx
systemctl reload nginx
python3 -m venv /opt/suflyor-certbot
/opt/suflyor-certbot/bin/pip install --upgrade 'certbot>=5.4,<6'
install -d -m 0755 /etc/letsencrypt/renewal-hooks/deploy
cat > /etc/letsencrypt/renewal-hooks/deploy/suflyor-nginx <<'HOOK'
#!/bin/sh
set -eu
if [ "${RENEWED_LINEAGE:-}" = /etc/letsencrypt/live/suflyor ]; then
    /usr/sbin/nginx -t
    /bin/systemctl reload nginx
fi
HOOK
chmod 0755 /etc/letsencrypt/renewal-hooks/deploy/suflyor-nginx
SUF_CERT_ARGS=(certonly --non-interactive --agree-tos --email "$SUF_EMAIL" --webroot --webroot-path /var/www/suflyor-acme --preferred-challenges http --cert-name suflyor --keep-until-expiring)
if [[ "$SUF_KIND" == ipv4 ]]; then SUF_CERT_ARGS+=(--ip-address "$SUF_HOST" --preferred-profile shortlived); else SUF_CERT_ARGS+=(-d "$SUF_HOST"); fi
/opt/suflyor-certbot/bin/certbot "${SUF_CERT_ARGS[@]}"
python3 "$SUF_SOURCE/deploy/render-vps.py" nginx --host "$SUF_HOST" --tls > /etc/nginx/sites-available/suflyor.conf
nginx -t
systemctl reload nginx
install -m 0644 "$SUF_SOURCE/deploy/suflyor-cert-renew.service" /etc/systemd/system/suflyor-cert-renew.service
install -m 0644 "$SUF_SOURCE/deploy/suflyor-cert-renew.timer" /etc/systemd/system/suflyor-cert-renew.timer
systemctl daemon-reload
systemctl enable --now suflyor-cert-renew.timer
printf '%s\n' "$SUF_HOST" > /etc/suflyor/installed
printf '\nГотово: https://%s\nПароль приложения — тот, который вы ввели при установке.\n' "$SUF_HOST"
printf 'Логи: journalctl -u suflyor -n 80 --no-pager\nСертификаты: systemctl list-timers suflyor-cert-renew.timer\n'
