import { writeFile } from "node:fs/promises";

const outputPath = process.argv[2] ?? new URL("./sample.png", import.meta.url).pathname;

function chunk(type, data) {
	const typeBytes = Buffer.from(type, "ascii");
	const payload = Buffer.concat([typeBytes, data]);
	let crc = 0xffffffff;
	for (const byte of payload) {
		crc ^= byte;
		for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
	}
	const checksum = Buffer.alloc(4);
	checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
	const length = Buffer.alloc(4);
	length.writeUInt32BE(data.length);
	return Buffer.concat([length, payload, checksum]);
}

const header = Buffer.from("89504e470d0a1a0a", "hex");
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(1, 0);
ihdr.writeUInt32BE(1, 4);
ihdr[8] = 8;
ihdr[9] = 6;
const text = Buffer.from("Comment\0pi-secagent-fixture", "latin1");
const idat = Buffer.from([0x78, 0x9c, 0x63, 0x60, 0x60, 0xf8, 0xcf, 0xc0, 0xf0, 0x1f, 0x00, 0x05, 0x00, 0x01, 0xff]);
const png = Buffer.concat([header, chunk("IHDR", ihdr), chunk("tEXt", text), chunk("IDAT", idat), chunk("IEND", Buffer.alloc(0))]);

await writeFile(outputPath, png, { mode: 0o644 });
process.stdout.write(`wrote deterministic PNG fixture to ${outputPath}\n`);
