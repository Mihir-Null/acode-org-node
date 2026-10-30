// Build the plugin: bundle src/ into build/main.js, then pack dist/plugin.zip.
//
//   node build.mjs          build once
//   node build.mjs --watch  rebuild on every change (no zip)
//
// Acode installs a plugin from a zip holding plugin.json, the main script
// and the files plugin.json names, all at the zip's root.

import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { crc32, deflateRawSync } from "node:zlib";
import * as esbuild from "esbuild";

const watch = process.argv.includes("--watch");

const options = {
  entryPoints: ["src/main.js"],
  outfile: "build/main.js",
  bundle: true,
  format: "iife",
  // Android System WebView updates with Chrome; this is well below current.
  target: ["chrome100"],
  loader: { ".css": "text" },
  legalComments: "none",
  logLevel: "info",
};

if (watch) {
  const context = await esbuild.context(options);
  await context.watch();
} else {
  await esbuild.build(options);
  mkdirSync("dist", { recursive: true });
  for (const file of ["plugin.json", "icon.png", "readme.md", "changelogs.md"]) copyFileSync(file, `build/${file}`);
  const files = ["plugin.json", "main.js", "icon.png", "readme.md", "changelogs.md"];
  writeFileSync("dist/plugin.zip", zip(files.map((name) => [name, readFileSync(`build/${name}`)])));
  console.log(`dist/plugin.zip: ${files.join(", ")}`);
}

/**
 * A minimal zip writer: one deflated entry per file, then the central
 * directory.  See PKWARE's APPNOTE.TXT, sections 4.3.7 (local header),
 * 4.3.12 (central directory header) and 4.3.16 (end of central directory).
 */
function zip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  // 1980-01-01 00:00, the earliest DOS date: builds stay byte-identical.
  const dosTime = 0;
  const dosDate = (1 << 5) | 1;
  for (const [name, data] of entries) {
    const nameBytes = Buffer.from(name, "utf8");
    const compressed = deflateRawSync(data, { level: 9 });
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); // local file header signature
    local.writeUInt16LE(20, 4); // version needed: 2.0 (deflate)
    local.writeUInt16LE(0x0800, 6); // flags: names are UTF-8
    local.writeUInt16LE(8, 8); // method: deflate
    local.writeUInt16LE(dosTime, 10);
    local.writeUInt16LE(dosDate, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    local.writeUInt16LE(0, 28); // no extra field
    locals.push(local, nameBytes, compressed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); // central directory signature
    central.writeUInt16LE(20, 4); // version made by
    central.writeUInt16LE(20, 6); // version needed
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(dosTime, 12);
    central.writeUInt16LE(dosDate, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    // extra, comment, disk number, internal and external attributes: 0
    central.writeUInt32LE(offset, 42); // where the local header starts
    centrals.push(central, nameBytes);
    offset += local.length + nameBytes.length + compressed.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); // end of central directory signature
  end.writeUInt16LE(entries.length, 8); // entries on this disk
  end.writeUInt16LE(entries.length, 10); // entries in total
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16); // where the central directory starts
  return Buffer.concat([...locals, directory, end]);
}
