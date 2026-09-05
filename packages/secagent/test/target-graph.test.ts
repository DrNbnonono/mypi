import { describe, expect, it } from "vitest";
import { applySecurityEvent, createInitialSecurityState } from "../src/core/state.ts";
import {
	compileTargetContext,
	createTargetEdge,
	createTargetNode,
	targetGraphIntegrityErrors,
} from "../src/core/target-graph.ts";

describe("security target graph", () => {
	it("records evidence-backed nodes and attack-path edges", () => {
		let state = createInitialSecurityState();
		state.scope.targets.push({ id: "scope-1", kind: "ipv4", value: "127.0.0.1" });
		state.evidence.push({
			id: "evidence-1",
			kind: "observation",
			summary: "port 3000 is reachable",
			confidence: 0.9,
			createdAt: "2026-09-04T00:00:00.000Z",
		});
		const host = createTargetNode(state, {
			kind: "host",
			label: "127.0.0.1",
			status: "verified",
			confidence: 0.95,
			evidenceIds: ["evidence-1"],
			scopeTargetId: "scope-1",
		});
		state = applySecurityEvent(state, { type: "target_node_recorded", node: host, createdAt: host.createdAt });
		const service = createTargetNode(state, {
			kind: "service",
			label: "http://127.0.0.1:3000",
			status: "verified",
			confidence: 0.9,
			evidenceIds: ["evidence-1"],
		});
		state = applySecurityEvent(state, { type: "target_node_recorded", node: service, createdAt: service.createdAt });
		const edge = createTargetEdge(state, {
			fromNodeId: host.id,
			toNodeId: service.id,
			kind: "exposes",
			status: "verified",
			evidenceIds: ["evidence-1"],
		});
		state = applySecurityEvent(state, { type: "target_edge_recorded", edge, createdAt: edge.createdAt });
		expect(targetGraphIntegrityErrors(state)).toEqual([]);
		expect(compileTargetContext(state)).toMatchObject({ revision: 3, openNodeIds: [], deadEndNodeIds: [] });
	});

	it("stores credential references without preserving supplied labels", () => {
		const state = createInitialSecurityState();
		const node = createTargetNode(state, {
			kind: "credential",
			label: "actual-password",
			secretRef: "secret://competition/challenge-1/admin",
		});
		expect(node.label).toMatch(/^credential:[0-9a-f]{12}$/);
		expect(JSON.stringify(node)).not.toContain("actual-password");
		expect(() => createTargetNode(state, { kind: "credential", label: "raw" })).toThrow(/secret:\/\//);
	});
});
