// Reading one Org file into the notes graph's terms.
//
// This is a port of the rules org-mem's parser (org-mem-parser.el) uses, cut
// down to what the graph needs.  It is deliberately not a full Org parser:
// the graph cares about four things only.
//
//   - nodes:    the file, or a heading, that carries an :ID: property;
//   - titles:   #+title: for the file, the heading text for a heading;
//   - tags:     #+filetags: and heading tags, inherited down the outline;
//   - id links: [[id:...]] (and bare id:...) links, with the note they sit in.
//
// Everything here is pure: text in, plain objects out.  The Acode side reads
// files and calls parseOrg; the tests call it with strings.

// kittymacs' org-todo-keywords (literate/70-org.org).  A file can add its own
// with #+todo: lines, exactly as in Emacs.
export const DEFAULT_TODO_KEYWORDS = ["TODO", "NEXT", "WAITING", "DONE", "CANCELED"];

const HEADING_RE = /^(\*+)[ \t]+(.*)$/;
const DRAWER_START_RE = /^[ \t]*:PROPERTIES:[ \t]*$/i;
const DRAWER_END_RE = /^[ \t]*:END:[ \t]*$/i;
const PROPERTY_RE = /^[ \t]*:([^:\s]+):(?:[ \t]+(.*?))?[ \t]*$/;
const KEYWORD_RE = /^[ \t]*#\+([A-Za-z_]+):[ \t]*(.*?)[ \t]*$/;
const PLANNING_RE = /^[ \t]*(?:CLOSED|DEADLINE|SCHEDULED):/;
const COMMENT_LINE_RE = /^[ \t]*#( |$)/;
const BLANK_RE = /^[ \t]*$/;

// Regions org-mem never scans for links (org-mem-ignore-regions-regexps):
// code and example blocks, comment blocks, and some single lines.
const IGNORED_BLOCK_RE = /^[ \t]*#\+begin_(src|example|comment)\b/i;
const IGNORED_LINE_RE =
  /^[ \t]*(?::ROAM_REFS:|:BACKLINKS:|#\+transclude:)|^[ \t]*(?:CLOSED|DEADLINE|SCHEDULED):/i;

// [[target][description]] or [[target]].  The description may hold single
// brackets, so it is matched lazily up to the first "]]".
const BRACKET_LINK_RE = /\[\[([^\[\]]+)\](?:\[(.+?)\])?\]/g;
// A bare id: link, not glued to a word before it.
const PLAIN_ID_LINK_RE = /(^|[^\w:/.-])id:([0-9A-Za-z][0-9A-Za-z_.-]*)/g;

/**
 * Org's org-link-display-format: show links as their descriptions.
 * "[[id:x][The loop]] notes" becomes "The loop notes".
 */
export function linkDisplayFormat(text) {
  return text.replace(BRACKET_LINK_RE, (_m, target, desc) => desc ?? target);
}

/** Split "a:b:c" tag strings the way org-mem does: empty parts dropped. */
function splitTags(text) {
  return text.split(":").filter((tag) => tag.length > 0);
}

/**
 * ROAM_ALIASES holds space-separated aliases, an alias with spaces quoted:
 *   :ROAM_ALIASES: "Nix flakes" flake
 */
export function splitAliases(text) {
  if (!text) return [];
  const aliases = [];
  const re = /"((?:[^"\\]|\\.)*)"|(\S+)/g;
  for (const match of text.matchAll(re)) {
    aliases.push(match[1] !== undefined ? match[1].replace(/\\(.)/g, "$1") : match[2]);
  }
  return aliases;
}

/**
 * Read a property drawer whose :PROPERTIES: line is lines[start].
 * Returns the properties (upper-case keys) and the index of the :END: line,
 * or null when the drawer is never closed (the file is then malformed, and
 * Org would not see the drawer either).
 */
function readDrawer(lines, start) {
  const properties = {};
  for (let i = start + 1; i < lines.length; i++) {
    if (DRAWER_END_RE.test(lines[i])) return { properties, end: i };
    if (HEADING_RE.test(lines[i])) return null;
    const match = PROPERTY_RE.exec(lines[i]);
    if (!match) continue;
    let key = match[1].toUpperCase();
    const value = match[2] ?? "";
    // KEY+ appends to KEY, as in Org.
    if (key.endsWith("+")) {
      key = key.slice(0, -1);
      properties[key] = properties[key] ? `${properties[key]} ${value}` : value;
    } else if (!(key in properties)) {
      properties[key] = value;
    }
  }
  return null;
}

