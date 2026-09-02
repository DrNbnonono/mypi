#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
REPO_ROOT=$(cd -- "$SCRIPT_DIR/../../.." && pwd)
COMPOSE_FILE="$REPO_ROOT/packages/secagent/templates/docker-compose.yml"
PROJECT_NAME="${SECAGENT_ACCEPTANCE_PROJECT:-pi-secagent-acceptance}"
WEB_PORT="${SECAGENT_WEB_PORT:-30141}"
BASE_IMAGE="${SECAGENT_BASE_IMAGE:-node:22-bookworm-slim}"
KEEP_RESOURCES=0
SKIP_BUILD=0
TIMESTAMP=$(date -u +%Y%m%dT%H%M%SZ)
OUTPUT_DIR="${SECAGENT_ACCEPTANCE_OUTPUT:-$REPO_ROOT/.artifacts/secagent-acceptance/$TIMESTAMP}"

usage() {
	cat <<'EOF'
Usage: competition-acceptance.sh [options]

Options:
  --skip-build       Reuse an existing pi-secagent-acceptance image.
  --keep             Keep the Compose project and its named volume after the run.
  --web-port PORT    Host loopback port for the Web smoke test (default: 30141).
  --base-image IMAGE Docker base image; must be a reviewed Node 22 Debian image.
  --output DIR       Host directory for logs and reports.
  -h, --help         Show this help.
EOF
}

