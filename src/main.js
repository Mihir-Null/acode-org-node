// Org-node for Acode: kittymacs' notes graph on Android.
//
// This file is the glue between Acode and the pure modules in core/:
//
//   - which folders make up the graph: every git repository open in Acode's
//     sidebar, every folder whose .dir-locals.el sets
//     kittymacs-org-node-project (remembered), and a notes folder if you
//     choose one;
//   - keeping the index current (files.js), from a cache at startup, after
//     every save, and whenever the app comes back to the foreground;
//   - the commands, the selection-menu items, the links sidebar, the Org
//     editor mode with its structure editing, and the preview.
//
// Every command is in Acode's command palette, as "Org-node: ..." for the
// notes graph and "Org: ..." for editing and previewing any Org file.

import plugin from "../plugin.json";
import { Graph } from "./core/graph.js";
import { findIdLinks, idAtLine, parseOrg } from "./core/org.js";
import { cycleTodo, insertHeading, lineChange, moveSubtree, offsetOf, shiftHeading, toggleCheckbox } from "./core/edit.js";
import { makeIdLink, newId, newNoteText, titleToFileName } from "./core/notes.js";
import { baseName, isNoteFileName, relativePath } from "./core/paths.js";
import { BacklinksPanel } from "./acode/backlinks.js";
import { Indexer, isGitRepo, readDirLocals } from "./acode/files.js";
import { orgExtensions } from "./acode/orgmode.js";
import { pickNode } from "./acode/picker.js";
import { PreviewManager } from "./acode/preview.js";
import { LanguageResolver } from "./acode/srcblocks.js";
import styles from "./styles.css";

const PROJECTS_KEY = "org-node.projects";
const SIDEBAR_ID = "org-node";
const ICON = "org-node-icon";
const DEFAULTS = { notesFolder: "", notesExcluded: "", followProjects: true, highlight: true, linkButton: true };
const NO_FOLDER_MESSAGE =
  "No notes yet: open a git repository in Acode's sidebar, or choose a notes folder in Org-node's settings";

// A small graph-node glyph, drawn in the theme's text colour (monochrome).
const ICON_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><g fill="none" stroke="#000" stroke-width="2">' +
  '<path d="M7 7l10 4M7 7l3 10M17 11l-7 6"/></g><g fill="#000"><circle cx="6" cy="6" r="3"/>' +
  '<circle cx="18" cy="11" r="3"/><circle cx="10" cy="18" r="3"/></g></svg>';

const toast = (message, ms = 3000) => window.toast?.(message, ms);

class OrgNodePlugin {
  graph = new Graph();
  roots = [];
  #listeners = [];
  #cacheFile = null;
  #saveTimer = null;
  #indexedOnce = false;
  #live = { doc: null, parsed: null };
  #previousOrgMode = null;
  /** The open git repositories in the graph, found by #discoverFolders. */
  #openRepos = [];
  /** Folders announced this session, so each is announced once. */
  #announced = new Set();

  get settings() {
    return this.appSettings.value[plugin.id];
  }

