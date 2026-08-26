/import { createJiti } from "jiti/static";
const jiti = createJiti(import.meta.url, { moduleCache: false, tsconfigPaths: true });
try {
	await jiti.import("/mnt/e/mypi/.pi/npm/node_modules/pi-sandbox/index.ts", { default: true });
	console.log("OK");
} catch (e) {
	console.log("top message:", e.message);
	console.log("---stack---");
	console.log(e.stack);
	if (e.cause) {
		console.log("---cause---");
		console.log(e.cause.stack || e.cause.message || JSON.stringify(e.cause));
	}
}