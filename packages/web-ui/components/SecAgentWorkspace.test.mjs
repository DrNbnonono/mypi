import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const componentSource = await readFile(new URL("./SecAgentWorkspace.tsx", import.meta.url), "utf8");
const profileRouteSource = await readFile(new URL("../app/api/agent/[id]/profile/route.ts", import.meta.url), "utf8");
const eventRouteSource = await readFile(new URL("../app/api/agent/[id]/events/route.ts", import.meta.url), "utf8");
const appShellSource = await readFile(new URL("./AppShell.tsx", import.meta.url), "utf8");

test("uses the Profile GET snapshot and POST command contract", () => {
  assert.match(componentSource, /fetch\(`\/api\/agent\/\$\{encodeURIComponent\(sessionId\)\}\/profile`/);
  assert.match(componentSource, /method: "POST"/);
  assert.match(componentSource, /body: JSON\.stringify\(body\)/);
  assert.match(profileRouteSource, /session\.send\(\{ type: "profile_snapshot" \}\)/);
  assert.match(profileRouteSource, /session\.send\(\{ type: "profile_command", command \}\)/);
});

test("rejects malformed profile data and hides the workspace for coding sessions", () => {
  assert.match(componentSource, /export function isSecurityProfileSnapshot/);
  assert.match(componentSource, /Sec profile returned an empty or invalid snapshot/);
  assert.match(componentSource, /if \(result\.agentMode === "coding"\)/);
  assert.match(componentSource, /if \(loadState === "coding"\) return null/);
  assert.match(appShellSource, /\(selectedSession\?\.agentMode \?\? newSessionAgentMode\) === "sec" && <SecAgentWorkspace/);
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
  assert.match(componentSource, /必须填写授权来源/);
  assert.match(componentSource, /type: "set_isolation"/);
  assert.match(componentSource, /status: isolationKind/);
  assert.match(componentSource, /type: "authorize_autonomous"/);
  assert.match(componentSource, /window\.confirm\(/);
  assert.match(componentSource, /type: "set_policy"/);
  assert.match(componentSource, /aria-label="Isolation type"/);
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

test("renders loading, empty, API error, and SSE error states", () => {
  assert.match(componentSource, /Loading Sec profile/);
  assert.match(componentSource, /The Sec runtime starts when the new session is first used/);
  assert.match(componentSource, /role="alert"/);
  assert.match(componentSource, /role="status"/);
  assert.match(componentSource, /Goal not extracted/);
  assert.match(componentSource, /No authorized targets/);
});