  async init($page, cacheFile) {
    this.appSettings = acode.require("settings");
    this.appSettings.value[plugin.id] = { ...DEFAULTS, ...this.appSettings.value[plugin.id] };
    this.fsOperation = acode.require("fsOperation");
    this.Url = acode.require("Url");
    this.actionStack = acode.require("actionStack");
    const fileIndex = acode.require("fileIndex");
    const addedFolder = () => acode.require("addedfolder") ?? window.addedFolder ?? [];
    this.addedFolder = addedFolder;
    this.indexer = new Indexer({
      graph: this.graph,
      env: {
        fs: (url) => this.fsOperation(url),
        join: (...parts) => this.Url.join(...parts),
        fileIndex,
        isOpenFolder: (url) => addedFolder().some((folder) => folder.url === url),
        scanned: new Set(),
      },
    });

    this.#style = document.createElement("style");
    this.#style.textContent = styles;
    document.head.append(this.#style);
    acode.addIcon(ICON, `data:image/svg+xml;base64,${btoa(ICON_SVG)}`, { monochrome: true });

    this.#registerCommands();
    this.#registerSelectionMenu();
    this.#registerSidebar();
    this.preview = new PreviewManager({
      resolveId: (id) => this.graph.get(id),
      openAt: (url, line) => this.openAt(url, line),
      openId: (id) => this.openId(id),
      openFile: (from, path) => this.openRelative(from, path),
    });
    this.#registerOrgMode();
    this.#registerOrgButtons();
    this.#listen();

    // Show the cached graph at once; refresh it from disk shortly after, so
    // Acode's own startup is not slowed down.
    this.#cacheFile = cacheFile;
    try {
      if (cacheFile && (await cacheFile.exists())) this.indexer.restore(JSON.parse(await cacheFile.readFile("utf-8")));
    } catch (error) {
      console.warn("[org-node] ignoring an unreadable cache", error);
    }
    this.#startupTimer = setTimeout(() => this.reindex({ quiet: true }), 1500);
  }

  #style = null;
  #startupTimer = null;

  destroy() {
    clearTimeout(this.#startupTimer);
    clearTimeout(this.#saveTimer);
    const commands = acode.require("commands");
    for (const command of this.#commands()) commands.removeCommand(command.name);
    for (const [target, event, fn] of this.#listeners) target.off ? target.off(event, fn) : target.removeEventListener(event, fn);
    this.#listeners = [];
    acode.require("sidebarApps").remove(SIDEBAR_ID);
    this.linkButton?.hide();
    this.orgButton?.hide();
    const languages = acode.require("editorLanguages");
    languages.unregister("org");
    if (this.#previousOrgMode) languages.register(...this.#previousOrgMode);
    this.#style?.remove();
    if (window.__orgNodePlugin === this) window.__orgNodePlugin = null;
  }

  // ------------------------------------------------------------------
  // The graph's folders

  #projects() {
    try {
      return JSON.parse(localStorage.getItem(PROJECTS_KEY) ?? "{}");
    } catch {
      return {};
    }
  }

  #saveProjects(projects) {
    try {
      localStorage.setItem(PROJECTS_KEY, JSON.stringify(projects));
    } catch (error) {
      console.warn("[org-node] cannot remember projects", error);
    }
  }

  /**
   * Look at the folders open in the sidebar.  A folder whose .dir-locals.el
   * sets kittymacs-org-node-project joins the graph and is remembered, as
   * kittymacs remembers projects.  Any other git repository joins while it
   * is open, leaving out the folders its .dir-locals.el excludes, if any.
   */
  async #discoverFolders() {
    const repos = [];
    if (this.settings.followProjects) {
      const projects = this.#projects();
      let changed = false;
      for (const folder of this.addedFolder()) {
        const locals = await readDirLocals(this.indexer.env, folder.url);
        if (locals?.project) {
          if (JSON.stringify(projects[folder.url]) !== JSON.stringify(locals.excluded)) {
            projects[folder.url] = locals.excluded;
            changed = true;
          }
        } else if (await isGitRepo(this.indexer.env, folder.url)) {
          repos.push({ url: folder.url, excluded: locals?.excluded ?? [], kind: "repo" });
        }
      }
      if (changed) this.#saveProjects(projects);
    }
    this.#openRepos = repos;
  }

  #computeRoots() {
    const roots = [];
    const add = (root) => {
      if (!roots.some((other) => other.url === root.url)) roots.push(root);
    };
    const { notesFolder, notesExcluded } = this.settings;
    if (notesFolder) {
      add({ url: notesFolder, excluded: notesExcluded.split(",").map((dir) => dir.trim()).filter(Boolean), kind: "notes" });
    }
    for (const [url, excluded] of Object.entries(this.#projects())) add({ url, excluded, kind: "project" });
    for (const repo of this.#openRepos) add(repo);
    this.roots = roots;
    return roots;
  }

  rootTitle(url) {
    const open = this.addedFolder().find((folder) => folder.url === url);
    return open?.title ?? baseName(url);
  }

  describe = (node) => `${this.rootTitle(node.root)}/${node.rel}${node.olp.length ? ` › ${node.olp.join(" › ")}` : ""}`;

  /** Read the graph again: changed files only, or every file when FULL. */
  async reindex({ full = false, quiet = false } = {}) {
    await this.#discoverFolders();
    const roots = this.#computeRoots();
    // Say when a folder joins, once a session; the silent index at startup
    // says nothing about the folders already there.
    for (const root of roots) {
      if (this.#announced.has(root.url)) continue;
      this.#announced.add(root.url);
      if ((this.#indexedOnce || !quiet) && root.kind !== "notes") toast(`Notes graph includes ${this.rootTitle(root.url)}`);
    }
    if (!roots.length) {
      this.graph.clear();
      this.panel?.setStatus("");
      if (!quiet) toast(NO_FOLDER_MESSAGE, 5000);
      return null;
    }
    this.panel?.setStatus("Indexing…");
    const result = await this.indexer.indexRoots(roots, {
      full,
      onProgress: (done, total) => this.panel?.setStatus(`Reading ${done}/${total}…`),
    });
    this.#indexedOnce = true;
    this.#scheduleCacheSave();
    const dup = this.graph.duplicates.length ? `, ${this.graph.duplicates.length} duplicate IDs` : "";
    this.panel?.setStatus(`${result.nodes} notes in ${result.files} files${dup}`);
    if (!quiet) toast(`Notes graph: ${result.files} files, ${result.nodes} notes${dup}`);
    return result;
  }

  /** Make sure there is a graph to search; false (with a message) if not. */
  async ensureIndexed() {
    if (!this.#indexedOnce) await this.reindex({ quiet: true });
    if (!this.roots.length) {
      toast(NO_FOLDER_MESSAGE, 5000);
      return false;
    }
    return true;
  }

  #scheduleCacheSave() {
    clearTimeout(this.#saveTimer);
    this.#saveTimer = setTimeout(async () => {
      try {
        await this.#cacheFile?.writeFile(JSON.stringify(this.indexer.toJSON()));
      } catch (error) {
        console.warn("[org-node] cannot write the cache", error);
      }
    }, 2000);
  }

  // ------------------------------------------------------------------
  // The editor

  get view() {
    return editorManager.editor;
  }

  #activeOrgFile() {
    const file = editorManager.activeFile;
    return file && isNoteFileName(file.filename ?? "") ? file : null;
  }

  /**
   * The note at the cursor, {id, url, links} with LINKS its outgoing id:
   * links, or {id: null, reason}.
   */
  currentNote = () => {
    const file = this.#activeOrgFile();
    if (!file) return { id: null, reason: "Open an Org file to see the links of the note you are in." };
    const { doc, selection } = this.view.state;
    // Parse the editor's text, so unsaved edits count; cache by document.
    if (this.#live.doc !== doc) this.#live = { doc, parsed: parseOrg(doc.toString(), { fileName: file.filename }) };
    const { parsed } = this.#live;
    const id = idAtLine(parsed, doc.lineAt(selection.main.head).number - 1);
    return { id, url: file.uri, links: parsed.links.filter((link) => link.origin === id) };
  };

  /** Open URL with the cursor on LINE (0-based), or at the end. */
  async openAt(url, line, { end = false } = {}) {
    // Loading can take a while on Android storage, and the person may move
    // on meanwhile: to another file, or into a picker or dialog.  Note where
    // focus is now, and leave both alone if they changed.
    const focusedAtStart = document.activeElement;
    let file = editorManager.getFile(url, "uri");
    if (file) file.makeActive();
    else file = acode.newEditorFile(baseName(url), { uri: url, render: true });
    for (let waited = 0; !file.loaded && waited < 5000; waited += 50) await new Promise((r) => setTimeout(r, 50));
    if (editorManager.activeFile !== file) return;
    const view = this.view;
    const { doc } = view.state;
    const pos = end ? doc.length : doc.line(Math.min(Math.max(line + 1, 1), doc.lines)).from;
    const { EditorView } = acode.require("codemirror").view;
    view.dispatch({ selection: { anchor: pos }, effects: EditorView.scrollIntoView(pos, { y: "start", yMargin: 48 }) });
    const focused = document.activeElement;
    if (focused === focusedAtStart || focused === document.body || !focused || view.dom.contains(focused)) view.focus();
  }

  openNode = (node) => this.openAt(node.url, node.line);

  pick(options) {
    return pickNode({ nodes: this.graph.nodes, describe: this.describe, actionStack: this.actionStack, ...options });
  }

  async chooseRoot(title = "Create the note in", preferred = null) {
    if (this.roots.length === 1) return this.roots[0];
    const items = this.roots.map((root) => [root.url, `${this.rootTitle(root.url)}${root.kind === "notes" ? " (notes folder)" : ""}`]);
    const url = await acode.select(title, items, { default: preferred?.url ?? this.roots[0]?.url }).catch(() => null);
    return this.roots.find((root) => root.url === url) ?? null;
  }

  /**
   * Where a new note goes: the graph folder of the file you are in (the
   * repository you are working in), else the notes folder, else one you
   * choose.
   */
  async #rootForNewNote() {
    return this.#rootOfActiveFile() ?? this.roots.find((root) => root.kind === "notes") ?? (await this.chooseRoot());
  }

  /** The graph folder holding the active file, the deepest if they nest. */
  #rootOfActiveFile() {
    const uri = editorManager.activeFile?.uri;
    if (!uri) return null;
    return this.roots.filter((root) => relativePath(root.url, uri) != null).sort((a, b) => b.url.length - a.url.length)[0] ?? null;
  }

  /** Create a file note called TITLE in ROOT, as org-node-new-file would. */
  async createNote(title, root, { open = true } = {}) {
    if (!title?.trim()) {
      toast("A note needs a title");
      return null;
    }
    if (!root) {
      toast(NO_FOLDER_MESSAGE, 5000);
      return null;
    }
    const name = titleToFileName(title);
    const target = this.Url.join(root.url, name);
    try {
      if (await this.fsOperation(target).exists()) {
        toast(`${name} already exists in ${this.rootTitle(root.url)}`);
        return null;
      }
      const id = newId();
      const text = newNoteText(title.trim(), id);
      const url = (await this.fsOperation(root.url).createFile(name, text)) || target;
      await this.indexer.indexFile(url, text, this.roots);
      acode.require("fileIndex")?.update?.(root.url, { added: [{ url, parentUrl: root.url }] })?.catch?.(() => {});
      this.#scheduleCacheSave();
      if (open) await this.openAt(url, 0, { end: true });
      this.panel?.refresh();
      return this.graph.get(id);
    } catch (error) {
      console.error("[org-node] cannot create", name, error);
      toast(`Cannot create a note in ${this.rootTitle(root.url)}: ${error?.message ?? error}`, 5000);
      return null;
    }
  }

  /** Open the note with ID, re-reading the graph once if it is not known. */
  async openId(id) {
    let node = this.graph.get(id);
    if (!node && (await this.ensureIndexed())) {
      await this.reindex({ quiet: true });
      node = this.graph.get(id);
    }
    if (node) await this.openNode(node);
    else toast(`No note has the ID ${id}`, 4000);
  }

  /** Open a file: link's PATH, relative to the file at FROM. */
  async openRelative(from, path) {
    const folder = from.slice(0, from.length - baseName(from).length).replace(/\/$/, "");
    const url = /^[a-z]+:\/\//i.test(path) ? path : path.startsWith("/") ? `file://${path}` : this.Url.join(folder, path);
    if (!(await this.fsOperation(url).exists().catch(() => false))) return toast(`No file at ${path}`);
    await this.openAt(url, 0);
  }

  // ------------------------------------------------------------------
  // Org editing and preview, for any Org file

  /**
   * Apply EDIT, one of core/edit.js's commands, at the cursor of the active
   * Org file, as one undoable change.  Returns whether it applied.
   */
  orgEdit(edit) {
    const file = this.#activeOrgFile();
    if (!file) {
      toast("Org editing works in Org files");
      return false;
    }
    const view = this.view;
    const { state } = view;
    if (state.readOnly) {
      toast("This file is read-only");
      return false;
    }
    const lines = state.doc.toString().split("\n");
    const head = state.selection.main.head;
    const line = state.doc.lineAt(head);
    const result = edit(lines, line.number - 1);
    if (!result) return false;
    const change = lineChange(lines, result.lines);
    const anchor = offsetOf(result.lines, result.line, result.col ?? head - line.from);
    view.dispatch({ changes: change ?? [], selection: { anchor }, scrollIntoView: true, userEvent: "input" });
    return true;
  }

  /** The Org edits, by name: commands, the Org menu and the keys use them. */
  orgEdits = {
    todoNext: { label: "Cycle TODO →", run: (lines, line) => cycleTodo(lines, line, 1) },
    todoPrevious: { label: "Cycle TODO ←", run: (lines, line) => cycleTodo(lines, line, -1) },
    checkbox: { label: "Toggle checkbox", run: toggleCheckbox },
    insertHeading: { label: "New heading", run: insertHeading },
    promote: { label: "Promote heading", run: (lines, line) => shiftHeading(lines, line, -1) },
    demote: { label: "Demote heading", run: (lines, line) => shiftHeading(lines, line, 1) },
    promoteSubtree: { label: "Promote subtree", run: (lines, line) => shiftHeading(lines, line, -1, { subtree: true }) },
    demoteSubtree: { label: "Demote subtree", run: (lines, line) => shiftHeading(lines, line, 1, { subtree: true }) },
    moveUp: { label: "Move subtree up", run: (lines, line) => moveSubtree(lines, line, -1) },
    moveDown: { label: "Move subtree down", run: (lines, line) => moveSubtree(lines, line, 1) },
  };

  /** Run the Org edit NAME, saying so when it does not apply here. */
  runOrgEdit(name) {
    if (!this.orgEdit(this.orgEdits[name].run) && this.#activeOrgFile()) {
      toast(/checkbox/i.test(name) ? "No checkbox on this line" : "Nothing to do here: no heading, or no sibling");
    }
  }

  /** [Org] Preview the active Org file, or refresh the preview you are in. */
  async previewOrg() {
    const active = editorManager.activeFile;
    const entry = this.preview.entryFor(active);
    if (entry) return this.preview.render(entry);
    if (!this.#activeOrgFile()) return toast("Open an Org file to preview it");
    await this.preview.open(active);
  }

  /** The Org menu: every edit, and the preview, for a touch screen. */
  async orgMenu() {
    const items = [
      ["preview", "Preview"],
      ...Object.entries(this.orgEdits).map(([name, edit]) => [name, edit.label]),
    ];
    const choice = await acode.select("Org", items).catch(() => null);
    if (!choice) return;
    if (choice === "preview") await this.previewOrg();
    else {
      this.runOrgEdit(choice);
      this.view.focus();
    }
  }

  /** Org's keys in Org files; the ones for headings only act on a heading line. */
  #orgKeymap() {
    const onHeading = (view) => /^\*+[ \t]/.test(view.state.doc.lineAt(view.state.selection.main.head).text);
    const headingKey = (key, name) => ({ key, run: (view) => onHeading(view) && this.orgEdit(this.orgEdits[name].run) });
    return [
      headingKey("Shift-ArrowRight", "todoNext"),
      headingKey("Shift-ArrowLeft", "todoPrevious"),
      headingKey("Alt-ArrowLeft", "promote"),
      headingKey("Alt-ArrowRight", "demote"),
      headingKey("Shift-Alt-ArrowLeft", "promoteSubtree"),
      headingKey("Shift-Alt-ArrowRight", "demoteSubtree"),
      headingKey("Alt-ArrowUp", "moveUp"),
      headingKey("Alt-ArrowDown", "moveDown"),
      { key: "Mod-Enter", run: () => this.orgEdit(this.orgEdits.insertHeading.run) },
      { key: "Mod-Shift-Enter", run: () => this.orgEdit(this.orgEdits.checkbox.run) },
    ];
  }

  // ------------------------------------------------------------------
  // Commands (kittymacs' SPC n keys, in brackets)

  /** [SPC n f] Visit a note, or create one by typing a new title. */
  async find() {
    if (!(await this.ensureIndexed())) return;
    const choice = await this.pick({ placeholder: "Find or create a note", allowCreate: true });
    if (choice?.node) await this.openNode(choice.node);
    else if (choice?.create) await this.createNote(choice.create, await this.#rootForNewNote());
  }

  /** [SPC n i] Insert an id: link; selected text becomes its words. */
  async insertLink() {
    const file = this.#activeOrgFile();
    if (!file) return toast("Org-node links work in Org files only");
    if (!(await this.ensureIndexed())) return;
    const view = this.view;
    const { from, to } = view.state.selection.main;
    const selected = view.state.sliceDoc(from, to);
    const choice = await this.pick({ placeholder: "Link to note", initial: selected.trim(), allowCreate: true });
    if (!choice) return view.focus();
    let node = choice.node;
    if (!node) {
      node = await this.createNote(choice.create, await this.#rootForNewNote(), { open: false });
      if (!node) return;
    }
    if (editorManager.activeFile !== file) file.makeActive();
    const target = this.view;
    const link = makeIdLink(node.id, selected.trim() ? selected : node.title);
    target.dispatch({ changes: { from, to, insert: link }, selection: { anchor: from + link.length } });
    target.focus();
  }

  /** The id: link at POS in VIEW, or null. */
  linkAt(view, pos) {
    const line = view.state.doc.lineAt(pos);
    const col = pos - line.from;
    return findIdLinks(line.text).find((link) => col >= link.col && col <= link.end) ?? null;
  }

  /** [RET on a link] Open the note the id: link at the cursor points to. */
  async followLink(pos = this.view?.state.selection.main.head) {
    const view = this.view;
    const link = view && pos != null ? this.linkAt(view, pos) : null;
    if (!link) return toast("No id: link at the cursor");
    if (!(await this.ensureIndexed())) return;
    let node = this.graph.get(link.id);
    if (!node) {
      await this.reindex({ quiet: true });
      node = this.graph.get(link.id);
    }
    if (node) await this.openNode(node);
    else toast(`No note has the ID ${link.id}`, 4000);
  }

  /** [SPC n c] Create a note in a folder you choose. */
  async newNote() {
    if (!(await this.ensureIndexed())) return;
    const title = await acode.prompt("New note title", "", "text", { required: true });
    if (!title) return;
    const root = await this.chooseRoot("In folder", this.#rootOfActiveFile());
    if (root) await this.createNote(title, root);
  }

  /** [SPC n t] Choose a tag, then a note carrying it. */
  async findByTag() {
    if (!(await this.ensureIndexed())) return;
    const counts = this.graph.tagCounts();
    if (!counts.length) return toast("No tags in the graph; “Org-node: Rescan” reads it again");
    const tag = await acode
      .select("Tag", counts.map(([t, n]) => [t, `#${t}  ·  ${n} note${n === 1 ? "" : "s"}`]))
      .catch(() => null);
    if (!tag) return;
    const choice = await pickNode({
      nodes: this.graph.nodes.filter((node) => node.tags.includes(tag)),
      placeholder: `Note tagged #${tag}`,
      describe: this.describe,
      actionStack: this.actionStack,
    });
    if (choice?.node) await this.openNode(choice.node);
  }

  /** [SPC n T] Every tag with links to its notes, in an Org buffer. */
  async tagIndex() {
    if (!(await this.ensureIndexed())) return;
    const groups = this.graph.taggedNotes();
    if (!groups.length) return toast("No tags in the graph; “Org-node: Rescan” reads it again");
    const lines = ["#+title: Tags in the notes graph", ""];
    for (const [tag, notes] of groups) {
      lines.push(`* ${tag} (${notes.length})`);
      for (const node of notes) lines.push(`- ${makeIdLink(node.id, node.title)} · ${this.rootTitle(node.root)}/${node.rel}`);
    }
    acode.newEditorFile("org-node-tags.org", { text: `${lines.join("\n")}\n`, render: true, isUnsaved: false, readOnly: true });
  }

  /** [SPC n b] Show the links panel. */
  showBacklinks() {
    const tab = document.querySelector(`[data-action="sidebar-app"][data-id="${SIDEBAR_ID}"]`);
    tab?.click();
    if (!this.panel?.container?.offsetParent) acode.exec("toggle-sidebar");
    this.panel?.refresh();
  }

  /** [SPC n s] Read every file again and report what the graph holds. */
  rescan() {
    return this.reindex({ full: true });
  }

  async setNotesFolder() {
    const open = this.addedFolder().map((folder) => [folder.url, folder.title ?? baseName(folder.url)]);
    let url = await acode
      .select("Notes folder", [...open, ["browse", "Browse…"], ["none", "None: open git repositories only"]], {
        default: this.settings.notesFolder,
      })
      .catch(() => null);
    if (!url) return;
    if (url === "browse") url = (await acode.fileBrowser("folder", "Choose your notes folder").catch(() => null))?.url;
    if (!url) return;
    this.settings.notesFolder = url === "none" ? "" : url;
    await this.appSettings.update(false);
    await this.reindex();
  }

  async forgetProject() {
    const projects = this.#projects();
    const urls = Object.keys(projects);
    if (!urls.length) return toast("The graph has no project folders");
    const url = await acode.select("Forget project", urls.map((u) => [u, this.rootTitle(u)])).catch(() => null);
    if (!url) return;
    delete projects[url];
    this.#saveProjects(projects);
    toast("Opening that folder again adds it back while its .dir-locals.el has the flag", 5000);
    await this.reindex({ quiet: true });
  }

  #commands() {
    const run = (fn) => () => {
      fn.call(this)?.catch?.((error) => {
        console.error("[org-node]", error);
        toast(`Org-node: ${error?.message ?? error}`, 5000);
      });
      return true;
    };
    // Alt-Shift-<key> for a hardware keyboard; the same letters as SPC n.
    return [
      { name: "org-node.find", description: "Org-node: Find or create note", bindKey: "Alt-Shift-F", exec: run(this.find) },
      { name: "org-node.insert-link", description: "Org-node: Insert link to note", bindKey: "Alt-Shift-I", exec: run(this.insertLink) },
      { name: "org-node.follow-link", description: "Org-node: Open link at cursor", bindKey: "Alt-Shift-O", exec: run(() => this.followLink()) },
      { name: "org-node.new-note", description: "Org-node: New note in folder…", bindKey: "Alt-Shift-C", exec: run(this.newNote) },
      { name: "org-node.backlinks", description: "Org-node: Show links", bindKey: "Alt-Shift-B", exec: run(this.showBacklinks) },
      { name: "org-node.find-by-tag", description: "Org-node: Find note by tag", bindKey: "Alt-Shift-T", exec: run(this.findByTag) },
      { name: "org-node.tag-index", description: "Org-node: List tags and their notes", exec: run(this.tagIndex) },
      { name: "org-node.rescan", description: "Org-node: Rescan graph", bindKey: "Alt-Shift-S", exec: run(this.rescan) },
      { name: "org-node.set-notes-folder", description: "Org-node: Set notes folder", exec: run(this.setNotesFolder) },
      { name: "org-node.forget-project", description: "Org-node: Forget project", exec: run(this.forgetProject) },
      { name: "org.preview", description: "Org: Preview", bindKey: "Alt-Shift-P", exec: run(this.previewOrg) },
      { name: "org.menu", description: "Org: Menu of editing commands", exec: run(this.orgMenu) },
      // In Org files the editor also has Org's own keys for these (#orgKeymap).
      ...Object.entries(this.orgEdits).map(([name, edit]) => ({
        name: `org.${name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`,
        description: `Org: ${edit.label.replace(/ [→←]$/, (m) => (m.includes("→") ? " forward" : " backward"))}`,
        exec: run(() => this.runOrgEdit(name)),
      })),
    ];
  }

  #registerCommands() {
    const commands = acode.require("commands");
    for (const command of this.#commands()) commands.addCommand(command);
  }

  /**
   * Long-press menu items, the quickest way in on a touch screen.  Acode's
   * selection menu has no way to remove an item, so the items are added once
   * per app session and call whichever instance of the plugin is loaded.
   */
  #registerSelectionMenu() {
    window.__orgNodePlugin = this;
    if (window.__orgNodeSelectionMenu) return;
    window.__orgNodeSelectionMenu = true;
    const selectionMenu = acode.require("selectionMenu");
    const label = (text) => {
      const span = document.createElement("span");
      span.className = "org-node-menu-label";
      span.textContent = text;
      return span;
    };
    const call = (method) => () => {
      const active = window.__orgNodePlugin;
      if (!active) return toast("Org-node is turned off");
      active[method]()?.catch?.((error) => toast(`Org-node: ${error?.message ?? error}`));
    };
    selectionMenu.add(call("insertLink"), label("Link note"), "all", false, { id: "org-node-link", label: "Link note" });
    selectionMenu.add(call("followLink"), label("Open link"), "all", true, { id: "org-node-open", label: "Open link" });
  }

  #registerSidebar() {
    this.panel = new BacklinksPanel({
      graph: this.graph,
      current: this.currentNote,
      open: (url, line) => this.openAt(url, line),
      rescan: () => this.rescan(),
      actions: { find: () => this.find(), tags: () => this.findByTag(), new: () => this.newNote() },
    });
    acode.require("sidebarApps").add(
      ICON,
      SIDEBAR_ID,
      "Org-node",
      (container) => this.panel.mount(container),
      false,
      () => this.panel.refresh(),
    );
  }

  #registerOrgMode() {
    if (!this.settings.highlight || !editorManager.isCodeMirror) return;
    const languages = acode.require("editorLanguages");
    const existing = languages.get?.("org");
    if (existing) {
      this.#previousOrgMode = [existing.name, existing.extensions, existing.caption, existing.languageExtension];
      languages.unregister("org");
    }
    const cm = acode.require("codemirror");
    // Src blocks borrow Acode's language modes (built-in, or from plugins).
    const resolver = new LanguageResolver(languages, { exclude: ["org"] });
    languages.register("org", ["org", "org_archive"], "Org", () =>
      orgExtensions(cm, {
        resolver,
        keymap: this.#orgKeymap(),
        onCursor: () => this.panel?.refresh(),
        onLinkClick: (view, pos) => {
          if (!this.linkAt(view, pos)) return false;
          this.followLink(pos);
          return true;
        },
      }),
    );
    for (const file of editorManager.files ?? []) if (isNoteFileName(file.filename ?? "")) file.setMode?.("org");
  }

  /**
   * Two buttons on the editor's right edge while an Org file is open: Link,
   * one tap to insert a link where the command palette takes three; and Org,
   * the menu of editing commands and the preview.
   */
  #registerOrgButtons() {
    if (!this.settings.linkButton) return;
    const SideButton = acode.require("sideButton");
    if (!SideButton) return;
    const guard = (fn) => () => fn().catch?.((error) => toast(`Org-node: ${error?.message ?? error}`));
    this.linkButton = SideButton({ text: "Link", icon: ICON, onclick: guard(() => this.insertLink()) });
    this.orgButton = SideButton({ text: "Org", icon: ICON, onclick: guard(() => this.orgMenu()) });
    this.#updateOrgButtons();
  }

  #updateOrgButtons() {
    const show = Boolean(this.#activeOrgFile());
    for (const button of [this.linkButton, this.orgButton]) {
      if (!button) continue;
      if (show) button.show();
      else button.hide();
    }
  }

  #on(target, event, fn) {
    target.on ? target.on(event, fn) : target.addEventListener(event, fn);
    this.#listeners.push([target, event, fn]);
  }

  #listen() {
    this.#on(editorManager, "switch-file", () => {
      this.#updateOrgButtons();
      this.panel?.refresh();
      // A preview is drawn again each time it is shown, so it is never stale.
      const entry = this.preview.entryFor(editorManager.activeFile);
      if (entry) this.preview.render(entry);
    });
    this.#on(editorManager, "save-file", async (file) => {
      file ??= editorManager.activeFile;
      if (!file?.uri || !isNoteFileName(file.filename ?? "")) return;
      const preview = this.preview.previews.get(file.uri);
      if (preview) this.preview.render(preview);
      const view = editorManager.activeFile === file ? this.view : null;
      const text = view ? view.state.doc.toString() : file.session?.doc?.toString?.();
      if (text == null) return;
      if (await this.indexer.indexFile(file.uri, text, this.roots)) {
        acode.require("fileIndex")?.markDirty?.([file.uri])?.catch?.(() => {});
        this.#scheduleCacheSave();
        this.panel?.refresh();
      }
    });
    this.#on(editorManager, "add-folder", () => this.reindex({ quiet: true }).catch(() => {}));
    this.#on(editorManager, "rename-file", () => this.reindex({ quiet: true }).catch(() => {}));
    // Back from Termux after a `git pull`: re-read what changed.
    this.#on(document, "resume", () => this.reindex({ quiet: true }).catch(() => {}));
  }
}