/** The TODO keywords a #+todo: line declares ("TODO(t) | DONE(d)"). */
function todoWordsFrom(value) {
  return value
    .split(/\s+/)
    .filter((word) => word && word !== "|")
    .map((word) => word.replace(/\(.*\)$/, ""));
}

/**
 * Take a heading's text apart: TODO keyword, priority, title and tags.
 * "TODO [#A] [1/3] Fix the loop [50%] :nix:decision:"
 *   -> { todo: "TODO", title: "Fix the loop", tags: ["nix", "decision"] }
 * Statistics cookies at either end are left out of the title (org-mem #22).
 */
export function parseHeadingText(text, todoKeywords) {
  let rest = text;
  let todo = null;
  const firstWord = /^(\S+)(?:[ \t]+|$)/.exec(rest);
  if (firstWord && todoKeywords.includes(firstWord[1])) {
    todo = firstWord[1];
    rest = rest.slice(firstWord[0].length);
  }
  rest = rest.replace(/^\[#[A-Z0-9]+\][ \t]*/, "");
  rest = rest.replace(/^(?:\[[0-9/%]+\][ \t]*)+/, "");

  let tags = [];
  const tagMatch = /(^|[ \t]+):([^ \t]+):[ \t]*$/.exec(rest);
  if (tagMatch) {
    tags = splitTags(tagMatch[2]);
    rest = rest.slice(0, tagMatch.index);
  }
  rest = rest.replace(/(?:[ \t]*\[[0-9/%]+\])+[ \t]*$/, "");
  // TITLE shows links as their words, for searching; RAWTITLE keeps them, for the preview.
  return { todo, title: linkDisplayFormat(rest).trim(), rawTitle: rest.trim(), tags };
}

/**
 * Find the id: links on one line.  Bracket links first; their spans are then
 * blanked so that a bare id: inside one is not counted twice.
 */
export function findIdLinks(line) {
  const links = [];
  let masked = line;
  for (const match of line.matchAll(BRACKET_LINK_RE)) {
    const target = match[1];
    masked =
      masked.slice(0, match.index) + " ".repeat(match[0].length) + masked.slice(match.index + match[0].length);
    if (!/^id:/i.test(target)) continue;
    links.push({
      id: stripSearchOption(target.slice(3)),
      desc: match[2] ?? null,
      col: match.index,
      end: match.index + match[0].length,
    });
  }
  for (const match of masked.matchAll(PLAIN_ID_LINK_RE)) {
    const col = match.index + match[1].length;
    links.push({ id: stripSearchOption(match[2]), desc: null, col, end: col + 3 + match[2].length });
  }
  return links.sort((a, b) => a.col - b.col);
}

/** id:UUID::search (Org 9.7's org-id-link-use-context) points at UUID. */
function stripSearchOption(path) {
  const chop = path.indexOf("::");
  return (chop === -1 ? path : path.slice(0, chop)).trim();
}

/** A line of context for the backlinks panel: links shown as their words. */
function contextOf(line) {
  const text = linkDisplayFormat(line).trim().replace(/\s+/g, " ");
  return text.length > 240 ? `${text.slice(0, 237)}…` : text;
}

/**
 * Parse an Org file.
 *
 * @param {string} text the file's contents
 * @param {object} [options]
 * @param {string} [options.fileName] its base name, the title of a file
 *   note without #+title: (org-mem-entry-title does the same)
 * @param {string[]} [options.todoKeywords]
 * @returns {{
 *   title: string,
 *   fileId: string|null,
 *   nodes: Array<object>,
 *   headings: Array<{line:number, level:number, id:string|null}>,
 *   links: Array<object>,
 * }}
 *   Line numbers are 0-based.  `headings` lists every heading, with or
 *   without an ID, so the editor can tell which note the cursor is in.
 */
export function parseOrg(text, { fileName = "", todoKeywords = DEFAULT_TODO_KEYWORDS } = {}) {
  const lines = text.split(/\r?\n/);
  const firstHeading = lines.findIndex((line) => HEADING_RE.test(line));
  const frontEnd = firstHeading === -1 ? lines.length : firstHeading;

  // --- The front matter: everything before the first heading. ----------
  let fileProperties = {};
  let start = 0;
  while (start < frontEnd && (BLANK_RE.test(lines[start]) || COMMENT_LINE_RE.test(lines[start]))) start++;
  if (start < frontEnd && DRAWER_START_RE.test(lines[start])) {
    const drawer = readDrawer(lines, start);
    if (drawer) fileProperties = drawer.properties;
  }

  let fileTitle = null;
  let fileTags = [];
  let todo = [...todoKeywords];
  for (let i = 0; i < frontEnd; i++) {
    const match = KEYWORD_RE.exec(lines[i]);
    if (!match) continue;
    const key = match[1].toLowerCase();
    if (key === "title" && fileTitle === null && match[2]) fileTitle = linkDisplayFormat(match[2]).trim();
    else if (key === "filetags" && fileTags.length === 0) fileTags = splitTags(match[2]);
    else if (key === "todo" || key === "seq_todo" || key === "typ_todo") todo.push(...todoWordsFrom(match[2]));
  }
  // #+todo: may also appear further down; Org honours it anywhere.
  for (let i = frontEnd; i < lines.length; i++) {
    const match = KEYWORD_RE.exec(lines[i]);
    if (match && /^(seq_|typ_)?todo$/i.test(match[1])) todo.push(...todoWordsFrom(match[2]));
  }

  const fileId = fileProperties.ID || null;
  const title = fileTitle || fileName;
  const nodes = [];
  if (fileId) {
    nodes.push({
      id: fileId,
      title,
      level: 0,
      line: 0,
      todo: null,
      tags: [...fileTags],
      ownTags: [...fileTags],
      aliases: splitAliases(fileProperties.ROAM_ALIASES),
      olp: [],
      properties: fileProperties,
    });
  }

  // --- Headings, and the links between them. --------------------------
  const headings = [];
  const links = [];
  // The outline above the current line: one frame per open heading.
  const stack = [];
  let inIgnoredBlock = null;

  const nearestId = () => {
    for (let i = stack.length - 1; i >= 0; i--) if (stack[i].id) return stack[i].id;
    return fileId;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const heading = HEADING_RE.exec(line);
    if (heading) {
      // A heading ends any block: Org does not let blocks span headings.
      inIgnoredBlock = null;
      const level = heading[1].length;
      while (stack.length && stack[stack.length - 1].level >= level) stack.pop();
      const parts = parseHeadingText(heading[2], todo);

      // The property drawer comes right after the heading, or after its
      // planning line (SCHEDULED: and friends).
      let drawerLine = i + 1;
      if (drawerLine < lines.length && PLANNING_RE.test(lines[drawerLine])) drawerLine++;
      let properties = {};
      if (drawerLine < lines.length && DRAWER_START_RE.test(lines[drawerLine])) {
        const drawer = readDrawer(lines, drawerLine);
        if (drawer) properties = drawer.properties;
      }

      const inherited = [];
      for (const tag of fileTags) if (!inherited.includes(tag)) inherited.push(tag);
      for (const frame of stack) for (const tag of frame.tags) if (!inherited.includes(tag)) inherited.push(tag);
      const tags = [...inherited];
      for (const tag of parts.tags) if (!tags.includes(tag)) tags.push(tag);

      const id = properties.ID || null;
      headings.push({ line: i, level, id });
      if (id) {
        nodes.push({
          id,
          title: parts.title,
          level,
          line: i,
          todo: parts.todo,
          tags,
          ownTags: parts.tags,
          aliases: splitAliases(properties.ROAM_ALIASES),
          olp: stack.map((frame) => frame.title),
          properties,
        });
      }
      stack.push({ level, id, title: parts.title, tags: parts.tags });
      continue;
    }

    if (inIgnoredBlock) {
      if (new RegExp(`^[ \\t]*#\\+end_${inIgnoredBlock}\\b`, "i").test(line)) inIgnoredBlock = null;
      continue;
    }
    const block = IGNORED_BLOCK_RE.exec(line);
    if (block) {
      inIgnoredBlock = block[1].toLowerCase();
      continue;
    }
    if (COMMENT_LINE_RE.test(line) || IGNORED_LINE_RE.test(line)) continue;
    if (!line.includes("id:")) continue;

    for (const link of findIdLinks(line)) {
      links.push({
        target: link.id,
        desc: link.desc,
        line: i,
        col: link.col,
        origin: nearestId(),
        context: contextOf(line),
      });
    }
  }

  return { title, fileId, nodes, headings, links };
}

/**
 * The note the cursor is in: the nearest heading with an ID at or above
 * LINE (0-based) whose subtree contains it, else the file's own ID.
 */
export function idAtLine(parsed, line) {
  const open = [];
  for (const heading of parsed.headings) {
    if (heading.line > line) break;
    while (open.length && open[open.length - 1].level >= heading.level) open.pop();
    open.push(heading);
  }
  for (let i = open.length - 1; i >= 0; i--) if (open[i].id) return open[i].id;
  return parsed.fileId;
}
