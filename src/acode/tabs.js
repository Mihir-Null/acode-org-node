// Opening a tab and keeping hold of it.
//
// acode.newEditorFile() makes a tab but returns nothing (Acode's
// lib/acode.js: `new EditorFile(filename, options);`), so a plugin that
// needs the tab afterwards, to wait for it to load or to listen for it
// closing, constructs the EditorFile class itself, which Acode exports.

/**
 * Open a tab named FILENAME with OPTIONS (as acode.newEditorFile takes them)
 * and return its EditorFile.
 */
export function openTab(filename, options) {
  const EditorFile = acode.require("EditorFile");
  if (EditorFile) return new EditorFile(filename, options);
  // An Acode without the export: the new tab is the active one once made.
  acode.newEditorFile(filename, { ...options, render: true });
  return editorManager.activeFile;
}
