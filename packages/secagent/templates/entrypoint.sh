#!/bin/sh
set -eu

mkdir -p "${HOME:-/tmp/secagent-home}"

entrypoint="${1:-cli}"
if [ "$#" -gt 0 ]; then
	shift
fi

case "$entrypoint" in
	cli)
		exec node /opt/pi/packages/coding-agent/dist/bundle/cli.js --agent-mode sec "$@"
		;;
	web)
		exec node /opt/pi/packages/web-ui/bin/pi-web.js start --hostname 0.0.0.0 --port 30141 --no-open "$@"
		;;
	*)
		echo >&2 "SecAgent entrypoint diagnostic: expected 'cli' or 'web', got '$entrypoint'"
		exit 64
		;;
esac
