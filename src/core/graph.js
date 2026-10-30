// The notes graph: every parsed file, and the indexes built from them.
//
// This plays org-mem's part.  Files go in (setFile) and come out
// (removeFile); the derived tables (nodes by ID, backlinks by target) are
// rebuilt lazily the next time something asks, so indexing a hundred files
// costs one rebuild, not a hundred.

import { haystackOf } from "./match.js";
import { idAtLine } from "./org.js";

export class Graph {
  constructor() {
    /** url -> { url, root, rel, parsed } */
    this.files = new Map();
    this.#dirty = true;
  }

  #dirty;
  #byId = new Map();
  #nodes = [];
  #backlinks = new Map();
  #duplicates = [];

  setFile(url, { root, rel, parsed }) {
    this.files.set(url, { url, root, rel, parsed });
    this.#dirty = true;
  }

  removeFile(url) {
    if (this.files.delete(url)) this.#dirty = true;
  }

  /** Forget every file under ROOT (a graph folder that was removed). */
  removeRoot(root) {
    for (const [url, file] of this.files) if (file.root === root) this.files.delete(url);
    this.#dirty = true;
  }

  clear() {
    this.files.clear();
    this.#dirty = true;
  }

  #rebuild() {
    if (!this.#dirty) return;
    this.#byId = new Map();
    this.#nodes = [];
    this.#backlinks = new Map();
    this.#duplicates = [];
    // Files in path order, so "first ID wins" does not depend on the order
    // files happened to finish reading.
    const files = [...this.files.values()].sort((a, b) => (a.url < b.url ? -1 : a.url > b.url ? 1 : 0));
    for (const file of files) {
      for (const node of file.parsed.nodes) {
        if (this.#byId.has(node.id)) {
          this.#duplicates.push({ id: node.id, url: file.url, line: node.line });
          continue;
        }
        const full = { ...node, url: file.url, root: file.root, rel: file.rel };
        full._haystack = haystackOf(full);
        this.#byId.set(node.id, full);
        this.#nodes.push(full);
      }
    }
    for (const file of files) {
      for (const link of file.parsed.links) {
        const list = this.#backlinks.get(link.target) ?? [];
        list.push({ ...link, url: file.url, rel: file.rel, root: file.root });
        this.#backlinks.set(link.target, list);
      }
    }
    this.#dirty = false;
  }

  get nodes() {
    this.#rebuild();
    return this.#nodes;
  }

  /** IDs found more than once; only the first is used, as in org-mem. */
  get duplicates() {
    this.#rebuild();
    return this.#duplicates;
  }

  get(id) {
    this.#rebuild();
    return this.#byId.get(id) ?? null;
  }

  /**
   * The links pointing at ID, each with the note it sits in (null when the
   * link is in a file and heading without any ID), grouped by that note.
   * A link from a note to itself is left out, as org-node-context does.
   */
  backlinks(id) {
    this.#rebuild();
    const groups = new Map();
    for (const link of this.#backlinks.get(id) ?? []) {
      if (link.origin === id) continue;
      const key = link.origin ?? `file:${link.url}`;
      if (!groups.has(key)) groups.set(key, { from: link.origin ? this.get(link.origin) : null, url: link.url, rel: link.rel, links: [] });
      groups.get(key).links.push(link);
    }
    return [...groups.values()].sort((a, b) => titleOf(a).localeCompare(titleOf(b)));
  }

  /** The ID of the note at LINE (0-based) of the file at URL, if indexed. */
  idAt(url, line) {
    const file = this.files.get(url);
    return file ? idAtLine(file.parsed, line) : null;
  }

  /** [tag, number of notes] pairs, sorted by tag. */
  tagCounts() {
    const counts = new Map();
    for (const node of this.nodes) for (const tag of node.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
    return [...counts].sort((a, b) => a[0].localeCompare(b[0]));
  }

  /**
   * kittymacs' tag index (SPC n T): each tag with its notes.  A file note is
   * listed under its file tags; a heading note only under the tags its file
   * note lacks, so a page tagged `machine` appears once under machine, not
   * once per heading.  File notes first, then headings in file order.
   */
  taggedNotes() {
    const nodes = [...this.nodes].sort((a, b) => (a.url === b.url ? a.line - b.line : a.url < b.url ? -1 : 1));
    const fileTags = new Set();
    for (const node of nodes) if (node.level === 0) for (const tag of node.tags) fileTags.add(`${node.url}\u0000${tag}`);
    const groups = new Map();
    for (const node of nodes) {
      for (const tag of node.tags) {
        if (node.level > 0 && fileTags.has(`${node.url}\u0000${tag}`)) continue;
        if (!groups.has(tag)) groups.set(tag, []);
        groups.get(tag).push(node);
      }
    }
    return [...groups]
      .map(([tag, list]) => [tag, [...list.filter((n) => n.level === 0), ...list.filter((n) => n.level > 0)]])
      .sort((a, b) => a[0].localeCompare(b[0]));
  }

  /** Plain data for the cache file. */
  toJSON() {
    return [...this.files.values()];
  }
}

function titleOf(group) {
  return group.from?.title ?? group.rel;
}
