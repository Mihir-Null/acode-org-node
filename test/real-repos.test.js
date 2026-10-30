// Parse real kittymacs repositories and check the graph against a plain
// text count: every ":ID:" line is a node, and every id: link resolves.
//
// Point ORG_NODE_TEST_REPOS at checkouts (colon-separated); the test is
// skipped when none exists.  For example:
//   ORG_NODE_TEST_REPOS=~/src/kittymacs:~/src/EmptyNet npm test

import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join, relative } from "node:path";
import { test } from "node:test";

import { interpretDirLocals } from "../src/core/elisp.js";
import { Graph } from "../src/core/graph.js";
import { parseOrg } from "../src/core/org.js";
import { isExcluded, isNoteFile } from "../src/core/paths.js";

const repos = (process.env.ORG_NODE_TEST_REPOS ?? "").split(":").filter((dir) => dir && existsSync(dir));

function walk(root, excluded, dir = root, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const rel = relative(root, full);
    if (isExcluded(rel, excluded)) continue;
    if (statSync(full).isDirectory()) walk(root, excluded, full, out);
    else if (isNoteFile(rel, excluded)) out.push(full);
  }
  return out;
}

test("real repositories index completely", { skip: repos.length === 0 && "set ORG_NODE_TEST_REPOS" }, () => {
  const graph = new Graph();
  let idLines = 0;
  for (const root of repos) {
    const dirLocals = join(root, ".dir-locals.el");
    const { project, excluded } = existsSync(dirLocals)
      ? interpretDirLocals(readFileSync(dirLocals, "utf8"))
      : { project: false, excluded: [] };
    assert.ok(project, `${root} has the project flag`);
    for (const file of walk(root, excluded)) {
      const text = readFileSync(file, "utf8");
      // An :ID: property line opens no src block in these repositories.
      idLines += text.split("\n").filter((line) => /^[ \t]*:ID:[ \t]+\S/.test(line)).length;
      const parsed = parseOrg(text, { fileName: basename(file) });
      graph.setFile(`file://${file}`, { root: `file://${root}`, rel: relative(root, file), parsed });
    }
  }
  assert.equal(graph.duplicates.length, 0, JSON.stringify(graph.duplicates));
  assert.equal(graph.nodes.length, idLines);
  // Only UUID-shaped targets: the conventions pages show =[[id:…][words]]=
  // as an example, which org-mem (and so this parser) reads as a link too.
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const dangling = [];
  for (const file of graph.files.values())
    for (const link of file.parsed.links) if (uuid.test(link.target) && !graph.get(link.target)) dangling.push(`${file.rel}:${link.line + 1} ${link.target}`);
  assert.deepEqual(dangling, []);
  const linked = graph.nodes.filter((node) => graph.backlinks(node.id).length > 0).length;
  console.log(`${graph.files.size} files, ${graph.nodes.length} notes, ${linked} with backlinks, ${graph.tagCounts().length} tags`);
});