while (($# > 0)); do
	case "$1" in
		--skip-build) SKIP_BUILD=1 ;;
		--keep) KEEP_RESOURCES=1 ;;
		--web-port)
			[[ $# -ge 2 ]] || { echo "--web-port requires a value" >&2; exit 64; }
			WEB_PORT=$2
			shift
			;;
		--base-image)
			[[ $# -ge 2 ]] || { echo "--base-image requires a value" >&2; exit 64; }
			BASE_IMAGE=$2
			shift
			;;
		--output)
			[[ $# -ge 2 ]] || { echo "--output requires a directory" >&2; exit 64; }
			OUTPUT_DIR=$2
			shift
			;;
		-h|--help)
			usage
			exit 0
			;;
		*)
			echo "Unknown option: $1" >&2
			usage >&2
			exit 64
			;;
	esac
	shift
done

mkdir -p "$OUTPUT_DIR/workspace" "$OUTPUT_DIR/tools"
GIT_COMMIT=$(git -C "$REPO_ROOT" rev-parse HEAD)
export SECAGENT_WORKSPACE="$OUTPUT_DIR/workspace"
export SECAGENT_TOOLS="$OUTPUT_DIR/tools"
export SECAGENT_WEB_PORT="$WEB_PORT"
export SECAGENT_BASE_IMAGE="$BASE_IMAGE"
export SECAGENT_GIT_COMMIT="$GIT_COMMIT"
export COMPOSE_PROJECT_NAME="$PROJECT_NAME"

COMPOSE=(docker compose -p "$PROJECT_NAME" -f "$COMPOSE_FILE")
LOG_DIR="$OUTPUT_DIR/logs"
mkdir -p "$LOG_DIR"
SUMMARY_FILE="$OUTPUT_DIR/acceptance-summary.json"

cleanup() {
	local status=$?
	if ((KEEP_RESOURCES == 0)); then
		"${COMPOSE[@]}" down --volumes --remove-orphans >"$LOG_DIR/compose-down.log" 2>&1 || true
	else
		echo "Compose resources kept because --keep was supplied" >&2
	fi
	exit "$status"
}
trap cleanup EXIT

run_phase() {
	local name=$1
	shift
	local log="$LOG_DIR/$name.log"
	echo "[acceptance] $name"
	set +e
	"$@" > >(tee "$log") 2>&1
	local status=${PIPESTATUS[0]}
	set -e
	if ((status != 0)); then
		echo "[acceptance] FAILED: $name (log: $log)" >&2
		return "$status"
	fi
}

run_shell_phase() {
	local name=$1
	shift
	run_phase "$name" "${COMPOSE[@]}" run --rm --no-deps --entrypoint sh pi-secagent -c "$*"
}

wait_for_web() {
	local url="http://127.0.0.1:$WEB_PORT/"
	for _ in {1..60}; do
		if curl --fail --silent --show-error --max-time 5 "$url" >"$LOG_DIR/web-root-response.html"; then return 0; fi
		sleep 2
	done
	echo "Web did not become ready at $url" >&2
	return 1
}

json_field() {
	local field=$1
	node -e 'const fs = require("node:fs"); const data = JSON.parse(fs.readFileSync(0, "utf8")); const value = data[process.argv[1]]; if (typeof value !== "string" || value.length === 0) process.exit(1); process.stdout.write(value);' "$field"
}

assert_json_contains() {
	local file=$1
	local pattern=$2
	node -e 'const fs = require("node:fs"); const text = fs.readFileSync(process.argv[1], "utf8"); if (!text.includes(process.argv[2])) process.exit(1);' "$file" "$pattern"
}

echo "[acceptance] output: $OUTPUT_DIR"
run_phase compose-config "${COMPOSE[@]}" config --quiet

if ((SKIP_BUILD == 0)); then
	run_phase image-build "${COMPOSE[@]}" --progress=plain build --pull=false
else
	echo "[acceptance] image-build skipped"
fi

run_phase cli-help "${COMPOSE[@]}" run --rm --no-deps pi-secagent cli --help
run_phase cli-version "${COMPOSE[@]}" run --rm --no-deps pi-secagent cli --version
run_shell_phase tool-inventory 'set -eu; for tool in nmap curl file strings readelf objdump binwalk exiftool; do command -v "$tool"; "$tool" --version 2>&1 | head -n 1 || "$tool" -V 2>&1 | head -n 1; done'
run_shell_phase runtime-package-inventory 'set -eu; test -n "$PI_SECAGENT_RUNTIME_DIR"; node - "$PI_SECAGENT_RUNTIME_DIR" <<'"'"'NODE'"'"'
const fs = require("node:fs");
const root = process.argv[2];
const expected = new Map([
  ["pi-sandbox", "0.6.3"],
  ["pi-mcp-adapter", "2.23.0"],
  ["pi-subagents", "0.50.0"],
  ["pi-trace-extension", "0.1.14"],
]);
for (const [name, version] of expected) {
  const manifest = JSON.parse(fs.readFileSync(`${root}/node_modules/${name}/package.json`, "utf8"));
  if (manifest.version !== version) throw new Error(`${name}: expected ${version}, got ${manifest.version}`);
  console.log(`${name}@${manifest.version}`);
}
NODE'

run_phase fixture-start "${COMPOSE[@]}" --profile fixtures up -d fixture-web
run_phase fixture-health "${COMPOSE[@]}" run --rm --no-deps --entrypoint sh pi-secagent -c 'set -eu; curl --fail --silent --show-error http://fixture-web:8080/health; nmap -sT -Pn --host-timeout 10s -p 8080 fixture-web'
run_shell_phase real-artifact-tools 'set -eu; for path in /opt/secagent-fixtures/pwn/vulnerable /opt/secagent-fixtures/reverse/branchy; do file "$path"; strings "$path" | head -n 5; readelf -h "$path"; objdump -d --section=.text "$path" | head -n 12; binwalk "$path"; done; exiftool /opt/secagent-fixtures/forensics/sample.png'

run_shell_phase sec-tests 'set -eu; npm run test --workspace=@earendil-works/pi-secagent'
run_phase controlled-benchmarks "${COMPOSE[@]}" run --rm --no-deps --entrypoint node pi-secagent /opt/pi/packages/secagent/scripts/controlled-acceptance.mjs --output /workspace/controlled-acceptance.json
cp "$OUTPUT_DIR/workspace/controlled-acceptance.json" "$OUTPUT_DIR/controlled-acceptance.json"

run_phase web-start "${COMPOSE[@]}" --profile web up -d pi-secagent-web
run_phase web-ready wait_for_web
run_phase web-sessions curl --fail --silent --show-error --max-time 30 "http://127.0.0.1:$WEB_PORT/api/sessions"
curl --fail --silent --show-error --max-time 30 \
	-X POST "http://127.0.0.1:$WEB_PORT/api/agent/new" \
	-H 'content-type: application/json' \
	--data '{"cwd":"/workspace","type":"ensure_session","agentMode":"sec"}' \
	>"$OUTPUT_DIR/new-session.json"
SESSION_ID=$(json_field sessionId <"$OUTPUT_DIR/new-session.json")
echo "$SESSION_ID" >"$OUTPUT_DIR/session-id.txt"
assert_json_contains "$OUTPUT_DIR/new-session.json" '"agentMode":"sec"'

curl --fail --silent --show-error --max-time 30 \
	"http://127.0.0.1:$WEB_PORT/api/agent/$SESSION_ID/profile" \
	>"$OUTPUT_DIR/profile-initial.json"
assert_json_contains "$OUTPUT_DIR/profile-initial.json" '"agentMode":"sec"'
assert_json_contains "$OUTPUT_DIR/profile-initial.json" '"autonomousReady":false'

if curl --fail --silent --show-error --max-time 30 \
	-X POST "http://127.0.0.1:$WEB_PORT/api/agent/$SESSION_ID/profile" \
	-H 'content-type: application/json' \
	--data '{"type":"set_policy","mode":"autonomous","operator":"acceptance","reason":"negative prerequisite test"}' \
	>"$OUTPUT_DIR/autonomous-without-isolation.json"; then
	echo "autonomous unexpectedly enabled without isolation" >&2
	exit 1
fi

curl --fail --silent --show-error --max-time 30 \
	-X POST "http://127.0.0.1:$WEB_PORT/api/agent/$SESSION_ID/profile" \
	-H 'content-type: application/json' \
	--data '{"type":"set_scope","scope":{"targets":[{"id":"fixture","kind":"host","value":"fixture-web"}],"authorizationSource":"containerized competition fixture","updatedAt":"2026-09-01T00:00:00.000Z"}}' \
	>"$OUTPUT_DIR/profile-scope.json"
curl --fail --silent --show-error --max-time 30 \
	-X POST "http://127.0.0.1:$WEB_PORT/api/agent/$SESSION_ID/profile" \
	-H 'content-type: application/json' \
	--data '{"type":"set_isolation","isolation":{"status":"sandbox","source":"containerized competition fixture","verifiedAt":"2026-09-01T00:00:00.000Z"}}' \
	>"$OUTPUT_DIR/profile-isolation.json"
curl --fail --silent --show-error --max-time 30 \
	-X POST "http://127.0.0.1:$WEB_PORT/api/agent/$SESSION_ID/profile" \
	-H 'content-type: application/json' \
	--data '{"type":"set_policy","mode":"competition","operator":"acceptance","reason":"bounded container smoke"}' \
	>"$OUTPUT_DIR/profile-policy.json"
curl --fail --silent --show-error --max-time 30 \
	-X POST "http://127.0.0.1:$WEB_PORT/api/agent/$SESSION_ID/profile" \
	-H 'content-type: application/json' \
	--data '{"type":"build_report","format":"json"}' \
	>"$OUTPUT_DIR/profile-report.json"
assert_json_contains "$OUTPUT_DIR/profile-report.json" '"success":true'

curl --fail --silent --show-error --max-time 8 \
	-N "http://127.0.0.1:$WEB_PORT/api/agent/running/events" \
	>"$OUTPUT_DIR/running-events.sse" &
SSE_PID=$!
sleep 3
kill "$SSE_PID" 2>/dev/null || true
wait "$SSE_PID" 2>/dev/null || true
assert_json_contains "$OUTPUT_DIR/running-events.sse" '"type":"running"'

run_phase web-stop "${COMPOSE[@]}" stop pi-secagent-web
run_phase web-restart "${COMPOSE[@]}" --profile web up -d pi-secagent-web
run_phase web-ready-after-restart wait_for_web
curl --fail --silent --show-error --max-time 30 \
	"http://127.0.0.1:$WEB_PORT/api/agent/$SESSION_ID/profile" \
	>"$OUTPUT_DIR/profile-after-restart.json"
assert_json_contains "$OUTPUT_DIR/profile-after-restart.json" '"agentMode":"sec"'
assert_json_contains "$OUTPUT_DIR/profile-after-restart.json" '"fixture"'

node "$SCRIPT_DIR/summarize-acceptance.mjs" "$OUTPUT_DIR" "$PROJECT_NAME" "$SESSION_ID" "$SUMMARY_FILE"
echo "[acceptance] PASS"
echo "[acceptance] summary: $SUMMARY_FILE"