function settingsPage(instance) {
  const appSettings = acode.require("settings");
  const value = { ...DEFAULTS, ...appSettings.value[plugin.id] };
  return {
    list: [
      {
        key: "notesFolder",
        text: "Notes folder (optional)",
        info: "A folder that is always in the graph, even when no repository is open (kittymacs-org-node-directory). Tap to choose one; “Org-node: Set notes folder” also offers your open folders, or none.",
        value: value.notesFolder,
        valueText: (v) => (v ? baseName(v) : "none: open git repositories only"),
        folder: true,
      },
      {
        key: "notesExcluded",
        text: "Folders to skip in the notes folder",
        info: "Comma-separated, relative to the notes folder, like kittymacs-org-node-excluded-directories: secrets, docs/old",
        value: value.notesExcluded,
        prompt: "Folders to skip",
        promptType: "text",
      },
      {
        key: "followProjects",
        text: "Open repositories join the graph",
        info: "Every git repository open in Acode's sidebar is in the graph while it is open. A folder whose .dir-locals.el sets kittymacs-org-node-project joins too, and is remembered.",
        checkbox: value.followProjects,
      },
      {
        key: "linkButton",
        text: "Link and Org buttons in Org files",
        info: "Buttons on the editor's right edge: Link inserts a link to a note; Org opens the editing commands and the preview. Takes effect after restarting Acode.",
        checkbox: value.linkButton,
      },
      {
        key: "highlight",
        text: "Org highlighting and folding",
        info: "Headings, links, tags, folding, and code in src blocks coloured by its language. Takes effect after restarting Acode.",
        checkbox: value.highlight,
      },
    ],
    cb: async (key, newValue) => {
      appSettings.value[plugin.id] = { ...DEFAULTS, ...appSettings.value[plugin.id], [key]: newValue };
      await appSettings.update(false);
      if (!["highlight", "linkButton"].includes(key)) instance.reindex({ quiet: key !== "notesFolder" }).catch(() => {});
    },
  };
}

if (window.acode) {
  const instance = new OrgNodePlugin();
  acode.setPluginInit(
    plugin.id,
    async (baseUrl, $page, { cacheFile } = {}) => {
      await instance.init($page, cacheFile);
    },
    settingsPage(instance),
  );
  acode.setPluginUnmount(plugin.id, () => instance.destroy());
}
