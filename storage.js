// Prompt Builder — shared localStorage helpers. Loaded before anything that uses them
// (favourites.js, history.js, presets.js, undo.js's consumers, app.js) — this is the
// actual fix for the "Roller is empty / tags don't show" crash: those files called
// loadSet()/loadArr() at their own top level, but the function was previously defined
// inside app.js, which loads LAST. Real <script> tags execute independently and in
// order, so that threw a ReferenceError immediately and killed every script after it.

function loadSet(key) {
  try { return new Set(JSON.parse(localStorage.getItem(key) || "[]")); } catch { return new Set(); }
}
function saveSet(key, set) { try { localStorage.setItem(key, JSON.stringify([...set])); } catch {} }
function loadArr(key) { try { return JSON.parse(localStorage.getItem(key) || "[]"); } catch { return []; } }
function saveArr(key, arr) { try { localStorage.setItem(key, JSON.stringify(arr)); } catch {} }
function loadObj(key) { try { return JSON.parse(localStorage.getItem(key) || "{}"); } catch { return {}; } }
function saveObj(key, obj) { try { localStorage.setItem(key, JSON.stringify(obj)); } catch {} }
