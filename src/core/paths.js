// Which files of a graph folder are notes, and where they sit in it.
//
// Acode names files by URL, not by path.  Two kinds matter here:
//
//   file:///storage/emulated/0/notes/loop.org
//   content://com.termux.documents/tree/%2Fdata%2F...%2FEmptyNet::/data/.../EmptyNet/wiki/loop.org
//
// The second is Android's Storage Access Framework (SAF): a "tree" URL for
// the folder you granted Acode, then "::" and the document's own ID, which
// for Termux is its real path.  Everything below works on paths *relative to
// the graph folder*, so both kinds behave the same.

export const NOTE_SUFFIXES = [".org", ".org_archive"];

// Upstream's org-mem-exclude: literal substrings of a path that are never read.
export const ORG_MEM_EXCLUDE = [
  "/logseq/bak/",
  "/logseq/version-files/",
  "/node_modules/",
  ".sync-conflict-",
  "/backup",
  "/.#",
];

/** Whether NAME ends in a suffix org-mem reads. */
export function isNoteFileName(name) {
  return NOTE_SUFFIXES.some((suffix) => name.endsWith(suffix));
}

/**
 * The path a URL names on disk, as best it can be told from the URL.
 * For a SAF URL that is the document ID after "::", or the decoded tree ID.
 */
export function urlPath(url) {
  if (url.startsWith("content://")) {
    const sep = url.indexOf("::");
    if (sep !== -1) return url.slice(sep + 2);
    const tree = /\/tree\/([^/]+)/.exec(url);
    if (tree) return decodeURIComponent(tree[1]);
    return decodeURIComponent(url);
  }
  if (url.startsWith("file://")) return decodeURIComponent(url.slice("file://".length));
  return url;
}

/**
 * FILE's path relative to the folder ROOT, both URLs, or null when FILE is
 * not inside ROOT.  "primary:Documents/notes" style IDs work too: only the
 * prefix relation matters.
 */
export function relativePath(rootUrl, fileUrl) {
  const root = urlPath(rootUrl).replace(/\/+$/, "");
  const file = urlPath(fileUrl);
  if (file === root) return "";
  if (file.startsWith(`${root}/`)) return file.slice(root.length + 1);
  // A tree URL whose ID ends in ":" (a whole volume, "primary:").
  if (root.endsWith(":") && file.startsWith(root)) return file.slice(root.length);
  return null;
}

/** A folder name as kittymacs-org-node-excluded-directories writes it. */
function normaliseDir(dir) {
  return dir.replace(/^\.?\/+/, "").replace(/\/+$/, "");
}

/**
 * Whether the file or folder at relative path REL is skipped.
 *
 * Upstream's rules, applied *below* the graph folder:
 *   - any folder or file whose name starts with "." or "_";
 *   - the substrings in org-mem-exclude;
 * and kittymacs' own: the folders in EXCLUDED, relative to the graph folder
 * ("secrets" skips ROOT/secrets/ and everything under it).
 *
 * org-mem applies the first rule to the whole path, which on a phone would
 * skip everything under Termux's /data/data/... or a ".config" folder; here
 * it applies only inside the folder you chose.
 */
export function isExcluded(rel, excluded = []) {
  if (rel === "") return false;
  const segments = rel.split("/");
  if (segments.some((segment) => segment.startsWith(".") || segment.startsWith("_"))) return true;
  const slashed = `/${rel}`;
  if (ORG_MEM_EXCLUDE.some((part) => slashed.includes(part))) return true;
  return excluded.some((dir) => {
    const d = normaliseDir(dir);
    return d !== "" && (rel === d || rel.startsWith(`${d}/`));
  });
}

/** Whether the file at relative path REL is a note the graph reads. */
export function isNoteFile(rel, excluded = []) {
  const name = rel.slice(rel.lastIndexOf("/") + 1);
  return isNoteFileName(name) && !isExcluded(rel, excluded);
}

/** The last component of a URL's path: "loop.org". */
export function baseName(url) {
  const path = urlPath(url).replace(/\/+$/, "");
  return path.slice(path.lastIndexOf("/") + 1);
}
