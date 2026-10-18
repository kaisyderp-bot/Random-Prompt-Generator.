// Prompt Builder — bounded Undo stack.
// Deliberately generic: every undo entry is { label, undo() }. undo() must restore
// exactly what changed and nothing else — it never touches the 139k-tag database, only
// the small pieces of state a single action actually changed (a Set entry, a tray array,
// one roller slot, etc).
//
// Call pushUndo({ label, undo }) right after a reversible action commits its change.
// Call performUndo() to pop and run the most recent one. The stack is capped at
// UNDO_STACK_LIMIT; past that, the oldest entries are silently dropped — undo is a
// convenience for "oops", not an audit log.

const UNDO_STACK_LIMIT = 50;
let undoStack = [];

function pushUndo(entry) {
  undoStack.push(entry);
  if (undoStack.length > UNDO_STACK_LIMIT) undoStack.shift();
  if (typeof renderUndoButton === "function") renderUndoButton();
}

function performUndo() {
  const entry = undoStack.pop();
  if (!entry) return false;
  try { entry.undo(); } catch (err) { console.error("Prompt Builder: undo failed for '" + entry.label + "'", err); }
  if (typeof renderUndoButton === "function") renderUndoButton();
  return true;
}

function peekUndoLabel() {
  return undoStack.length ? undoStack[undoStack.length - 1].label : null;
}

function clearUndoStack() {
  undoStack = [];
  if (typeof renderUndoButton === "function") renderUndoButton();
}
