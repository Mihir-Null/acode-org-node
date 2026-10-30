// The links panel: kittymacs' SPC n b, as an Acode sidebar app.
//
// It shows the note the cursor is in (the nearest heading with an ID, or the
// file's) with two lists: the notes linking to it (backlinks), and the notes
// it links to (forward links), each with the line around the link.  Unlike
// org-node-context it follows the cursor by itself, since a phone has no
// spare key for "refresh".

import { escapeHtml } from "./picker.js";

export class BacklinksPanel {
  /**
   * @param {object} options
   * @param {import("../core/graph.js").Graph} options.graph
   * @param {() => ({id: string|null, reason?: string, url?: string, links?: object[]})}
   *   options.current the note at the cursor and its outgoing links (from
   *   the editor's live text), or why there is none
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
    const { id, reason, url, links = [] } = this.current();
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
    const back = this.graph.backlinks(id);
    const forward = this.graph.forwardLinks(links);
    const backCount = back.reduce((sum, group) => sum + group.links.length, 0);
    const forwardCount = forward.reduce((sum, group) => sum + group.links.length, 0);
    const tags = node.tags.length ? `<div class="org-node-bl-tags">${node.tags.map((t) => `#${escapeHtml(t)}`).join(" ")}</div>` : "";
    const jumpTo = (target) => (target ? `data-url="${escapeHtml(target.url)}" data-line="${target.line}"` : "");
    const lines = (list, at) =>
      list
        .map((link) => `<li data-url="${escapeHtml(at ?? link.url)}" data-line="${link.line}">${escapeHtml(link.context) || "&nbsp;"}</li>`)
        .join("");

    const backHtml = back.length
      ? back
          .map(
            (group) => `<section class="org-node-bl-group">
                <h4 ${jumpTo(group.from)}>${escapeHtml(group.from?.title ?? group.rel)}</h4>
                <div class="org-node-bl-file">${escapeHtml(group.rel)}</div>
                <ul>${lines(group.links)}</ul></section>`,
          )
          .join("")
      : `<p class="org-node-bl-empty">No note links here yet.</p>`;

    // Forward links come from the editor's text: the title opens the note
    // linked to, a line jumps to the link in this file.
    const forwardHtml = forward.length
      ? forward
          .map(
            (group) => `<section class="org-node-bl-group${group.to ? "" : " missing"}">
                <h4 ${jumpTo(group.to)}>${escapeHtml(group.to?.title ?? `No note has the ID ${group.id}`)}</h4>
                <div class="org-node-bl-file">${escapeHtml(group.to?.rel ?? "")}</div>
                <ul>${lines(group.links, url)}</ul></section>`,
          )
          .join("")
      : `<p class="org-node-bl-empty">This note links to no other note.</p>`;

    container.innerHTML = `${toolbar}
      <header class="org-node-bl-header">
        <h3>${escapeHtml(node.title)}</h3>${tags}
      </header>
      <h5 class="org-node-bl-section">Links to here <span class="org-node-bl-count">${backCount}</span></h5>
      ${backHtml}
      <h5 class="org-node-bl-section">Links from here <span class="org-node-bl-count">${forwardCount}</span></h5>
      ${forwardHtml}`;
  }
}
