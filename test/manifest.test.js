// plugin.json against the rules acode.app and Acode apply to it, so a bad
// manifest fails here rather than at upload.

import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";
import { test } from "node:test";

const manifest = JSON.parse(readFileSync("plugin.json", "utf8"));

test("the id uses only letters, digits, dots and underscores", () => {
  assert.match(manifest.id, /^[A-Za-z0-9._]+$/);
});

test("the version is dotted numbers, and the changelog has a section for it", () => {
  assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
  assert.match(readFileSync(manifest.changelogs, "utf8"), new RegExp(`^## ${manifest.version.replace(/\./g, "\\.")}$`, "m"));
});

test("the files it names exist; the icon is a PNG of at most 50 KB", () => {
  for (const file of [manifest.readme, manifest.icon, manifest.changelogs]) assert.ok(existsSync(file), file);
  assert.equal(manifest.main, "main.js"); // build.mjs writes build/main.js and zips it as main.js
  assert.deepEqual([...readFileSync(manifest.icon).subarray(1, 4)].map((b) => String.fromCharCode(b)).join(""), "PNG");
  assert.ok(statSync(manifest.icon).size <= 50 * 1024);
});

test("it is free, so it may name its repository", () => {
  assert.equal(manifest.price, 0);
  assert.match(manifest.repository, /^https:\/\/github\.com\//);
});
