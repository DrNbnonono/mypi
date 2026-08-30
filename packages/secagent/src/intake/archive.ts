import { spawnSync } from "node:child_process";
import {
	existsSync,
	lstatSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, extname, isAbsolute, join, normalize, relative, sep } from "node:path";

export interface ArchiveLimits {
	maxFiles: number;
	maxTotalBytes: number;
	maxEntryBytes: number;
	maxDepth: number;
}

export const DEFAULT_ARCHIVE_LIMITS: ArchiveLimits = {
	maxFiles: 512,
	maxTotalBytes: 256 * 1024 * 1024,
	maxEntryBytes: 64 * 1024 * 1024,
	maxDepth: 8,
};

export function validateArchiveEntries(entries: string[], limits: ArchiveLimits = DEFAULT_ARCHIVE_LIMITS): string[] {
	if (entries.length > limits.maxFiles)
		throw new Error(`Archive contains ${entries.length} entries; limit is ${limits.maxFiles}`);
	return entries.map((entry) => {
		const portable = entry.replaceAll("\\", "/").replace(/^\.\//, "");
		const normalized = normalize(portable).replaceAll("\\", "/");
		if (
			!portable ||
			portable.includes("\0") ||
			isAbsolute(portable) ||
			normalized === ".." ||
			normalized.startsWith("../")
		)
			throw new Error(`Unsafe archive entry path: ${entry}`);
		const depth = normalized.split("/").filter(Boolean).length;
		if (depth > limits.maxDepth) throw new Error(`Archive entry exceeds nesting limit: ${entry}`);
		return normalized;
	});
}

function listArchive(archivePath: string): { format: "zip" | "tar"; entries: string[] } {
	const extension = extname(archivePath).toLowerCase();
	const isZip = extension === ".zip";
	const command = isZip ? "unzip" : "tar";
	const args = isZip ? ["-Z1", archivePath] : ["-tf", archivePath];
	const result = spawnSync(command, args, { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });
	if (result.error) throw new Error(`Archive listing tool unavailable: ${command}`);
	if (result.status !== 0)
		throw new Error(`Invalid or unsupported archive: ${result.stderr.trim() || basename(archivePath)}`);
	return { format: isZip ? "zip" : "tar", entries: result.stdout.split(/\r?\n/).filter(Boolean) };
}

function inspectTree(root: string, limits: ArchiveLimits): { files: number; totalBytes: number } {
	let files = 0;
	let totalBytes = 0;
	const pending = [root];
	while (pending.length > 0) {
		const directory = pending.pop();
		if (!directory) continue;
		for (const name of readdirSync(directory)) {
			const path = join(directory, name);
			const stat = lstatSync(path);
			if (stat.isSymbolicLink())
				throw new Error(`Archive extraction produced a symbolic link: ${relative(root, path)}`);
			if (stat.isDirectory()) {
				pending.push(path);
				continue;
			}
			if (!stat.isFile())
				throw new Error(`Archive extraction produced an unsupported entry: ${relative(root, path)}`);
			files += 1;
			totalBytes += stat.size;
			if (files > limits.maxFiles || stat.size > limits.maxEntryBytes || totalBytes > limits.maxTotalBytes)
				throw new Error("Archive extraction exceeds configured limits");
			const relativePath = relative(root, path);
			if (relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath))
				throw new Error("Archive extraction escaped the temporary directory");
		}
	}
	return { files, totalBytes };
}

export function extractArchiveSafely(
	archivePath: string,
	limits: ArchiveLimits = DEFAULT_ARCHIVE_LIMITS,
): { directory: string; files: number; totalBytes: number } {
	if (!existsSync(archivePath) || !statSync(archivePath).isFile())
		throw new Error(`Archive not found: ${archivePath}`);
	const listing = listArchive(archivePath);
	validateArchiveEntries(listing.entries, limits);
	const directory = mkdtempSync(join(tmpdir(), "pi-secagent-archive-"));
	mkdirSync(directory, { recursive: true });
	writeFileSync(join(directory, ".pi-secagent-owned"), "owned\n");
	try {
		const result =
			listing.format === "zip"
				? spawnSync("unzip", ["-qq", archivePath, "-d", directory], {
						encoding: "utf8",
						maxBuffer: 8 * 1024 * 1024,
					})
				: spawnSync("tar", ["-xf", archivePath, "-C", directory, "--no-same-owner", "--no-same-permissions"], {
						encoding: "utf8",
						maxBuffer: 8 * 1024 * 1024,
					});
		if (result.error || result.status !== 0)
			throw new Error(
				`Archive extraction failed: ${result.stderr?.trim() || result.error?.message || basename(archivePath)}`,
			);
		const summary = inspectTree(directory, limits);
		return { directory, ...summary };
	} catch (error) {
		if (readFileSync(join(directory, ".pi-secagent-owned"), "utf8") === "owned\n")
			rmSync(directory, { recursive: true, force: true });
		throw error;
	}
}
