// Org to HTML, for the preview.
//
// A reader's view of an Org file: headings with their TODO keywords and tags,
// paragraphs, lists (with checkboxes and descriptions), tables, blocks,
// links and emphasis.  Property drawers, comments and settings lines are left
// out, as Org's own exports leave them out.
//
// It is a renderer, not a full exporter: it follows the common syntax closely
// and gives up gracefully on the rare (macros, includes, LaTeX environments
// are shown as their text).  Everything it outputs is escaped first, so a
// note cannot inject markup into the preview.
//
// Elements the preview makes interactive carry data attributes:
//   data-line  on a heading: its line (0-based) in the source
//   data-id    on an id: link: the ID
//   data-href  on a web link: the URL
//   data-file  on a file: link: its path, data-search its ::search part
//   data-heading on a [[*Heading]] link: the heading's title
//   data-lang  on a src block: its language, for highlighting afterwards

import { DEFAULT_TODO_KEYWORDS, parseHeadingText } from "./org.js";

const HEADING_RE = /^(\*+)[ \t]+(.*)$/;
const KEYWORD_RE = /^[ \t]*#\+(\w+):[ \t]*(.*)$/;
const DRAWER_RE = /^[ \t]*:([\w-]+):[ \t]*$/;
const DRAWER_END_RE = /^[ \t]*:END:[ \t]*$/i;
const PLANNING_RE = /^[ \t]*(?:(?:SCHEDULED|DEADLINE|CLOSED):[ \t]*[<\[][^>\]]*[>\]][ \t]*)+$/;
const BEGIN_RE = /^[ \t]*#\+begin_(\w+)(?:[ \t]+(.*))?$/i;
// A "*" bullet must be indented: at the start of a line it is a heading.
const ITEM_RE = /^([ \t]*)([-+*]|\d+[.)])(?:[ \t]+(.*))?$/;
const TABLE_RE = /^[ \t]*\|/;
const FIXED_RE = /^[ \t]*:(?: (.*)|)$/;
const RULE_RE = /^[ \t]*-{5,}[ \t]*$/;
const COMMENT_RE = /^[ \t]*#(?: |$)/;

export const escapeHtml = (text) =>
  String(text).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);

// --- Inline markup ---------------------------------------------------------

