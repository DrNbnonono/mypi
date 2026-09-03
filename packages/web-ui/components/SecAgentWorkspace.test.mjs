import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { enLocale } from "../lib/i18n/messages/en.ts";
import { zhCNLocale } from "../lib/i18n/messages/zh-CN.ts";

const componentSource = await readFile(new URL("./SecAgentWorkspace.tsx", import.meta.url), "utf8");
const profileRouteSource = await readFile(new URL("../app/api/agent/[id]/profile/route.ts", import.meta.url), "utf8");
const eventRouteSource = await readFile(new URL("../app/api/agent/[id]/events/route.ts", import.meta.url), "utf8");
const appShellSource = await readFile(new URL("./AppShell.tsx", import.meta.url), "utf8");
const enMessagesSource = await readFile(new URL("../lib/i18n/messages/en.ts", import.meta.url), "utf8");
const zhCNMessagesSource = await readFile(new URL("../lib/i18n/messages/zh-CN.ts", import.meta.url), "utf8");

test("uses the Profile GET snapshot and POST command contract", () => {
  assert.match(componentSource, /fetch\(`\/api\/agent\/\$\{encodeURIComponent\(sessionId\)\}\/profile`/);
  assert.match(componentSource, /method: "POST"/);
  assert.match(componentSource, /body: JSON\.stringify\(body\)/);
  assert.match(profileRouteSource, /session\.send\(\{ type: "profile_snapshot" \}\)/);
  assert.match(profileRouteSource, /session\.send\(\{ type: "profile_command", command \}\)/);
	assert.match(profileRouteSource, /Unsupported profile command/);
	assert.match(profileRouteSource, /status: 400/);
});

test("rejects malformed profile data and hides the workspace for coding sessions", () => {
  assert.match(componentSource, /export function isSecurityProfileSnapshot/);
	assert.match(componentSource, /sec\.error\.invalidSnapshot/);
  assert.match(componentSource, /if \(result\.agentMode === "coding"\)/);
  assert.match(componentSource, /if \(loadState === "coding"\) return null/);
  assert.match(appShellSource, /activeAgentMode === "sec"/);
  assert.match(componentSource, /expanded\?: boolean/);
  assert.match(componentSource, /onExpandedChange\?:/);
  assert.match(appShellSource, /data-sec-workspace-toggle="true"/);
});

test("validates snapshots before rendering and classifies common target forms", () => {
  assert.match(componentSource, /export function isSecurityProfileSnapshot/);
  assert.match(componentSource, /Array\.isArray\(scope\.targets\)/);
  assert.match(componentSource, /scope\.targets\.every/);
  assert.match(componentSource, /export function targetKind/);
  assert.match(componentSource, /return "ipv4"/);
  assert.match(componentSource, /return "cidr"/);
  assert.match(componentSource, /return "url"/);
  assert.match(componentSource, /return value\.includes\("\."\) \? "domain" : "host"/);
});

test("handles SSE profile_state updates, reconnect errors, and cleanup", () => {
  assert.match(eventRouteSource, /createAgentEventStream\(req, id, sessionPromise\)/);
  assert.match(componentSource, /new EventSource\(`\/api\/agent\/\$\{encodeURIComponent\(sessionId\)\}\/events`\)/);
  assert.match(componentSource, /event\.type === "profile_state"/);
  assert.match(componentSource, /source\.onerror = \(\) => setConnectionError/);
  assert.match(componentSource, /return \(\) => source\.close\(\)/);
  assert.match(componentSource, /const controller = new AbortController\(\)/);
  assert.match(componentSource, /return \(\) => controller\.abort\(\)/);
});

test("exposes structured scope, policy, isolation, and autonomous interactions", () => {
	assert.match(componentSource, /type: "set_scope"/);
	assert.match(componentSource, /sec\.error\.authorizationRequired/);
  assert.match(componentSource, /type: "set_isolation"/);
  assert.match(componentSource, /status: isolationKind/);
  assert.match(componentSource, /type: "authorize_autonomous"/);
  assert.match(componentSource, /window\.confirm\(/);
  assert.match(componentSource, /type: "set_policy"/);
	assert.match(componentSource, /sec\.policy\.isolationType/);
});

test("supports report preview and client download for both formats", () => {
  assert.match(componentSource, /type: "build_report", format/);
  assert.match(componentSource, /setReport\(\{ format, content: value \}\)/);
  assert.match(componentSource, /new Blob\(\[report\.content\]/);
  assert.match(componentSource, /application\/json/);
  assert.match(componentSource, /text\/markdown/);
  assert.match(componentSource, /link\.download = `secagent-report\./);
  assert.match(componentSource, /<pre[\s\S]*report\.content/);
});

test("runs structured SecAgent diagnostics and renders every check", () => {
	assert.match(componentSource, /type: "run_diagnostics"/);
	assert.match(componentSource, /isSecAgentDiagnostics\(value\)/);
	assert.match(componentSource, /sec\.diagnostics\.title/);
	assert.match(componentSource, /diagnostics\?\.checks\.map/);
});

test("renders loading, empty, API error, and SSE error states", () => {
	assert.match(componentSource, /sec\.loading/);
	assert.match(componentSource, /sec\.runtimeStarts/);
	assert.match(componentSource, /role="alert"/);
	assert.match(componentSource, /role="status"/);
	assert.match(componentSource, /sec\.scope\.goalNotExtracted/);
	assert.match(componentSource, /sec\.scope\.noAuthorizedTargets/);
});

test("uses sec namespace translations for every local workspace label", () => {
	assert.match(componentSource, /const \{ t \} = useI18n\(\)/);
	assert.match(componentSource, /stageKeys/);
	assert.match(componentSource, /policyModeKeys/);
	assert.match(componentSource, /isolationStatusKeys/);
	assert.match(componentSource, /diagnosticStatusKeys/);
	assert.match(componentSource, /policyDecisionKeys/);
	assert.match(componentSource, /translateStructuredValue/);
	assert.match(enMessagesSource, /"sec\.title":/);
	assert.match(zhCNMessagesSource, /"sec\.title":/);
	assert.match(enMessagesSource, /"sec\.diagnostics\.status\.pass":/);
	assert.match(zhCNMessagesSource, /"sec\.diagnostics\.status\.pass":/);
	assert.doesNotMatch(componentSource, />\s*(?:SEC WORKSPACE|Environment diagnostics|Task and authorization scope|Policy and isolation|Evidence and findings|Report)\s*</);
});

test("keeps the complete sec namespace in both locale packages", () => {
	const enKeys = Object.keys(enLocale.messages).filter((key) => key.startsWith("sec.")).sort();
	const zhKeys = Object.keys(zhCNLocale.messages).filter((key) => key.startsWith("sec.")).sort();
	assert.deepEqual(zhKeys, enKeys);
	assert.equal(enKeys.length, 74);
	assert.notEqual(enLocale.messages["sec.title"], zhCNLocale.messages["sec.title"]);
	assert.notEqual(enLocale.messages["sec.stage.recon"], zhCNLocale.messages["sec.stage.recon"]);
});

test("keeps server-provided error details and evidence text unchanged", () => {
	assert.match(componentSource, /typeof body\.error === "string" \? body\.error/);
	assert.match(componentSource, /finding\.summary/);
	assert.match(componentSource, /check\.message/);
	assert.doesNotMatch(componentSource, /body\.error\.(?:includes|startsWith|endsWith)/);
});
