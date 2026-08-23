import { StringEnum } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { readAuditRecords } from "../secagent/core/audit.ts";
import { replaySecurityState } from "../secagent/core/state.ts";
import { buildSecurityReportJson, buildSecurityReportMarkdown } from "../secagent/report/generator.ts";

const ReportFormats = ["markdown", "json"] as const;

const SecurityReportParams = Type.Object({
	format: Type.Optional(StringEnum(ReportFormats)),
	title: Type.Optional(Type.String({ description: "Optional report title" })),
	includeAudit: Type.Optional(Type.Boolean({ description: "Include recent tool audit records" })),
	auditLimit: Type.Optional(Type.Number({ minimum: 0, maximum: 500 })),
});

export default function securityReportExtension(pi: ExtensionAPI) {
	pi.registerTool({
		name: "security_report",
		label: "Security Report",
		description:
			"Generate a reproducible Markdown or JSON report from the current SecAgent state, decisions, evidence, findings, and tool audit timeline.",
		promptSnippet: "security_report: generate a reproducible security task report from SecAgent state and audit",
		parameters: SecurityReportParams,
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const state = replaySecurityState(ctx);
			const audit = readAuditRecords(ctx);
			const options = {
				title: params.title,
				includeAudit: params.includeAudit ?? true,
				auditLimit: params.auditLimit,
			};
			const format = params.format ?? "markdown";
			const report =
				format === "json"
					? buildSecurityReportJson(state, audit, options)
					: buildSecurityReportMarkdown(state, audit, options);
			return { content: [{ type: "text", text: report }], details: { format, stateRevision: state.revision } };
		},
	});

	pi.registerCommand("sec-report", {
		description: "Generate the current SecAgent report (markdown or json)",
		handler: async (args, ctx) => {
			const requested = args.trim().toLowerCase();
			const format = requested === "json" ? "json" : "markdown";
			const state = replaySecurityState(ctx);
			const audit = readAuditRecords(ctx);
			const report =
				format === "json"
					? buildSecurityReportJson(state, audit)
					: buildSecurityReportMarkdown(state, audit);

			if (ctx.hasUI) {
				await ctx.ui.editor(`SecAgent report (${format})`, report);
				return;
			}
			ctx.ui.notify(report, "info");
		},
	});
}