const INLINE_RE = new RegExp(
  [
    /\[\[([^\[\]]+)\](?:\[(.+?)\])?\]/.source, // 1 target, 2 description
    /(<\d{4}-\d{2}-\d{2}[^>\n]*>(?:--<\d{4}-\d{2}-\d{2}[^>\n]*>)?)/.source, // 3 active timestamp
    /(\[\d{4}-\d{2}-\d{2}[^\]\n]*\](?:--\[\d{4}-\d{2}-\d{2}[^\]\n]*\])?)/.source, // 4 inactive timestamp
    /((?:https?|ftp|mailto):[^\s\]<>)"]+)/.source, // 5 plain URL
    /\[fn:([^\]\s]+)\]/.source, // 6 footnote reference
    /([*/_=~+])(\S(?:.*?\S)?)\7(?=$|[\s\-.,:!?;'")}\[\]])/.source, // 7 marker, 8 text
    /(\\\\)$/.source, // 9 line break
  ].join("|"),
  "g",
);
const EMPHASIS_TAGS = { "*": "strong", "/": "em", _: "u", "+": "del" };
const EMPHASIS_PRE = /[\s('"{\-]/;

function renderLink(target, desc, ctx) {
  const body = (fallback) => (desc ? renderInline(desc, ctx, { links: false }) : escapeHtml(fallback));
  const colon = target.indexOf(":");
  const type = colon > 0 && !/\s/.test(target.slice(0, colon)) ? target.slice(0, colon).toLowerCase() : null;
  if (type === "id") {
    const id = target.slice(3).split("::")[0];
    const node = ctx.resolveId?.(id);
    return `<a class="org-link org-id${node ? "" : " missing"}" data-id="${escapeHtml(id)}">${body(node?.title ?? id)}</a>`;
  }
  if (type === "http" || type === "https" || type === "ftp" || type === "mailto") {
    return `<a class="org-link org-web" data-href="${escapeHtml(target)}">${body(target)}</a>`;
  }
  if (type === "file" || (!type && /^(\.{0,2}\/|~\/)/.test(target))) {
    const path = type === "file" ? target.slice(5) : target;
    const [file, search = ""] = path.split("::");
    return `<a class="org-link org-file" data-file="${escapeHtml(file)}" data-search="${escapeHtml(search)}">${body(path)}</a>`;
  }
  if (!type && target.startsWith("*")) {
    return `<a class="org-link org-heading-link" data-heading="${escapeHtml(target.slice(1))}">${body(target.slice(1))}</a>`;
  }
  return `<span class="org-link org-other" title="${escapeHtml(target)}">${body(target)}</span>`;
}

/** Inline Org markup to HTML: links, emphasis, timestamps, footnotes. */
export function renderInline(text, ctx = {}, { links = true } = {}) {
  let out = "";
  let pos = 0;
  const re = new RegExp(INLINE_RE.source, "g");
  let match;
  while ((match = re.exec(text))) {
    const [whole, target, desc, active, inactive, url, footnote, marker, inner, lineBreak] = match;
    if (marker && match.index > 0 && !EMPHASIS_PRE.test(text[match.index - 1])) {
      re.lastIndex = match.index + 1; // not emphasis here; look again one further on
      continue;
    }
    if ((target || url) && !links) {
      re.lastIndex = match.index + 1;
      continue;
    }
    out += escapeHtml(text.slice(pos, match.index));
    if (target) out += renderLink(target, desc, ctx);
    else if (active || inactive) out += `<span class="org-timestamp${active ? " active" : ""}">${escapeHtml(active ?? inactive)}</span>`;
    else if (url) out += `<a class="org-link org-web" data-href="${escapeHtml(url)}">${escapeHtml(url)}</a>`;
    else if (footnote) out += `<sup class="org-footnote">${escapeHtml(footnote)}</sup>`;
    else if (marker === "=" || marker === "~") out += `<code>${escapeHtml(inner)}</code>`;
    else if (marker) out += `<${EMPHASIS_TAGS[marker]}>${renderInline(inner, ctx, { links })}</${EMPHASIS_TAGS[marker]}>`;
    else if (lineBreak) out += "<br>";
    else out += escapeHtml(whole);
    pos = re.lastIndex;
  }
  return out + escapeHtml(text.slice(pos));
}

// --- Blocks ----------------------------------------------------------------

/** The TODO keywords a file declares, and which of them mean done. */
export function todoKeywords(lines) {
  const todo = [];
  const done = [];
  let declared = false;
  for (const line of lines) {
    const match = KEYWORD_RE.exec(line);
    if (!match || !/^(seq_|typ_)?todo$/i.test(match[1])) continue;
    declared = true;
    const words = match[2].split(/\s+/).filter(Boolean);
    const bar = words.indexOf("|");
    const clean = (w) => w.replace(/\(.*\)$/, "");
    const open = (bar === -1 ? words.slice(0, -1) : words.slice(0, bar)).map(clean);
    const closed = (bar === -1 ? words.slice(-1) : words.slice(bar + 1)).map(clean);
    todo.push(...open, ...closed);
    done.push(...closed);
  }
  if (!declared) return { all: [...DEFAULT_TODO_KEYWORDS], done: ["DONE", "CANCELED"] };
  return { all: todo, done };
}

function renderTable(rows, ctx) {
  const isRule = (row) => /^[ \t]*\|-/.test(row);
  const cells = (row) =>
    row
      .trim()
      .replace(/^\|/, "")
      .replace(/\|$/, "")
      .split("|")
      .map((cell) => renderInline(cell.trim(), ctx));
  const firstRule = rows.findIndex(isRule);
  const head = firstRule > 0 ? rows.slice(0, firstRule) : [];
  const body = (firstRule > 0 ? rows.slice(firstRule + 1) : rows).filter((row) => !isRule(row));
  const tr = (row, tag) => `<tr>${cells(row).map((c) => `<${tag}>${c}</${tag}>`).join("")}</tr>`;
  return `<table class="org-table">${head.length ? `<thead>${head.map((r) => tr(r, "th")).join("")}</thead>` : ""}<tbody>${body
    .map((r) => tr(r, "td"))
    .join("")}</tbody></table>`;
}

/**
 * Lists: items are grouped by indentation into nested lists.  ITEMS are
 * {indent, bullet, text: [lines], line}.
 */
function renderList(items, ctx) {
  let html = "";
  let i = 0;
  const renderLevel = (indent) => {
    const first = items[i];
    const ordered = /\d/.test(first.bullet);
    const description = items.slice(i).some((item) => item.indent === indent && /^(?:\[[ X-]\][ \t]+)?.*?[ \t]::(?:[ \t]|$)/.test(item.text[0]));
    let out = description ? "<dl>" : ordered ? "<ol>" : "<ul>";
    while (i < items.length && items[i].indent >= indent) {
      const item = items[i];
      if (item.indent > indent) {
        out += renderLevel(item.indent);
        continue;
      }
      i++;
      let first = item.text[0] ?? "";
      let box = "";
      const checkbox = /^\[([ X-])\][ \t]+/.exec(first);
      if (checkbox) {
        first = first.slice(checkbox[0].length);
        const state = checkbox[1] === "X" ? "on" : checkbox[1] === "-" ? "partial" : "off";
        box = `<span class="org-checkbox ${state}" data-line="${item.line}">${state === "on" ? "☑" : state === "partial" ? "◩" : "☐"}</span> `;
      }
      const text = [first, ...item.text.slice(1)].map((l) => l.trim()).join(" ");
      let children = "";
      if (i < items.length && items[i].indent > indent) children = renderLevel(items[i].indent);
      if (description) {
        const parts = /^(.*?)[ \t]::(?:[ \t]+(.*)|)$/.exec(text);
        out += parts
          ? `<dt>${box}${renderInline(parts[1], ctx)}</dt><dd>${renderInline(parts[2] ?? "", ctx)}${children}</dd>`
          : `<dd>${box}${renderInline(text, ctx)}${children}</dd>`;
      } else {
        out += `<li${checkbox ? ' class="task"' : ""}>${box}${renderInline(text, ctx)}${children}</li>`;
      }
    }
    return out + (description ? "</dl>" : ordered ? "</ol>" : "</ul>");
  };
  while (i < items.length) html += renderLevel(items[i].indent);
  return html;
}

/**
 * Render an Org file.
 *
 * @param {string} text
 * @param {object} [ctx]
 * @param {(id: string) => ({title: string} | null)} [ctx.resolveId] the note
 *   an id: link points to, for its title and to mark missing ones
 * @returns {string} HTML
 */
export function renderOrg(text, ctx = {}) {
  const lines = text.split(/\r?\n/);
  const keywords = todoKeywords(lines);
  const out = [];
  let paragraph = [];
  const flush = () => {
    if (paragraph.length) out.push(`<p>${renderInline(paragraph.map((l) => l.trim()).join(" "), ctx)}</p>`);
    paragraph = [];
  };
  let titleShown = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (/^[ \t]*$/.test(line)) {
      flush();
      continue;
    }

    const heading = HEADING_RE.exec(line);
    if (heading) {
      flush();
      const level = heading[1].length;
      const parts = parseHeadingText(heading[2], keywords.all);
      const priority = /^(?:\S+[ \t]+)?\[#([A-Z0-9])\]/.exec(heading[2]);
      const tag = `h${Math.min(level + 1, 6)}`;
      const todo = parts.todo
        ? `<span class="org-todo${keywords.done.includes(parts.todo) ? " done" : ""}">${escapeHtml(parts.todo)}</span> `
        : "";
      const prio = priority && parts.todo !== null ? `<span class="org-priority">#${priority[1]}</span> ` : "";
      const tags = parts.tags.length ? ` <span class="org-tags">${parts.tags.map((t) => `<span>${escapeHtml(t)}</span>`).join("")}</span>` : "";
      out.push(`<${tag} class="org-heading level-${level}" data-line="${i}">${todo}${prio}${renderInline(parts.title, ctx)}${tags}</${tag}>`);
      // Its planning line, shown small.
      if (i + 1 < lines.length && PLANNING_RE.test(lines[i + 1])) {
        out.push(`<div class="org-planning">${escapeHtml(lines[i + 1].trim())}</div>`);
        i++;
      }
      continue;
    }

    // Drawers (properties, logbook) are not shown.
    const drawer = DRAWER_RE.exec(line);
    if (drawer && !DRAWER_END_RE.test(line)) {
      const end = lines.findIndex((l, j) => j > i && (DRAWER_END_RE.test(l) || HEADING_RE.test(l)));
      if (end !== -1 && DRAWER_END_RE.test(lines[end])) {
        flush();
        i = end;
        continue;
      }
    }

    const begin = BEGIN_RE.exec(line);
    if (begin) {
      const kind = begin[1].toLowerCase();
      const endRe = new RegExp(`^[ \\t]*#\\+end_${kind}\\b`, "i");
      const end = lines.findIndex((l, j) => j > i && (endRe.test(l) || HEADING_RE.test(l)));
      if (end !== -1 && endRe.test(lines[end])) {
        flush();
        // Inside src and example blocks, Org escapes leading "*" and "#+" as ",*" and ",#+".
        const body = lines.slice(i + 1, end).map((l) => l.replace(/^([ \t]*),(\*|#\+)/, "$1$2"));
        const language = (begin[2] ?? "").split(/\s+/)[0];
        if (kind === "src") {
          out.push(
            `<figure class="org-src">${language ? `<figcaption>${escapeHtml(language)}</figcaption>` : ""}<pre${
              language ? ` data-lang="${escapeHtml(language.toLowerCase())}"` : ""
            }><code>${escapeHtml(body.join("\n"))}</code></pre></figure>`,
          );
        } else if (kind === "example" || kind === "export") {
          out.push(`<pre class="org-example">${escapeHtml(body.join("\n"))}</pre>`);
        } else if (kind === "quote") {
          out.push(`<blockquote>${renderOrg(body.join("\n"), ctx)}</blockquote>`);
        } else if (kind === "verse") {
          out.push(`<p class="org-verse">${body.map((l) => renderInline(l, ctx)).join("<br>")}</p>`);
        } else if (kind === "center") {
          out.push(`<div class="org-center">${renderOrg(body.join("\n"), ctx)}</div>`);
        } else if (kind !== "comment") {
          out.push(`<div class="org-block org-${escapeHtml(kind)}">${renderOrg(body.join("\n"), ctx)}</div>`);
        }
        i = end;
        continue;
      }
    }

    const keyword = KEYWORD_RE.exec(line);
    if (keyword) {
      flush();
      const key = keyword[1].toLowerCase();
      if (key === "title" && !titleShown && keyword[2].trim()) {
        out.push(`<h1 class="org-title">${renderInline(keyword[2].trim(), ctx)}</h1>`);
        titleShown = true;
      } else if ((key === "subtitle" || key === "author" || key === "date") && keyword[2].trim()) {
        out.push(`<p class="org-${key}">${renderInline(keyword[2].trim(), ctx)}</p>`);
      }
      continue;
    }

    if (COMMENT_RE.test(line)) {
      flush();
      continue;
    }

    if (RULE_RE.test(line)) {
      flush();
      out.push("<hr>");
      continue;
    }

    if (TABLE_RE.test(line)) {
      flush();
      const rows = [];
      while (i < lines.length && TABLE_RE.test(lines[i])) rows.push(lines[i++]);
      i--;
      out.push(renderTable(rows, ctx));
      continue;
    }

    if (FIXED_RE.test(line) && !DRAWER_RE.test(line)) {
      flush();
      const rows = [];
      while (i < lines.length && FIXED_RE.test(lines[i])) rows.push(FIXED_RE.exec(lines[i++])[1] ?? "");
      i--;
      out.push(`<pre class="org-fixed">${escapeHtml(rows.join("\n"))}</pre>`);
      continue;
    }

    const item = ITEM_RE.exec(line);
    if (item && !(item[2] === "*" && item[1] === "")) {
      flush();
      const items = [];
      const base = item[1].length;
      while (i < lines.length) {
        const current = ITEM_RE.exec(lines[i]);
        if (current && current[1].length >= base && !(current[2] === "*" && current[1] === "")) {
          items.push({ indent: current[1].length, bullet: current[2].trim(), text: [current[3] ?? ""], line: i });
          i++;
          continue;
        }
        const indent = /^[ \t]*/.exec(lines[i])[0].length;
        const blank = /^[ \t]*$/.test(lines[i]);
        // A continuation line is indented past the bullet; one blank line
        // inside a list is allowed when the list goes on after it.
        if (!blank && items.length && indent > items[items.length - 1].indent && !HEADING_RE.test(lines[i])) {
          items[items.length - 1].text.push(lines[i]);
          i++;
          continue;
        }
        if (blank && i + 1 < lines.length) {
          const next = lines[i + 1];
          const nextItem = ITEM_RE.exec(next);
          const nextIndent = /^[ \t]*/.exec(next)[0].length;
          if ((nextItem && nextItem[1].length >= base) || (!/^[ \t]*$/.test(next) && nextIndent > base)) {
            i++;
            continue;
          }
        }
        break;
      }
      i--;
      out.push(renderList(items, ctx));
      continue;
    }

    paragraph.push(line);
  }
  flush();
  return out.join("\n");
}
