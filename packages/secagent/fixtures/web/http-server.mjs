import { createServer } from "node:http";

const host = process.env.FIXTURE_HOST ?? "127.0.0.1";
const port = Number(process.env.FIXTURE_PORT ?? "8080");

if (!new Set(["127.0.0.1", "0.0.0.0"]).has(host)) {
	throw new Error(`fixture host must be loopback or container-internal, got ${host}`);
}
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("fixture port must be between 1 and 65535");

const server = createServer((request, response) => {
	if (request.url === "/health" || request.url === "/") {
		response.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
		response.end("pi-secagent-loopback-fixture-ok\n");
		return;
	}
	if (request.url === "/.well-known/pi-secagent-fixture") {
		response.writeHead(200, { "content-type": "application/json" });
		response.end(JSON.stringify({ fixture: "web-http", network: "internal", publicNetwork: false }));
		return;
	}
	response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
	response.end("not found\n");
});

server.listen(port, host, () => {
	process.stdout.write(`loopback fixture listening on ${host}:${port}\n`);
});

const shutdown = () => server.close(() => process.exit(0));
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
