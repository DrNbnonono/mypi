import { createHash, randomUUID } from "node:crypto";
import type {
	SecurityState,
	SecurityTargetEdge,
	SecurityTargetEdgeKind,
	SecurityTargetNode,
	SecurityTargetNodeKind,
	SecurityTargetStatus,
} from "./types.ts";

export interface SecurityTargetNodeInput {
	kind: SecurityTargetNodeKind;
	label?: string;
	status?: SecurityTargetStatus;
	confidence?: number;
	evidenceIds?: string[];
	scopeTargetId?: string;
	secretRef?: string;
}

export interface SecurityTargetEdgeInput {
	fromNodeId: string;
	toNodeId: string;
	kind: SecurityTargetEdgeKind;
	status?: SecurityTargetStatus;
	confidence?: number;
	evidenceIds?: string[];
}

function confidence(value: number | undefined): number {
	return Math.max(0, Math.min(1, value ?? 0.5));
}

function validateEvidenceIds(state: SecurityState, evidenceIds: readonly string[]): void {
	const known = new Set(state.evidence.map((item) => item.id));
	const missing = evidenceIds.find((id) => !known.has(id));
	if (missing) throw new Error(`Target graph references missing evidence ${missing}`);
}

export function createTargetNode(state: SecurityState, input: SecurityTargetNodeInput): SecurityTargetNode {
	const evidenceIds = [...new Set(input.evidenceIds ?? [])];
	validateEvidenceIds(state, evidenceIds);
	if (input.scopeTargetId && !state.scope.targets.some((target) => target.id === input.scopeTargetId))
		throw new Error(`Target node references missing scope target ${input.scopeTargetId}`);
	let label = input.label?.trim();
	if (input.kind === "credential") {
		if (!input.secretRef?.startsWith("secret://"))
			throw new Error("Credential nodes require an opaque secret:// reference");
		label = `credential:${createHash("sha256").update(input.secretRef).digest("hex").slice(0, 12)}`;
	} else if (!label) {
		throw new Error("Target nodes require a non-empty label");
	}
	const createdAt = new Date().toISOString();
	return {
		id: randomUUID(),
		kind: input.kind,
		label,
		status: input.status ?? "hypothesis",
		confidence: confidence(input.confidence),
		evidenceIds,
		scopeTargetId: input.scopeTargetId,
		secretRef: input.kind === "credential" ? input.secretRef : undefined,
		createdAt,
		updatedAt: createdAt,
	};
}

export function createTargetEdge(state: SecurityState, input: SecurityTargetEdgeInput): SecurityTargetEdge {
	const nodeIds = new Set(state.targetGraph.nodes.map((node) => node.id));
	if (!nodeIds.has(input.fromNodeId)) throw new Error(`Target edge references missing node ${input.fromNodeId}`);
	if (!nodeIds.has(input.toNodeId)) throw new Error(`Target edge references missing node ${input.toNodeId}`);
	if (input.fromNodeId === input.toNodeId) throw new Error("Target edges may not connect a node to itself");
	const evidenceIds = [...new Set(input.evidenceIds ?? [])];
	validateEvidenceIds(state, evidenceIds);
	const createdAt = new Date().toISOString();
	return {
		id: randomUUID(),
		fromNodeId: input.fromNodeId,
		toNodeId: input.toNodeId,
		kind: input.kind,
		status: input.status ?? "hypothesis",
		confidence: confidence(input.confidence),
		evidenceIds,
		createdAt,
		updatedAt: createdAt,
	};
}

export function targetGraphIntegrityErrors(state: SecurityState): string[] {
	const errors: string[] = [];
	const nodeIds = new Set(state.targetGraph.nodes.map((node) => node.id));
	const evidenceIds = new Set(state.evidence.map((item) => item.id));
	const scopeIds = new Set(state.scope.targets.map((target) => target.id));
	for (const node of state.targetGraph.nodes) {
		if (node.scopeTargetId && !scopeIds.has(node.scopeTargetId))
			errors.push(`Node ${node.id} references missing scope target ${node.scopeTargetId}`);
		for (const evidenceId of node.evidenceIds)
			if (!evidenceIds.has(evidenceId)) errors.push(`Node ${node.id} references missing evidence ${evidenceId}`);
		if (node.kind === "credential" && (!node.secretRef || !node.label.startsWith("credential:")))
			errors.push(`Credential node ${node.id} does not use protected reference semantics`);
	}
	for (const edge of state.targetGraph.edges) {
		if (!nodeIds.has(edge.fromNodeId)) errors.push(`Edge ${edge.id} references missing node ${edge.fromNodeId}`);
		if (!nodeIds.has(edge.toNodeId)) errors.push(`Edge ${edge.id} references missing node ${edge.toNodeId}`);
		for (const evidenceId of edge.evidenceIds)
			if (!evidenceIds.has(evidenceId)) errors.push(`Edge ${edge.id} references missing evidence ${evidenceId}`);
	}
	return errors;
}

export interface CompiledTargetContext {
	revision: number;
	nodes: Array<Pick<SecurityTargetNode, "id" | "kind" | "label" | "status" | "confidence" | "evidenceIds">>;
	edges: SecurityTargetEdge[];
	openNodeIds: string[];
	deadEndNodeIds: string[];
}

export function compileTargetContext(
	state: SecurityState,
	options: { nodeIds?: readonly string[]; maxNodes?: number } = {},
): CompiledTargetContext {
	const maxNodes = Math.max(1, Math.min(64, options.maxNodes ?? 24));
	const requested = options.nodeIds ? new Set(options.nodeIds) : undefined;
	const nodes = state.targetGraph.nodes
		.filter((node) => !requested || requested.has(node.id))
		.sort((left, right) => {
			if (left.status === "verified" && right.status !== "verified") return -1;
			if (right.status === "verified" && left.status !== "verified") return 1;
			return right.confidence - left.confidence;
		})
		.slice(0, maxNodes);
	const selectedIds = new Set(nodes.map((node) => node.id));
	return {
		revision: state.targetGraph.revision,
		nodes: nodes.map(({ id, kind, label, status, confidence: value, evidenceIds }) => ({
			id,
			kind,
			label,
			status,
			confidence: value,
			evidenceIds: [...evidenceIds],
		})),
		edges: state.targetGraph.edges
			.filter((edge) => selectedIds.has(edge.fromNodeId) && selectedIds.has(edge.toNodeId))
			.map((edge) => ({ ...edge, evidenceIds: [...edge.evidenceIds] })),
		openNodeIds: nodes.filter((node) => node.status === "hypothesis").map((node) => node.id),
		deadEndNodeIds: nodes
			.filter((node) => node.status === "dead-end" || node.status === "rejected")
			.map((node) => node.id),
	};
}
