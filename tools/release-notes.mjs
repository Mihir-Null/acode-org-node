// The release notes for a version: its section of changelogs.md.
//
//   node tools/release-notes.mjs 0.3.1 > notes.md
//
// The Publish workflow uses it when a pushed tag creates the GitHub release,
// so the release says what the store's changelog says.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** The body of the "## VERSION" section of CHANGELOG (markdown), or null. */
export function releaseNotes(changelog, version) {
  const lines = changelog.split("\n");
  const start = lines.findIndex((line) => line.trim() === `## ${version}`);
  if (start === -1) return null;
  let end = lines.findIndex((line, i) => i > start && /^## /.test(line));
  if (end === -1) end = lines.length;
  return lines.slice(start + 1, end).join("\n").trim();
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const version = process.argv[2];
  const notes = releaseNotes(readFileSync("changelogs.md", "utf8"), version);
  if (!notes) {
    console.error(`changelogs.md has no "## ${version}" section`);
    process.exit(1);
  }
  console.log(notes);
}
