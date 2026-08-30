import { NextResponse } from "next/server";
import { getRpcSession, startRpcSession } from "@/lib/rpc-manager";
import { resolveSessionPath } from "@/lib/session-reader";

async function resolveProfileSession(id: string) {
	const existing = getRpcSession(id);
	if (existing?.isAlive()) return existing;
	const filePath = await resolveSessionPath(id);
	if (!filePath) return null;
	return (await startRpcSession(id, filePath, undefined)).session;
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
	try {
		const { id } = await params;
		const session = await resolveProfileSession(id);
		if (!session) return NextResponse.json({ error: "Session not found" }, { status: 404 });
		return NextResponse.json({ agentMode: session.agentMode, profileState: await session.send({ type: "profile_snapshot" }) });
	} catch (error) {
		return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
	}
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
	try {
		const { id } = await params;
		const command = await req.json() as Record<string, unknown>;
		const session = await resolveProfileSession(id);
		if (!session) return NextResponse.json({ error: "Session not found" }, { status: 404 });
		const data = await session.send({ type: "profile_command", command });
		return NextResponse.json({ success: true, data });
	} catch (error) {
		return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
	}
}
