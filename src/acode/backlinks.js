// The backlinks panel: kittymacs' SPC n b, as an Acode sidebar app.
//
// It shows the note the cursor is in (the nearest heading with an ID, or the
// file's) and every link pointing at it, each with the line around the link.
// Tapping one opens that note at the link.  Unlike org-node-context it
// follows the cursor by itself, since a phone has no spare key for "refresh".

import { escapeHtml } from "./picker.js";

export class BacklinksPanel {
  /**
   * @param {object} options
   * @param {import("../core/graph.js").Graph} options.graph
   * @param {() => ({id: string|null, reason?: string})} options.current the
   *   note at the cursor, or why there is none
   * @param {(url: string, line: number) => void} options.open
   * @param {() => void} options.rescan
   * @param {Record<string, () => void>} [options.actions] buttons at the top:
   *   find, tags, new; on a phone the panel doubles as the plugin's home
   */
  constructor({ graph, current, open, rescan, actions = {} }) {
    this.graph = graph;
    this.current = current;
    this.open = open;
    this.rescan = rescan;
    this.actions = actions;
    this.container = null;
    this.status = "";
  }

  mount(container) {
    this.container = container;
    container.classList.add("org-node-backlinks");
    container.addEventListener("click", (event) => {
      const target = event.target.closest("[data-url]");
      if (target) {
        this.open(target.dataset.url, Number(target.dataset.line));
        return;
      }
      const action = event.target.closest("[data-action]")?.dataset.action;
      if (action === "rescan") this.rescan();
      else if (action === "refresh") this.refresh();
      else if (action && this.actions[action]) this.actions[action]();
    });
    this.refresh();
  }

  setStatus(text) {
    this.status = text;
    this.refresh();
  }

  /** Redraw, when the panel is on screen; cheap enough to call often. */
  refresh() {
    const { container } = this;
    if (!container?.isConnected) return;
    const { id, reason } = this.current();
    const node = id ? this.graph.get(id) : null;
    const buttons = [
      ["find", "Find"],
      ["new", "New"],
      ["tags", "Tags"],
    ]
      .filter(([action]) => this.actions[action])
      .map(([action, text]) => `<button data-action="${action}">${text}</button>`)
      .join("");
    const toolbar = `<div class="org-node-bl-toolbar">${buttons}
        <button data-action="rescan" title="Read every file again">Rescan</button>
      </div>
      <div class="org-node-bl-status">${escapeHtml(this.status)}</div>`;
    if (!node) {
      container.innerHTML = `${toolbar}<p class="org-node-bl-empty">${escapeHtml(
        reason ?? (id ? "This note is not indexed yet; save it or rescan." : "No note here: neither this heading nor its file has an ID."),
      )}</p>`;
      return;
    }
    const groups = this.graph.backlinks(id);
    const tags = node.tags.length ? `<div class="org-node-bl-tags">${node.tags.map((t) => `#${escapeHtml(t)}`).join(" ")}</div>` : "";
    const body = groups.length
      ? groups
          .map((group) => {
            const title = group.from?.title ?? group.rel;
            const items = group.links
              .map(
                (link) =>
                  `<li data-url="${escapeHtml(link.url)}" data-line="${link.line}">${escapeHtml(link.context) || "&nbsp;"}</li>`,
              )
              .join("");
            const jump = group.from ? `data-url="${escapeHtml(group.from.url)}" data-line="${group.from.line}"` : "";
            return `<section class="org-node-bl-group">
                <h4 ${jump}>${escapeHtml(title)}</h4>
                <div class="org-node-bl-file">${escapeHtml(group.rel)}</div>
                <ul>${items}</ul></section>`;
          })
          .join("")
      : `<p class="org-node-bl-empty">No backlinks yet.</p>`;
    const count = groups.reduce((sum, group) => sum + group.links.length, 0);
    container.innerHTML = `${toolbar}
      <header class="org-node-bl-header">
        <h3>${escapeHtml(node.title)}</h3>${tags}
        <div class="org-node-bl-count">${count} backlink${count === 1 ? "" : "s"}</div>
      </header>${body}`;
  }
}
