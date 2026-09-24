#!/usr/bin/env bash
set -euo pipefail

base=/opt/apps/hr-platform
release=${1:?Pass the absolute release directory}
case "$release" in "$base"/releases/*) ;; *) echo 'Invalid release directory' >&2; exit 1 ;; esac
test -f "$release/backend/app.jar"
test -f "$release/frontend/index.html"
test -f "$base/shared/test.env"
mkdir -p "$base/shared/uploads"

pid_file="$base/shared/app.pid"
if [[ -f "$pid_file" ]]; then
    pid=$(cat "$pid_file")
    [[ "$pid" =~ ^[0-9]+$ ]] || { echo 'Invalid PID file' >&2; exit 1; }
    if kill -0 "$pid" 2>/dev/null; then
        command_line=$(tr '\0' ' ' < "/proc/$pid/cmdline")
        [[ "$command_line" == *"$base/current/backend/app.jar"* ]] || { echo 'PID belongs to another process' >&2; exit 1; }
        kill "$pid"
        for _ in $(seq 1 30); do
            kill -0 "$pid" 2>/dev/null || break
            sleep 1
        done
        kill -0 "$pid" 2>/dev/null && { echo 'Previous backend did not stop' >&2; exit 1; }
    fi
    rm "$pid_file"
fi

if ss -ltn | grep -q ':8096 '; then
    echo 'Port 8096 is in use by an unowned process' >&2
    exit 1
fi

ln -s "$release" "$base/current.next"
mv -Tf "$base/current.next" "$base/current"
set -a
# shellcheck disable=SC1091
. "$base/shared/test.env"
set +a
export HR_USER_CENTER_BASE_URL="${HR_USER_CENTER_BASE_URL:-https://test.medianos.com/smart-site-cloud/user}"
cd "$base/current/backend"
nohup java -Dfile.encoding=UTF-8 -jar "$base/current/backend/app.jar" --spring.profiles.active=test >> "$base/shared/app.log" 2>&1 < /dev/null &
printf '%s\n' "$!" > "$pid_file"

for _ in $(seq 1 90); do
    pid=$(cat "$pid_file")
    kill -0 "$pid" 2>/dev/null || { echo 'Backend exited; check app.log' >&2; exit 1; }
    if curl -fsS --max-time 2 http://127.0.0.1:8096/actuator/health | grep -q '"UP"'; then
        echo "Backend ready, PID $pid"
        exit 0
    fi
    sleep 1
done
echo 'Backend did not become healthy within 90 seconds' >&2
exit 1
