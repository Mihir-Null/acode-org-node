import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { releaseNotes } from "../tools/release-notes.mjs";

test("release notes are the version's changelog section", () => {
  const changelog = "# Changelog\n\n## 0.2.0\n\n- two\n- more\n\n## 0.1.0\n\n- one\n";
  assert.equal(releaseNotes(changelog, "0.2.0"), "- two\n- more");
  assert.equal(releaseNotes(changelog, "0.1.0"), "- one");
  assert.equal(releaseNotes(changelog, "0.1"), null);
});

test("the current version has release notes", () => {
  const { version } = JSON.parse(readFileSync("plugin.json", "utf8"));
  assert.ok(releaseNotes(readFileSync("changelogs.md", "utf8"), version)?.length > 0);
});
