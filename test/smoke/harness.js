// A stand-in for Acode, for the smoke test: just the API the plugin uses,
// over an in-memory file system, with a real CodeMirror editor.
//
// It is bundled with the real @codemirror packages and loaded into Chromium
// before build/main.js, the same bundle Acode would load.

import { history, historyKeymap } from "@codemirror/commands";
import { javascript } from "@codemirror/lang-javascript";
import * as language from "@codemirror/language";
import * as lezerHighlight from "@lezer/highlight";
import * as state from "@codemirror/state";
import * as view from "@codemirror/view";

const { EditorState, Compartment } = state;
const { EditorView } = view;

window.setupAcode = ({ files, folders, settings, useFileIndex }) => {
  const fsData = new Map(Object.entries(files));
  const mtimes = new Map([...fsData.keys()].map((url) => [url, 1]));
  const log = { toasts: [], selects: [], scans: [] };
  const answers = { select: [], prompt: [] };
  const listeners = new Map();
  const commands = new Map();
  const selectionItems = [];
  const sidebar = new Map();
  const languages = new Map();
  const sideButtons = [];
  // Acode's Mode objects: a name, extensions, and a loader.
  const mode = (name, extensions, caption, loader) => ({ name, extensions, caption, languageExtension: loader ?? null, loader });
  // A built-in mode, as Acode has dozens: JavaScript, for src blocks.
  languages.set("javascript", mode("javascript", ["js", "mjs"], "JavaScript", () => javascript()));
  let unmount = null;
  let init = null;
  let settingsPage = null;

  const isDir = (url) => [...fsData.keys()].some((key) => key.startsWith(`${url}/`));
  const fsOperation = (url) => ({
    async exists() {
      return fsData.has(url) || isDir(url);
    },
    async readFile() {
      if (!fsData.has(url)) throw new Error(`ENOENT ${url}`);
      return fsData.get(url);
    },
    async writeFile(text) {
      fsData.set(url, text);
      mtimes.set(url, (mtimes.get(url) ?? 0) + 1);
    },
    async createFile(name, text) {
      const child = `${url}/${name}`;
      fsData.set(child, text);
      mtimes.set(child, 1);
      return child;
    },
    async stat() {
      return { url, name: url.split("/").pop(), modifiedDate: mtimes.get(url), size: fsData.get(url)?.length ?? 0, canWrite: true };
    },
    async lsDir() {
      const children = new Map();
      for (const key of fsData.keys()) {
        if (!key.startsWith(`${url}/`)) continue;
        const rest = key.slice(url.length + 1);
        const name = rest.split("/")[0];
        const dir = rest.includes("/");
        const child = `${url}/${name}`;
        children.set(name, {
          name,
          url: child,
          isDirectory: dir,
          isFile: !dir,
          modifiedDate: dir ? undefined : mtimes.get(child),
          size: dir ? undefined : fsData.get(child).length,
        });
      }
      return [...children.values()];
    },
  });

  const fileIndex = useFileIndex && {
    supports: (url) => url.startsWith("file://"),
    async scan(root) {
      log.scans.push(root.url);
      return { files: 0, dirs: 0 };
    },
    async whenReady() {},
    async query({ roots, text = "", limit = 200, cursor = 0 }) {
      const all = [...fsData.keys()]
        .filter((url) => roots.some((root) => url.startsWith(`${root}/`)) && url.toLowerCase().includes(text.toLowerCase()))
        .sort()
        .map((url) => ({ url, name: url.split("/").pop(), isFile: true, isDirectory: false, modifiedDate: mtimes.get(url), size: fsData.get(url).length }));
      const entries = all.slice(cursor, cursor + limit);
      return { entries, hasMore: cursor + limit < all.length, cursor: cursor + limit };
    },
    async update() {},
    async markDirty() {},
  };

  // --- The editor: one view, a state per open file. -------------------
  const host = document.createElement("div");
  host.id = "editor";
  document.body.append(host);
  const languageSlot = new Compartment();
  const readOnlySlot = new Compartment();
  const editor = new EditorView({ parent: host, state: EditorState.create({ doc: "" }) });
  const openFiles = [];
  let activeFile = null;

  const modeFor = (filename) => {
    for (const [name, m] of languages) if (m.extensions.some((ext) => filename.endsWith(`.${ext}`))) return name;
    return "text";
  };
  const extensionsFor = async (mode) => (languages.get(mode)?.loader ? await languages.get(mode).loader() : []);

  const emit = (event, ...args) => {
    for (const fn of listeners.get(event) ?? []) fn(...args);
  };

  class EditorFile {
    constructor(filename, { uri, text, readOnly = false, type = "editor", content, stylesheets, highlightStyles, render = true } = {}) {
      this.id = `file-${openFiles.length}`;
      this.filename = filename;
      this.uri = uri;
      this.type = type;
      this.loaded = false;
      this.mode = modeFor(filename);
      this.readOnly = readOnly;
      this.handlers = {};
      openFiles.push(this);
      if (type === "custom") {
        // Like Acode: the content goes into a shadow root, with the tab's styles.
        this.host = document.createElement("div");
        this.host.className = "custom-tab";
        const shadow = this.host.attachShadow({ mode: "open" });
        const style = document.createElement("style");
        // highlightStyles adopts Acode's highlight colours; the screenshots set some.
        style.textContent = [...[].concat(stylesheets ?? []), highlightStyles ? (window.__highlightCss ?? "") : ""].join("\n");
        shadow.append(style, content);
        document.body.append(this.host);
        this.loaded = true;
        this.ready = Promise.resolve();
        if (render) this.makeActive();
        return;
      }
      this.ready = (async () => {
        // harness.loadDelay makes loading slow, as Android storage can be.
        if (window.harness?.loadDelay) await new Promise((resolve) => setTimeout(resolve, window.harness.loadDelay));
        const doc = text ?? (await fsOperation(uri).readFile());
        this.state = EditorState.create({
          doc,
          extensions: [
            languageSlot.of(await extensionsFor(this.mode)),
            readOnlySlot.of(EditorState.readOnly.of(readOnly)),
            // What an Acode theme provides: colours for the highlight tags.
            // A script may set window.__editorTheme (the screenshots do).
            ...(window.__editorTheme ?? [language.syntaxHighlighting(language.defaultHighlightStyle)]),
            EditorView.lineWrapping,
            // Undo, as Acode's editor has it.
            history(),
            view.keymap.of(historyKeymap),
          ],
        });
        this.loaded = true;
      })();
      // As in Acode, render (the default) makes the new tab the active one.
      if (render) this.makeActive();
    }
    // Synchronous once loaded, like Acode's.
    makeActive() {
      if (!this.loaded) {
        this.ready.then(() => this.makeActive());
        return;
      }
      if (activeFile === this) return;
      if (activeFile && activeFile.type !== "custom") activeFile.state = editor.state;
      activeFile = this;
      if (this.type !== "custom") editor.setState(this.state);
      emit("switch-file", this);
    }
    // Acode's EditorFile.session is the file's state, live while it is active.
    get session() {
      return activeFile === this ? editor.state : this.state;
    }
    on(event, fn) {
      (this.handlers[event] ??= []).push(fn);
    }
    remove() {
      openFiles.splice(openFiles.indexOf(this), 1);
      this.host?.remove();
      for (const fn of this.handlers.close ?? []) fn();
      if (activeFile === this) activeFile = null;
    }
    async setMode(mode) {
      this.mode = mode;
      await this.ready;
      const effects = languageSlot.reconfigure(await extensionsFor(mode));
      if (activeFile === this) editor.dispatch({ effects });
      else this.state = this.state.update({ effects }).state;
    }
  }

  const editorManager = {
    editor,
    isCodeMirror: true,
    get activeFile() {
      return activeFile;
    },
    get files() {
      return openFiles;
    },
    getFile: (value, type) => openFiles.find((file) => file[type] === value) ?? null,
    on(event, fn) {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event).add(fn);
    },
    off(event, fn) {
      listeners.get(event)?.delete(fn);
    },
    emit,
  };

  const appSettings = { value: { ...settings }, update: async () => {} };
  const modules = {
    settings: appSettings,
    fsoperation: fsOperation,
    fs: fsOperation,
    url: { join: (...parts) => parts.join("/").replace(/([^:/])\/+/g, "$1/") },
    actionstack: { push() {}, remove() {} },
    fileindex: fileIndex || undefined,
    addedfolder: folders,
    commands: {
      addCommand: (command) => commands.set(command.name, command),
      removeCommand: (name) => commands.delete(name),
    },
    selectionmenu: { add: (onclick, text, mode, readOnly, options) => selectionItems.push({ onclick, text, mode, readOnly, ...options }) },
    sidebarapps: {
      add(icon, id, title, initApp, prepend, onSelected) {
        const container = document.createElement("div");
        container.dataset.app = id;
        document.body.append(container);
        sidebar.set(id, { container, onSelected });
        initApp(container);
      },
      remove(id) {
        sidebar.get(id)?.container.remove();
        sidebar.delete(id);
      },
    },
    editorlanguages: {
      register: (name, extensions, caption, loader) => languages.set(name, mode(name, extensions, caption, loader)),
      unregister: (name) => languages.delete(name),
      get: (name) => languages.get(name) ?? null,
      getForPath: (path) => [...languages.values()].find((m) => m.extensions.some((ext) => path.endsWith(`.${ext}`))) ?? mode("text", ["txt"], "Text"),
    },
    editorfile: EditorFile,
    sidebutton: ({ text, onclick }) => {
      const button = { text, onclick, shown: false, show: () => (button.shown = true), hide: () => (button.shown = false) };
      sideButtons.push(button);
      return button;
    },
    codemirror: { language, state, view, lezer: lezerHighlight },
    // Acode's static highlighter, reduced to marking what it was asked for
    // (the screenshots put a real one in window.__codeHighlight).
    codehighlight: {
      HIGHLIGHT_CLASS: "cm-highlighted",
      highlightCodeBlock: async (code, lang) =>
        window.__codeHighlight
          ? window.__codeHighlight(code, lang)
          : `<span class="tok-test" data-lang="${lang}">${code.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c])}</span>`,
    },
  };

  window.editorManager = editorManager;
  window.toast = (message) => log.toasts.push(message);
  window.acode = {
    require: (name) => modules[name.toLowerCase()],
    setPluginInit: (id, fn, page) => {
      init = fn;
      settingsPage = page;
    },
    setPluginUnmount: (id, fn) => {
      unmount = fn;
    },
    addIcon() {},
    exec() {},
    // Like Acode's: it makes the tab and returns nothing (the plugin must
    // use acode.require("EditorFile") to hold on to the tab it makes).
    newEditorFile(filename, options) {
      new EditorFile(filename, options);
    },
    async select(title, items) {
      log.selects.push(title);
      const answer = answers.select.shift();
      if (typeof answer === "function") return answer(items);
      return answer ?? (Array.isArray(items[0]) ? items[0][0] : items[0]);
    },
    async prompt() {
      return answers.prompt.shift() ?? null;
    },
    async fileBrowser() {
      return null;
    },
  };

  window.harness = {
    fsData,
    mtimes,
    log,
    answers,
    commands,
    selectionItems,
    sidebar,
    languages,
    sideButtons,
    editor,
    editorManager,
    get settingsPage() {
      return settingsPage;
    },
    init: () => init("file:///plugin/", null, { cacheFile: fsOperation("file:///cache/org-node.json") }),
    unmount: () => unmount(),
    run: (name) => commands.get(name).exec(editor),
    async open(uri) {
      const file = editorManager.getFile(uri, "uri") ?? new EditorFile(uri.split("/").pop(), { uri });
      await file.ready;
      await file.makeActive();
      return file;
    },
    cursorLine: () => editor.state.doc.lineAt(editor.state.selection.main.head).number - 1,
    activeUri: () => activeFile?.uri ?? null,
  };
};
