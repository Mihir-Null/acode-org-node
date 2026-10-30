// Finding and reading the graph's files on Android.
//
// Reading storage from a WebView is the slow part of indexing, so this module
// does as little of it as it can:
//
//   1. Listing: Acode (versionCode 1002+) keeps a native SQLite index of the
//      folders you open (fileIndex).  Asking it for "*.org" is one query
//      instead of a directory walk over the Storage Access Framework.  On
//      older builds, or for folders it cannot index, it walks with lsDir.
//   2. Reading: each file's parse is cached with its modification time and
//      size.  A file whose listing shows the same two values is not read
//      again, so a re-index after `git pull` reads only what changed.

import { interpretDirLocals } from "../core/elisp.js";
import { parseOrg } from "../core/org.js";
import { baseName, isExcluded, isNoteFile, isNoteFileName, relativePath } from "../core/paths.js";

// Bump when parse output changes shape, so stale caches are dropped.
export const CACHE_VERSION = 1;
const READ_CONCURRENCY = 6;

/** Run FN over ITEMS, at most LIMIT at a time. */
export async function pool(items, limit, fn) {
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const item = items[next++];
      await fn(item);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

/**
 * What ROOT's .dir-locals.el says, or null when it has none or it cannot
 * be read.  ENV.join is Acode's Url.join, which knows SAF's "::" form.
 */
export async function readDirLocals(env, rootUrl) {
  try {
    const file = env.fs(env.join(rootUrl, ".dir-locals.el"));
    if (!(await file.exists())) return null;
    return interpretDirLocals(await file.readFile("utf-8"));
  } catch (error) {
    console.warn("[org-node] cannot read .dir-locals.el in", rootUrl, error);
    return null;
  }
}

async function listWithIndex(env, root) {
  const { fileIndex } = env;
  if (!env.isOpenFolder(root.url) && !env.scanned.has(root.url)) {
    // A remembered project that is not open in the sidebar: index it once.
    env.scanned.add(root.url);
    await fileIndex.scan({ url: root.url, name: baseName(root.url) }, { indexContent: false });
  }
  await fileIndex.whenReady?.([root.url]);
  const files = [];
  let cursor = 0;
  for (;;) {
    const page = await fileIndex.query({ roots: [root.url], text: ".org", limit: 1000, cursor });
    for (const entry of page.entries ?? []) {
      if (entry.isDirectory || !isNoteFileName(entry.name)) continue;
      const rel = relativePath(root.url, entry.url ?? entry.uri) ?? entry.path?.split("/").slice(1).join("/");
      if (rel == null || !isNoteFile(rel, root.excluded)) continue;
      files.push({ url: entry.url ?? entry.uri, rel, mtime: entry.modifiedDate ?? null, size: entry.size ?? null });
    }
    if (!page.hasMore) return files;
    cursor = page.cursor;
  }
}

async function listByWalking(env, root) {
  const files = [];
  let queue = [{ url: root.url, rel: "" }];
  while (queue.length) {
    const level = queue;
    queue = [];
    await pool(level, 8, async (dir) => {
      let entries;
      try {
        entries = await env.fs(dir.url).lsDir();
      } catch (error) {
        console.warn("[org-node] cannot list", dir.url, error);
        return;
      }
      for (const entry of entries) {
        const rel = dir.rel ? `${dir.rel}/${entry.name}` : entry.name;
        if (isExcluded(rel, root.excluded)) continue;
        if (entry.isDirectory) queue.push({ url: entry.url, rel });
        else if (isNoteFile(rel, root.excluded))
          files.push({ url: entry.url, rel, mtime: entry.modifiedDate ?? null, size: entry.size ?? entry.length ?? null });
      }
    });
  }
  return files;
}

/** The note files of ROOT ({url, excluded}), as {url, rel, mtime, size}. */
export async function listNoteFiles(env, root) {
  if (env.fileIndex?.query && env.fileIndex.supports?.(root.url)) {
    try {
      const files = await listWithIndex(env, root);
      if (files.length) return files;
      // An empty answer may mean "not indexed yet": confirm by walking.
    } catch (error) {
      console.warn("[org-node] file index failed for", root.url, error);
    }
  }
  return listByWalking(env, root);
}

/**
 * Keeps the graph in step with the files: whole roots, or one file at a time.
 */
export class Indexer {
  constructor({ graph, env }) {
    this.graph = graph;
    this.env = env;
    /** url -> { mtime, size, root, rel, parsed } */
    this.cache = new Map();
    this.running = null;
  }

  /** Fill the graph from a saved cache, before anything is read. */
  restore(json) {
    if (!json || json.version !== CACHE_VERSION || !Array.isArray(json.files)) return 0;
    for (const entry of json.files) {
      this.cache.set(entry.url, entry);
      this.graph.setFile(entry.url, entry);
    }
    return json.files.length;
  }

  toJSON() {
    return { version: CACHE_VERSION, files: [...this.cache.entries()].map(([url, entry]) => ({ url, ...entry })) };
  }

  /**
   * Re-read ROOTS: list them, read the files that changed (all of them when
   * FULL), forget the files that are gone.  Calls made while one is running
   * wait for it and then run again, so the last call always wins.
   */
  async indexRoots(roots, { full = false, onProgress } = {}) {
    while (this.running) await this.running.catch(() => {});
    this.running = this.#index(roots, { full, onProgress });
    try {
      return await this.running;
    } finally {
      this.running = null;
    }
  }

  async #index(roots, { full, onProgress }) {
    const seen = new Set();
    const jobs = [];
    for (const root of roots) {
      const files = await listNoteFiles(this.env, root);
      for (const file of files) {
        if (seen.has(file.url)) continue; // nested roots: first wins
        seen.add(file.url);
        jobs.push({ root, file });
      }
    }
    let read = 0;
    await pool(jobs, READ_CONCURRENCY, async ({ root, file }) => {
      const cached = this.cache.get(file.url);
      const unchanged = !full && cached && file.mtime != null && cached.mtime === file.mtime && cached.size === file.size;
      if (unchanged) {
        if (cached.root !== root.url || cached.rel !== file.rel) Object.assign(cached, { root: root.url, rel: file.rel });
        this.graph.setFile(file.url, cached);
        return;
      }
      try {
        const text = await this.env.fs(file.url).readFile("utf-8");
        this.#store(file.url, { root: root.url, rel: file.rel, mtime: file.mtime, size: file.size }, text);
        read++;
        onProgress?.(read, jobs.length);
      } catch (error) {
        console.warn("[org-node] cannot read", file.url, error);
      }
    });
    for (const url of [...this.graph.files.keys()]) {
      if (!seen.has(url)) {
        this.graph.removeFile(url);
        this.cache.delete(url);
      }
    }
    return { files: seen.size, read, nodes: this.graph.nodes.length };
  }

  #store(url, meta, text) {
    const parsed = parseOrg(text, { fileName: baseName(url) });
    const entry = { ...meta, parsed };
    this.cache.set(url, entry);
    this.graph.setFile(url, entry);
    return entry;
  }

  /**
   * Index one file from TEXT (the editor's, after a save) when it belongs to
   * one of ROOTS.  Returns whether it did.
   */
  async indexFile(url, text, roots) {
    let best = null;
    for (const root of roots) {
      const rel = relativePath(root.url, url);
      if (rel == null || !isNoteFile(rel, root.excluded)) continue;
      if (!best || root.url.length > best.root.url.length) best = { root, rel };
    }
    if (!best) return false;
    let stat = null;
    try {
      stat = await this.env.fs(url).stat();
    } catch {
      // keep the parse without a stamp; the next index reads it again
    }
    this.#store(url, { root: best.root.url, rel: best.rel, mtime: stat?.modifiedDate ?? null, size: stat?.size ?? null }, text);
    return true;
  }
}
