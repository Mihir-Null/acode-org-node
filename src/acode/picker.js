// The note picker: kittymacs' SPC n f prompt, for a touch screen.
//
// Acode's own palette cannot create something from the text you typed, and
// filters with its own matcher, so the plugin draws its own: an input at the
// top, the best matches below, and a "Create" row when what you typed is a
// title no note has.  Matching is match.js's, the same rules as kittymacs.

import { rankNodes, titleFromInput } from "../core/match.js";

const MAX_ROWS = 80;
const PICKER_ID = "org-node-picker";

const escapeHtml = (text) =>
  String(text).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);

/**
 * Show the picker.
 *
 * @param {object} options
 * @param {object[]} options.nodes the candidates
 * @param {string} [options.placeholder]
 * @param {string} [options.initial] text to start with (a selection)
 * @param {boolean} [options.allowCreate] offer to create a note
 * @param {(node) => string} [options.describe] the small line under a title
 * @param {object} [options.actionStack] Acode's back-button stack
 * @returns {Promise<{node: object} | {create: string} | null>}
 */
export function pickNode({ nodes, placeholder = "Find note", initial = "", allowCreate = false, describe = () => "", actionStack }) {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "org-node-picker-mask";
    overlay.innerHTML = `
      <div class="org-node-picker" role="dialog" aria-label="${escapeHtml(placeholder)}">
        <input class="org-node-picker-input" type="search" enterkeyhint="go"
               autocomplete="off" autocapitalize="off" spellcheck="false"
               placeholder="${escapeHtml(placeholder)}">
        <div class="org-node-picker-hint">Words match anywhere · #tag narrows · !word excludes</div>
        <ul class="org-node-picker-list" role="listbox"></ul>
      </div>`;
    const input = overlay.querySelector("input");
    const list = overlay.querySelector("ul");
    let rows = [];
    let active = 0;
    let done = false;

    const finish = (value) => {
      if (done) return;
      done = true;
      overlay.remove();
      actionStack?.remove(PICKER_ID);
      resolve(value);
    };

    const render = () => {
      const text = input.value;
      const ranked = rankNodes(nodes, text, { limit: MAX_ROWS });
      rows = ranked.map((node) => ({ node }));
      const title = allowCreate ? titleFromInput(text) : null;
      if (title && !nodes.some((node) => node.title.toLowerCase() === title.toLowerCase())) {
        // As with Vertico in kittymacs, Enter takes the best match; creating
        // is first only when nothing matches, and otherwise last.
        rows.push({ create: title });
      }
      active = Math.min(active, Math.max(rows.length - 1, 0));
      list.innerHTML = rows.length
        ? rows
            .map((row, i) => {
              const cls = `org-node-picker-row${i === active ? " active" : ""}`;
              if (row.create) {
                return `<li class="${cls} create" data-i="${i}" role="option"><span class="title">Create “${escapeHtml(row.create)}”</span></li>`;
              }
              const { node } = row;
              const tags = node.tags.length ? `<span class="tags">${node.tags.map((t) => `#${escapeHtml(t)}`).join(" ")}</span>` : "";
              const todo = node.todo ? `<span class="todo">${escapeHtml(node.todo)}</span> ` : "";
              return `<li class="${cls}" data-i="${i}" role="option">
                  <span class="title">${todo}${escapeHtml(node.title || "(untitled)")}</span>${tags}
                  <span class="where">${escapeHtml(describe(node))}</span></li>`;
            })
            .join("")
        : `<li class="org-node-picker-empty">${nodes.length ? "No note matches" : "The graph is empty"}</li>`;
      list.querySelector(".active")?.scrollIntoView({ block: "nearest" });
    };

    const choose = (i) => {
      const row = rows[i];
      if (row) finish(row.create ? { create: row.create } : { node: row.node });
    };

    let timer = null;
    input.addEventListener("input", () => {
      active = 0;
      clearTimeout(timer);
      timer = setTimeout(render, 40);
    });
    input.addEventListener("keydown", (event) => {
      if (event.key === "ArrowDown") active = Math.min(active + 1, rows.length - 1);
      else if (event.key === "ArrowUp") active = Math.max(active - 1, 0);
      else if (event.key === "Enter") {
        clearTimeout(timer);
        render();
        choose(active);
        event.preventDefault();
        return;
      } else if (event.key === "Escape") return finish(null);
      else return;
      event.preventDefault();
      render();
    });
    list.addEventListener("click", (event) => {
      const row = event.target.closest("[data-i]");
      if (row) choose(Number(row.dataset.i));
    });
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) finish(null);
    });

    actionStack?.push({ id: PICKER_ID, action: () => finish(null) });
    document.body.append(overlay);
    input.value = initial;
    render();
    input.focus();
    if (initial) input.select();
  });
}

export { escapeHtml };
