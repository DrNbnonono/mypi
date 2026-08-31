ARG BASE_IMAGE=node:22-bookworm-slim
FROM ${BASE_IMAGE}

WORKDIR /opt/pi
COPY . .

# Security-tool versions are explicit so an image rebuild cannot silently move
# to a different scanner/parser. Override these ARGs only with versions from
# the selected Debian base image.
ARG NMAP_VERSION=7.93+dfsg1-1
ARG CURL_VERSION=7.88.1-10+deb12u8
ARG FILE_VERSION=1:5.44-3
ARG BINUTILS_VERSION=2.40-2
ARG BINWALK_VERSION=2.3.4+dfsg1-5
ARG EXIFTOOL_VERSION=12.57+dfsg-1

RUN set -eux; \
	apt-get update; \
	if ! apt-get install -y --no-install-recommends \
		"nmap=${NMAP_VERSION}" \
		"curl=${CURL_VERSION}" \
		"file=${FILE_VERSION}" \
		"binutils=${BINUTILS_VERSION}" \
		"binwalk=${BINWALK_VERSION}" \
		"libimage-exiftool-perl=${EXIFTOOL_VERSION}" \
		gcc; then \
		echo >&2 "SecAgent image diagnostic: a pinned Debian security-tool version is unavailable for BASE_IMAGE=${BASE_IMAGE}. Check the base distribution and override the version ARGs with package versions from that image."; \
		exit 42; \
	fi; \
	rm -rf /var/lib/apt/lists/*

RUN npm ci --ignore-scripts || { \
	echo >&2 "SecAgent image diagnostic: npm dependencies could not be installed. Provide the repository lockfile and npm registry/cache access, or build the application artifacts before using an offline image workflow."; \
	exit 43; \
}

RUN npm install --ignore-scripts --no-save \
	pi-sandbox@0.6.3 \
	pi-mcp-adapter@2.23.0 \
	pi-subagents@0.50.0 \
	pi-trace-extension@0.1.14 || { \
	echo >&2 "SecAgent image diagnostic: pinned Sec runtime packages are unavailable. Provide a reviewed npm mirror or offline cache containing the exact versions."; \
	exit 44; \
}

RUN npm run build && \
	node packages/web-ui/bin/prepare-runtime.js --mark-only && \
	npm run build --workspace=@agegr/pi-web

# The fixture sources are local and deterministic. No script or artifact is
# downloaded during this step.
RUN mkdir -p /opt/secagent-fixtures/pwn /opt/secagent-fixtures/reverse /opt/secagent-fixtures/forensics && \
	gcc -O0 -g -fno-stack-protector -no-pie \
		packages/secagent/fixtures/pwn/vulnerable.c \
		-o /opt/secagent-fixtures/pwn/vulnerable && \
	gcc -O0 -g -fno-stack-protector -no-pie \
		packages/secagent/fixtures/reverse/branchy.c \
		-o /opt/secagent-fixtures/reverse/branchy && \
	node packages/secagent/fixtures/forensics/create-sample.mjs \
		/opt/secagent-fixtures/forensics/sample.png

COPY packages/secagent/templates/entrypoint.sh /usr/local/bin/pi-secagent
RUN chmod 0755 /usr/local/bin/pi-secagent

ENV HOME=/tmp/secagent-home
ENV PI_AGENT_MODE=sec
ENTRYPOINT ["/usr/local/bin/pi-secagent"]
CMD ["cli"]
