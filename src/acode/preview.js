// The preview: an Org file rendered in a tab of its own.
//
// Acode lets a plugin open a "custom" tab holding any element.  Each Org file
// gets at most one preview tab; it is drawn again from the file's text each
// time you switch to it (and when the file is saved), so it never shows a
// stale version.  The text comes from the open editor when the file is open,
// so unsaved edits show, and from storage otherwise.
//
// Tapping in the preview:
//   a heading      opens the source at that heading
//   an id: link    opens the note
//   a web link     opens the browser
//   a file: link   opens the file, relative to this one

import { renderOrg } from "../core/render.js";
import { baseName } from "../core/paths.js";
import previewCss from "./preview.css";

export class PreviewManager {
  /**
   * @param {object} options
   * @param {(id: string) => object|null} options.resolveId a note by ID
   * @param {(url: string, line: number) => void} options.openAt
   * @param {(id: string) => void} options.openId
   * @param {(url: string, path: string) => void} options.openFile a file:
   *   link's path, relative to the previewed file at url
   */
  constructor({ resolveId, openAt, openId, openFile }) {
    this.resolveId = resolveId;
    this.openAt = openAt;
    this.openId = openId;
    this.openFile = openFile;
    /** source uri -> { tab, root, uri } */
    this.previews = new Map();
  }

  /** Open (or show again) the preview of the editor file FILE. */
  async open(file) {
    const uri = file.uri ?? `unsaved:${file.id}`;
    const existing = this.previews.get(uri);
    if (existing && editorManager.getFile(existing.tab.id, "id")) {
      existing.tab.makeActive();
      await this.render(existing);
      return existing.tab;
    }
    const root = document.createElement("article");
    root.className = "org-preview";
    root.addEventListener("click", (event) => this.#click(event, entry));
    const entry = { uri, sourceId: file.id, root, tab: null };
    entry.tab = acode.newEditorFile(`${file.filename} · preview`, {
      type: "custom",
      content: root,
      stylesheets: previewCss,
      highlightStyles: true,
      tabIcon: "file file_type_org",
      render: true,
    });
    entry.tab.on?.("close", () => this.previews.delete(uri));
    this.previews.set(uri, entry);
    await this.render(entry);
    return entry.tab;
  }

  /** The preview entry whose tab is TAB, if any. */
  entryFor(tab) {
    for (const entry of this.previews.values()) if (entry.tab === tab) return entry;
    return null;
  }

  async #text(entry) {
    const source = editorManager.getFile(entry.sourceId, "id") ?? (entry.uri.startsWith("unsaved:") ? null : editorManager.getFile(entry.uri, "uri"));
    const live = source?.session?.doc?.toString?.();
    if (live != null) return live;
    if (entry.uri.startsWith("unsaved:")) return "";
    return acode.require("fsOperation")(entry.uri).readFile("utf-8");
  }

  /** Draw ENTRY's preview from its file's current text. */
  async render(entry) {
    let text;
    try {
      text = await this.#text(entry);
    } catch (error) {
      entry.root.innerHTML = `<p class="org-preview-error">Cannot read ${baseName(entry.uri)}: ${String(error?.message ?? error)}</p>`;
      return;
    }
    entry.root.innerHTML = renderOrg(text, { resolveId: this.resolveId }) || '<p class="org-preview-empty">This file is empty.</p>';
    this.#highlight(entry.root);
  }

  /** Colour src blocks with Acode's own highlighter, when it has one. */
  async #highlight(root) {
    const codeHighlight = acode.require("codeHighlight");
    if (!codeHighlight?.highlightCodeBlock) return;
    for (const pre of root.querySelectorAll("pre[data-lang]")) {
      const code = pre.querySelector("code");
      try {
        const html = await codeHighlight.highlightCodeBlock(code.textContent, pre.dataset.lang);
        code.className = codeHighlight.HIGHLIGHT_CLASS ?? "cm-highlighted";
        code.innerHTML = html;
      } catch {
        // an unknown language stays plain
      }
    }
  }

  #click(event, entry) {
    const target = event.target.closest("[data-line], [data-id], [data-href], [data-file], [data-heading]");
    if (!target) return;
    event.preventDefault();
    const { line, id, href, file, heading } = target.dataset;
    const source = entry.uri.startsWith("unsaved:") ? null : entry.uri;
    if (id) this.openId(id);
    else if (href) (window.system?.openInBrowser ?? window.open)(href);
    else if (file && source) this.openFile(source, file);
    else if (heading && source) {
      const match = [...entry.root.querySelectorAll(".org-heading")].find((h) => h.textContent.includes(heading));
      if (match) this.openAt(source, Number(match.dataset.line));
    } else if (line != null && source) this.openAt(source, Number(line));
  }
}
