// Prompt Builder — app logic.
// Nothing in this file calls the internet except the optional, user-configured
// "Ask AI" tab, and that only runs if you paste in your own API key and click Ask.
// Everything else (hidden/deleted tags, section edits, your tray, locks, slot counts,
// shortcuts) lives only in this browser's localStorage, on this one computer.

runMigrations();

const LS_HIDDEN = "pb-hidden-tags";
const LS_DELETED = "pb-deleted-tags";
const LS_TRAY = "pb-tray";
const LS_ROW_COUNT = "pb-row-count";
const LS_SAVED = "pb-saved-rolls";
const LS_SECTION_OVERRIDES = "pb-section-overrides"; // { tagName: sectionId }
const LS_AI_SETTINGS = "pb-ai-settings"; // provider/endpoint/model, never the key unless Remember is checked
const LS_AI_KEY = "pb-ai-key";
const LS_SHORTCUTS = "pb-shortcuts";           // { actionId: "Ctrl+Enter", ... }
const LS_SHORTCUTS_ENABLED = "pb-shortcuts-enabled";
const LS_NSFW_ENABLED = "pb-nsfw-enabled";     // separate from Hidden/Deleted on purpose

const MIN_SLOTS = 1;
const MAX_SLOTS = 6;

// Order tags fall into whenever they're added to the tray automatically (the locked-roller
// button below), so the tray stays readable as it grows. Reorder this array to change it.
const TRAY_SECTION_ORDER = ["outfit", "accessory", "pose", "setting", "lighting", "mood", "hair", "makeup", "camera", "style"];

// Works out where a tag belongs for tray sorting, using the real section lookup (falls
// back to "after everything named above" for Unassigned / unknown tags).
function traySectionRank(tag) {
  const dbName = String(tag).trim().toLowerCase().replace(/ /g, "_");
  const section = typeof sectionOf === "function" ? sectionOf(dbName) : UNASSIGNED;
  const order = typeof sectionOrder !== "undefined" && sectionOrder.length ? sectionOrder : TRAY_SECTION_ORDER;
  const idx = order.indexOf(section);
  return idx === -1 ? order.length : idx;
}
// Sorts the WHOLE tray by section order, not just whatever was last added — so the tray
// stays correctly grouped no matter what order things were added in.
function sortTray() {
  tray.sort((a, b) => traySectionRank(a) - traySectionRank(b) || a.localeCompare(b));
}

const LS_PREVIEW_MODE = "pb-preview-mode";
let previewMode = (() => { try { return localStorage.getItem(LS_PREVIEW_MODE) || "tags"; } catch { return "tags"; } })();

let hiddenTags = loadSet(LS_HIDDEN);
let deletedTags = loadSet(LS_DELETED);
let tray = loadArr(LS_TRAY);
let sectionOverrides = loadObj(LS_SECTION_OVERRIDES);
let rowCounts = { ...Object.fromEntries(SECTION_IDS.map((s) => [s, 1])), ...loadObj(LS_ROW_COUNT) };

// A tag is removed (from search, Roller) if it's hidden OR deleted. The NSFW filter is
// kept deliberately separate — see mature-filter.js — so hiding a tame tag never
// depends on whether mature content happens to be switched on right now.
function isRemoved(nameRaw) {
  const n = nameRaw.toLowerCase();
  return hiddenTags.has(n) || deletedTags.has(n);
}

let nsfwEnabled = localStorage.getItem(LS_NSFW_ENABLED) === "1";
// True when a tag should never be randomly rolled or accepted from AI output — hidden/
// deleted, blocked, OR mature-while-NSFW-is-off. Used by the Roller and Ask AI.
function isFiltered(nameRaw) {
  if (isRemoved(nameRaw)) return true;
  if (typeof isBlocked === "function" && isBlocked(nameRaw)) return true;
  if (!nsfwEnabled && typeof isMatureTagName === "function" && isMatureTagName(nameRaw)) return true;
  return false;
}
// True when a tag should be hidden from Tag Library SEARCH entirely — hidden/deleted, OR
// mature-while-NSFW-is-off. Deliberately does NOT include Blocked: a blocked tag must
// stay searchable (so it can be unblocked later), it just never rolls. This is the one
// real difference between "filtered from rolling" and "filtered from search".
function isLibraryHidden(nameRaw) {
  if (isRemoved(nameRaw)) return true;
  if (!nsfwEnabled && typeof isMatureTagName === "function" && isMatureTagName(nameRaw)) return true;
  return false;
}

function escHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// ---- Toast ----
let toastTimer = null;
function toast(msg) {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 2000);
}
async function copyText(text) {
  try { await navigator.clipboard.writeText(text); toast("Copied."); }
  catch { toast("Could not copy — select and copy manually."); }
}

// ---- Confirm dialog (shared) ----
// Belt-and-braces: force it hidden at load, even if CSS specificity ever changes again.
document.getElementById("confirm-dialog").hidden = true;
function confirmAction(message) {
  return new Promise((resolve) => {
    const overlay = document.getElementById("confirm-dialog");
    document.getElementById("confirm-message").textContent = message;
    overlay.hidden = false;
    const yes = document.getElementById("confirm-yes");
    const no = document.getElementById("confirm-no");
    const cleanup = (result) => { overlay.hidden = true; yes.onclick = null; no.onclick = null; resolve(result); };
    yes.onclick = () => cleanup(true);
    no.onclick = () => cleanup(false);
  });
}

// ---- Tray ----
function renderTray() {
  document.getElementById("tray-content").textContent = tray.length ? tray.join(", ") : "Nothing picked yet.";
}
function trayAdd(tag) {
  if (!tag) return;
  if (tray.includes(tag)) return; // already there, nothing to undo
  tray.push(tag);
  sortTray();
  saveArr(LS_TRAY, tray);
  renderTray();
  renderPromptPreview();
  if (typeof pushUndo === "function") {
    pushUndo({ label: `Add "${tag}" to tray`, undo: () => {
      tray = tray.filter((t) => t !== tag);
      saveArr(LS_TRAY, tray);
      renderTray();
      renderPromptPreview();
    }});
  }
}
function trayCopyAction() { copyText(tray.join(", ")); }
function trayClearAction() {
  if (!tray.length) return;
  const previous = tray.slice();
  tray = [];
  saveArr(LS_TRAY, tray);
  renderTray();
  renderPromptPreview();
  if (typeof pushUndo === "function" && previous.length) {
    pushUndo({ label: "Clear tray", undo: () => {
      tray = previous.slice();
      saveArr(LS_TRAY, tray);
      renderTray();
      renderPromptPreview();
    }});
  }
}
document.getElementById("tray-copy").onclick = trayCopyAction;
document.getElementById("tray-clear").onclick = trayClearAction;

// ---- Tabs ----
document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach((b) => b.classList.toggle("active", b === btn));
    document.querySelectorAll(".pane").forEach((p) => p.classList.toggle("active", p.id === "tab-" + btn.dataset.tab));
    if (btn.dataset.tab === "library") renderLibrary();
    if (btn.dataset.tab === "removed") renderRemoved();
    if (btn.dataset.tab === "characters") renderCharacters();
    if (btn.dataset.tab === "settings") renderShortcutSettings();
    if (btn.dataset.tab === "preview") renderPromptPreview();
  });
});

// ==================== CHARACTERS ====================
// Saved character bases are intentionally independent from Presets. A character can be
// added by itself or automatically included with a user-initiated Roll; it never changes
// the ten random Roller rows.
let editingCharacterId = null;

function addCharacterTagsToTray(character, label = "Character added to tray.") {
  if (!character?.tags?.length) return 0;
  const before = tray.slice();
  const existing = new Set(tray.map((tag) => tag.toLowerCase()));
  let added = 0, skippedMature = 0;
  for (const tag of character.tags) {
    if (existing.has(tag.toLowerCase())) continue;
    // Same single switch as everywhere else in the app: when NSFW is allowed, nothing is
    // ever excluded — including your own saved character tags. When it's off, mature
    // tags are filtered consistently, the same as the Roller and Tag Library. This never
    // edits or deletes anything in the SAVED character — it only decides what enters the
    // tray right now. Turn NSFW back on and add the character again: every tag returns.
    if (!nsfwEnabled && typeof isMatureTagName === "function" && isMatureTagName(tag)) { skippedMature++; continue; }
    tray.push(tag); existing.add(tag.toLowerCase()); added++;
  }
  if (skippedMature && typeof toast === "function") {
    toast(`${skippedMature} mature tag(s) from this character were left out — mature content is off. Turn it on in Settings to include them.`);
  }
  if (!added) return 0;
  sortTray(); saveArr(LS_TRAY, tray); renderTray(); renderPromptPreview();
  if (typeof pushUndo === "function") {
    pushUndo({ label: `Add character "${character.name}"`, undo: () => {
      tray = before.slice(); saveArr(LS_TRAY, tray); renderTray(); renderPromptPreview();
    }});
  }
  if (label) toast(label);
  return added;
}

function useActiveCharacterWithRoll() {
  // Deliberately unused by plain Roll — see rollWithCharacterAction() below, the
  // dedicated action for rolling together with a character. Plain Roll never merges
  // a character in, so there is exactly one way this happens, not two that can disagree.
  const character = getActiveCharacter();
  if (!character?.useWithRoller) return;
  const added = addCharacterTagsToTray(character, "");
  if (added) toast(`Rolled with ${character.name}: added ${added} character tag(s) to tray.`);
}

// Builds the full combined output for "Roll with character": the selected character's
// base tags first (stable identity), then every currently rolled tag across all ten
// sections in the user's section order, each list deduplicated against what's already
// in the tray. This is the one place that merges character + Roller output, so Preview,
// Copy, and exports (which all read from `tray`) see the complete result, not just half
// of it — see the "half-broken preview" risk this was built to avoid.
function rollWithCharacterAction() {
  const character = getActiveCharacter();
  if (!character) { toast("Select a saved character first."); return; }
  if (!character.tags?.length) { toast(`"${character.name}" has no base tags saved.`); return; }

  const trayBefore = tray.slice();
  const rowsBefore = SECTION_IDS.map((s) => ({ section: s, slots: rollerRows[s].map((slot) => ({ ...slot })) }));

  for (const s of SECTION_IDS) rollRow(s, true);
  renderRoller();

  const existing = new Set(tray.map((t) => t.toLowerCase()));
  let added = 0, skippedMature = 0;
  const addIfNew = (tag) => {
    if (!tag || tag === "(no tags available)" || existing.has(tag.toLowerCase())) return;
    if (!nsfwEnabled && typeof isMatureTagName === "function" && isMatureTagName(tag)) { skippedMature++; return; }
    tray.push(tag); existing.add(tag.toLowerCase()); added++;
  };
  for (const tag of character.tags) addIfNew(tag);
  const order = typeof sectionOrder !== "undefined" && sectionOrder.length ? sectionOrder : SECTION_IDS;
  for (const section of order) for (const slot of rollerRows[section] || []) addIfNew(slot.tag);

  sortTray();
  saveArr(LS_TRAY, tray);
  renderTray();
  renderPromptPreview();
  if (typeof pushHistory === "function") pushHistory();

  // One single undo step restores BOTH the rolled rows and the tray — not two separate
  // undo entries the user would have to press twice with no indication why.
  if (typeof pushUndo === "function") {
    pushUndo({ label: `Roll with character "${character.name}"`, undo: () => {
      for (const { section, slots } of rowsBefore) rollerRows[section] = slots.map((s) => ({ ...s }));
      tray = trayBefore.slice();
      saveArr(LS_TRAY, tray);
      renderRoller(); renderTray(); renderPromptPreview();
    }});
  }

  toast(skippedMature
    ? `Rolled with ${character.name}. ${skippedMature} mature tag(s) left out — mature content is off.`
    : `Rolled with ${character.name}.`);
}

// Keeps the Roller's "Roll with character" dropdown in sync with the saved character
// list and the one active-character selection shared with the Characters tab —
// selecting here IS selecting there, there is no second competing selection to disagree.
function renderRollCharacterSelect() {
  const select = document.getElementById("roll-character-select");
  const button = document.getElementById("roll-with-character");
  const hint = document.getElementById("roll-character-hint");
  const explain = document.getElementById("roll-character-explain");
  if (!select) return;
  const list = loadCharacters();
  const active = getActiveCharacter();
  select.innerHTML = '<option value="">No character selected</option>' +
    list.map((c) => `<option value="${c.id}" ${active?.id === c.id ? "selected" : ""}>${escHtml(c.name)}</option>`).join("");
  const hasCharacters = list.length > 0;
  select.disabled = !hasCharacters;
  button.disabled = !active;
  if (hint) hint.hidden = hasCharacters;
  if (explain) explain.hidden = !active;
}
document.getElementById("roll-character-select")?.addEventListener("change", (e) => {
  if (e.target.value) setActiveCharacter(e.target.value);
  else localStorage.removeItem(LS_ACTIVE_CHARACTER);
  renderRollCharacterSelect();
  if (document.getElementById("tab-characters")?.classList.contains("active")) renderCharacters();
});
document.getElementById("roll-with-character")?.addEventListener("click", rollWithCharacterAction);

function resetCharacterEditor() {
  editingCharacterId = null;
  document.getElementById("character-name-input").value = "";
  document.getElementById("character-tags-input").value = "";
  document.getElementById("character-note-input").value = "";
  document.getElementById("character-save").textContent = "Save character";
  document.getElementById("character-cancel-edit").hidden = true;
}
function beginCharacterEdit(id) {
  const character = loadCharacters().find((item) => item.id === id);
  if (!character) return;
  editingCharacterId = id;
  document.getElementById("character-name-input").value = character.name;
  document.getElementById("character-tags-input").value = character.tags.join(", ");
  document.getElementById("character-note-input").value = character.note || "";
  document.getElementById("character-save").textContent = "Save changes";
  document.getElementById("character-cancel-edit").hidden = false;
  document.getElementById("character-name-input").focus();
}
function renderCharacters() {
  const box = document.getElementById("characters-list");
  const empty = document.getElementById("characters-empty");
  const active = getActiveCharacter();
  const list = loadCharacters();
  empty.hidden = list.length > 0;
  box.innerHTML = list.map((character) => {
    const selected = active?.id === character.id;
    return `<article class="character-card ${selected ? "active-character" : ""}" data-character-id="${character.id}">
      <div class="character-card-head"><strong>${escHtml(character.name)}</strong>${selected ? '<span class="active-character-badge">Selected</span>' : ""}</div>
      <p class="character-tags">${character.tags.map(escHtml).join(", ")}</p>
      ${character.note ? `<p class="character-note">Private note: ${escHtml(character.note)}</p>` : ""}
      <label class="checkbox-row"><input type="checkbox" data-character-use="${character.id}" ${character.useWithRoller ? "checked" : ""} ${selected ? "" : "disabled"}> Use selected character with Roller</label>
      <div class="character-actions">
        <button type="button" data-character-select="${character.id}" ${selected ? "disabled" : ""}>${selected ? "Selected" : "Select"}</button>
        <button type="button" data-character-add="${character.id}">Add to tray</button>
        <button type="button" data-character-edit="${character.id}">Edit</button>
        <button type="button" data-character-duplicate="${character.id}">Duplicate</button>
        <button type="button" class="danger-btn" data-character-delete="${character.id}">Delete</button>
      </div>
    </article>`;
  }).join("");
}

document.getElementById("character-save").addEventListener("click", () => {
  const name = document.getElementById("character-name-input").value;
  const tags = document.getElementById("character-tags-input").value;
  const note = document.getElementById("character-note-input").value;
  const updating = !!editingCharacterId;
  const result = updating ? updateCharacter(editingCharacterId, { name, tags, note }) : createCharacter(name, tags, note);
  if (!result) { toast("Give the character a name and at least one base tag."); return; }
  setActiveCharacter(result.id);
  resetCharacterEditor(); renderCharacters(); renderRollCharacterSelect();
  toast(updating ? "Character updated." : "Character saved.");
});
document.getElementById("character-cancel-edit").addEventListener("click", resetCharacterEditor);
document.getElementById("characters-list").addEventListener("click", async (event) => {
  const target = event.target;
  const select = target.closest("[data-character-select]");
  if (select) { setActiveCharacter(select.dataset.characterSelect); renderCharacters(); renderRollCharacterSelect(); toast("Character selected."); return; }
  const add = target.closest("[data-character-add]");
  if (add) { const character = loadCharacters().find((item) => item.id === add.dataset.characterAdd); addCharacterTagsToTray(character); return; }
  const edit = target.closest("[data-character-edit]");
  if (edit) { beginCharacterEdit(edit.dataset.characterEdit); return; }
  const duplicate = target.closest("[data-character-duplicate]");
  if (duplicate) { duplicateCharacter(duplicate.dataset.characterDuplicate); renderCharacters(); toast("Character duplicated."); return; }
  const remove = target.closest("[data-character-delete]");
  if (remove) {
    const character = loadCharacters().find((item) => item.id === remove.dataset.characterDelete);
    if (!await confirmAction(`Delete character "${character?.name || ""}"? This cannot be undone.`)) return;
    deleteCharacter(remove.dataset.characterDelete); resetCharacterEditor(); renderCharacters(); renderRollCharacterSelect(); toast("Character deleted.");
  }
});
// Old per-character "Use with Roller" checkbox is gone — the Roller's own dropdown
// (see renderRollCharacterSelect / rollWithCharacterAction above) is the single place
// that decides which character is active, so there's no second control to disagree with it.

renderRollCharacterSelect();

// ==================== SECTION LOOKUP (with user overrides) ====================
// Built once at startup: name(lowercase, underscores) -> section id. Cheap because it's
// one pass over data.js, not a per-render scan.
const tagSectionMap = new Map();
for (const row of DANBOORU_TAGS) {
  const name = row[0];
  tagSectionMap.set(name, sectionOverrides[name] || defaultSectionFor(row));
}
function sectionOf(name) { return tagSectionMap.get(name) || sectionOverrides[name] || UNASSIGNED; }
function setSectionOverride(name, sectionId) {
  if (sectionId === UNASSIGNED) delete sectionOverrides[name]; else sectionOverrides[name] = sectionId;
  tagSectionMap.set(name, sectionId);
  saveObj(LS_SECTION_OVERRIDES, sectionOverrides);
}

// ---- Pool of candidate tags for a section (curated list + anything assigned to it) ----
function slotPool(section) {
  const curated = (ROLLER_SLOTS[section] || []).filter((t) => !isFiltered(t.tag));
  const seen = new Set(curated.map((t) => t.tag.toLowerCase().replace(/ /g, "_")));
  const pool = curated.slice();
  for (const [name, sec] of tagSectionMap) {
    if (sec !== section) continue;
    if (seen.has(name) || isFiltered(name)) continue;
    seen.add(name);
    pool.push({ tag: name.replace(/_/g, " "), desc: "" });
  }
  return pool;
}

function pickOne(pool, exclude = new Set()) {
  const options = pool.filter((t) => !exclude.has(t.tag.toLowerCase()));
  const from = options.length ? options : pool;
  if (!from.length) return null;
  return from[Math.floor(Math.random() * from.length)];
}

// ==================== ROLLER (multi-slot rows) ====================
// rollerRows[section] = [{ id, tag, desc, locked }, ...]
let rollerRows = {};
let nextSlotId = 1;

function initRows(target, counts) {
  for (const section of SECTION_IDS) {
    const n = Math.min(MAX_SLOTS, Math.max(MIN_SLOTS, counts[section] || 1));
    target[section] = Array.from({ length: n }, () => ({ id: nextSlotId++, tag: null, desc: "", locked: false }));
  }
}
initRows(rollerRows, rowCounts);

function rollRow(section, keepLocked = true) {
  const pool = typeof weightedPool === "function" ? weightedPool(slotPool(section)) : slotPool(section);
  const slots = rollerRows[section];
  const usedThisRow = new Set();
  for (const slot of slots) {
    if (keepLocked && slot.locked && slot.tag) { usedThisRow.add(slot.tag.toLowerCase()); continue; }
    const picked = pickOne(pool, usedThisRow);
    if (picked) { slot.tag = picked.tag; slot.desc = picked.desc || ""; usedThisRow.add(picked.tag.toLowerCase()); }
    else { slot.tag = "(no tags available)"; slot.desc = ""; }
  }
}
function rollAllRows(keepLocked = true, recordHistory = true) {
  const before = typeof pushUndo === "function"
    ? SECTION_IDS.map((s) => ({ section: s, slots: rollerRows[s].map((slot) => ({ ...slot })) }))
    : null;
  for (const s of SECTION_IDS) rollRow(s, keepLocked);
  renderRoller();
  renderPromptPreview();
  if (recordHistory) useActiveCharacterWithRoll();
  if (recordHistory && typeof pushHistory === "function") pushHistory();
  if (before) {
    pushUndo({ label: "Roll", undo: () => {
      for (const { section, slots } of before) rollerRows[section] = slots.map((s) => ({ ...s }));
      renderRoller();
      renderPromptPreview();
    }});
  }
}
function rollAllAction() { rollAllRows(true, true); }

// Rerolls exactly one slot, avoiding duplicates against the OTHER tags already showing
// in that same row. A locked slot refuses outright — unlock it first.
function rerollSlot(section, slotId) {
  const slots = rollerRows[section];
  const slot = slots.find((s) => s.id === slotId);
  if (!slot || slot.locked) return;
  const previousTag = slot.tag, previousDesc = slot.desc;
  const pool = typeof weightedPool === "function" ? weightedPool(slotPool(section)) : slotPool(section);
  const others = new Set(slots.filter((s) => s.id !== slotId && s.tag).map((s) => s.tag.toLowerCase()));
  const picked = pickOne(pool, others);
  if (picked) { slot.tag = picked.tag; slot.desc = picked.desc || ""; }
  else { slot.tag = "(no tags available)"; slot.desc = ""; }
  renderRoller();
  renderPromptPreview();
  if (typeof pushUndo === "function") {
    pushUndo({ label: "Reroll one slot", undo: () => {
      const s = (rollerRows[section] || []).find((x) => x.id === slotId);
      if (s) { s.tag = previousTag; s.desc = previousDesc; renderRoller(); renderPromptPreview(); }
    }});
  }
}

// Order sections render in across Roller, tray sorting, preview grouping, and exports.
// Persisted separately from TRAY_SECTION_ORDER's hard-coded default so a user's custom
// order survives reload; falls back to the shipped default for anyone who's never
// reordered anything.
const LS_SECTION_ORDER = "pb-section-order";
let sectionOrder = (() => {
  const saved = loadArr(LS_SECTION_ORDER);
  const valid = saved.filter((s) => SECTION_IDS.includes(s));
  const missing = SECTION_IDS.filter((s) => !valid.includes(s));
  return valid.length ? [...valid, ...missing] : SECTION_IDS.slice();
})();
function saveSectionOrder() { saveArr(LS_SECTION_ORDER, sectionOrder); }
function moveSectionUp(section) {
  const i = sectionOrder.indexOf(section);
  if (i <= 0) return;
  const before = sectionOrder.slice();
  [sectionOrder[i - 1], sectionOrder[i]] = [sectionOrder[i], sectionOrder[i - 1]];
  saveSectionOrder();
  renderRoller();
  if (typeof pushUndo === "function") {
    pushUndo({ label: `Move ${SECTION_LABELS[section]} up`, undo: () => {
      sectionOrder = before.slice(); saveSectionOrder(); renderRoller();
    }});
  }
}
function moveSectionDown(section) {
  const i = sectionOrder.indexOf(section);
  if (i === -1 || i >= sectionOrder.length - 1) return;
  const before = sectionOrder.slice();
  [sectionOrder[i + 1], sectionOrder[i]] = [sectionOrder[i], sectionOrder[i + 1]];
  saveSectionOrder();
  renderRoller();
  if (typeof pushUndo === "function") {
    pushUndo({ label: `Move ${SECTION_LABELS[section]} down`, undo: () => {
      sectionOrder = before.slice(); saveSectionOrder(); renderRoller();
    }});
  }
}

function renderRoller() {
  const box = document.getElementById("roller-rows");
  box.innerHTML = sectionOrder.map((section, idx) => {
    const slots = rollerRows[section];
    const cards = slots.map((slot) => `
      <div class="roller-card" data-slot-id="${slot.id}">
        <button type="button" class="lock-btn" data-lock="${slot.id}" title="Lock this slot">${slot.locked ? "🔒" : "🔓"}</button>
        <div class="slot-tag">${escHtml(slot.tag ?? "—")}</div>
        <div class="slot-desc">${escHtml(slot.desc || "")}</div>
        <div class="card-actions">
          <button type="button" class="reroll-btn" data-reroll="${slot.id}" data-reroll-section="${section}" title="${slot.locked ? "Unlock first to reroll just this one" : "Reroll just this one"}" ${slot.locked ? "disabled" : ""}>🎲</button>
          <button type="button" class="add-btn" data-add="${escHtml(slot.tag || "")}">+ Add to tray</button>
        </div>
      </div>`).join("");
    return `<div class="section-row" data-section="${section}">
      <div class="section-row-head">
        <span class="section-row-label">${SECTION_LABELS[section]}</span>
        <span class="row-reorder">
          <button type="button" class="reorder-btn" data-move-up="${section}" title="Move this section up" ${idx === 0 ? "disabled" : ""}>↑</button>
          <button type="button" class="reorder-btn" data-move-down="${section}" title="Move this section down" ${idx === sectionOrder.length - 1 ? "disabled" : ""}>↓</button>
        </span>
        <span class="row-counter">
          <button type="button" class="row-minus" data-row-minus="${section}" ${slots.length <= MIN_SLOTS ? "disabled" : ""}>−</button>
          <span>${slots.length}/${MAX_SLOTS}</span>
          <button type="button" class="row-plus" data-row-plus="${section}" ${slots.length >= MAX_SLOTS ? "disabled" : ""}>+</button>
        </span>
      </div>
      <div class="section-row-cards">${cards}</div>
    </div>`;
  }).join("");
}

document.getElementById("roller-rows").addEventListener("click", (e) => {
  const up = e.target.closest("[data-move-up]");
  if (up) { moveSectionUp(up.dataset.moveUp); return; }
  const down = e.target.closest("[data-move-down]");
  if (down) { moveSectionDown(down.dataset.moveDown); return; }
  const plus = e.target.closest("[data-row-plus]");
  if (plus) {
    const section = plus.dataset.rowPlus;
    if (rollerRows[section].length < MAX_SLOTS) {
      const pool = typeof weightedPool === "function" ? weightedPool(slotPool(section)) : slotPool(section);
      const used = new Set(rollerRows[section].map((s) => (s.tag || "").toLowerCase()));
      const picked = pickOne(pool, used) || { tag: "(no tags available)", desc: "" };
      rollerRows[section].push({ id: nextSlotId++, tag: picked.tag, desc: picked.desc || "", locked: false });
      rowCounts[section] = rollerRows[section].length;
      saveObj(LS_ROW_COUNT, rowCounts);
      renderRoller();
      if (typeof pushUndo === "function") {
        pushUndo({ label: `Add a slot to ${SECTION_LABELS[section]}`, undo: () => {
          rollerRows[section].pop();
          rowCounts[section] = rollerRows[section].length;
          saveObj(LS_ROW_COUNT, rowCounts);
          renderRoller();
        }});
      }
    }
    return;
  }
  const minus = e.target.closest("[data-row-minus]");
  if (minus) {
    const section = minus.dataset.rowMinus;
    if (rollerRows[section].length > MIN_SLOTS) {
      const removed = rollerRows[section][rollerRows[section].length - 1];
      rollerRows[section].pop();
      rowCounts[section] = rollerRows[section].length;
      saveObj(LS_ROW_COUNT, rowCounts);
      renderRoller();
      if (typeof pushUndo === "function") {
        pushUndo({ label: `Remove a slot from ${SECTION_LABELS[section]}`, undo: () => {
          rollerRows[section].push({ ...removed });
          rowCounts[section] = rollerRows[section].length;
          saveObj(LS_ROW_COUNT, rowCounts);
          renderRoller();
        }});
      }
    }
    return;
  }
  const lock = e.target.closest("[data-lock]");
  if (lock) {
    const id = Number(lock.dataset.lock);
    for (const section of SECTION_IDS) {
      const slot = rollerRows[section].find((s) => s.id === id);
      if (slot) { slot.locked = !slot.locked; renderRoller(); return; }
    }
    return;
  }
  const reroll = e.target.closest("[data-reroll]");
  if (reroll && !reroll.disabled) { rerollSlot(reroll.dataset.rerollSection, Number(reroll.dataset.reroll)); return; }
  const add = e.target.closest("[data-add]");
  if (add && add.dataset.add) trayAdd(add.dataset.add);
});

function copyAllAction() {
  const all = SECTION_IDS.flatMap((s) => rollerRows[s].map((slot) => slot.tag).filter(Boolean));
  copyText(all.join(", "));
}
function saveRollAction() {
  const saved = loadArr(LS_SAVED);
  const all = SECTION_IDS.flatMap((s) => rollerRows[s].map((slot) => slot.tag).filter(Boolean));
  saved.unshift({ date: new Date().toISOString(), tags: all });
  saveArr(LS_SAVED, saved.slice(0, 50));
  toast("Saved.");
}
function addLockedAction() {
  // Collect every currently locked slot, in the user's current section order (not the
  // hard-coded default), skip empty/"(no tags available)" slots, skip anything already
  // in the tray.
  const locked = [];
  const order = typeof sectionOrder !== "undefined" && sectionOrder.length ? sectionOrder : TRAY_SECTION_ORDER;
  for (const section of order) {
    for (const slot of rollerRows[section] || []) {
      if (slot.locked && slot.tag && slot.tag !== "(no tags available)") locked.push(slot.tag);
    }
  }
  if (!locked.length) { toast("Nothing is locked right now."); return; }
  const before = tray.length;
  for (const tag of locked) trayAdd(tag);
  const added = tray.length - before;
  toast(added ? `Added ${added} locked tag(s) to the tray.` : "Those locked tags were already in the tray.");
}

document.getElementById("roller-roll").onclick = rollAllAction;
document.getElementById("roller-copy").onclick = copyAllAction;
document.getElementById("roller-save").onclick = saveRollAction;
document.getElementById("roller-add-locked").onclick = addLockedAction;

// ==================== PROMPT PREVIEW (Tags / LLM-style / Both) ====================
// LLM-style mode is a local, deterministic template — NOT an AI call, no key needed,
// works fully offline. For an actual AI-rewritten prompt, that's the separate Ask AI tab.
function currentTrayOrdered() {
  // Tray is already kept sorted by sortTray(), so this is just a defensive copy.
  return tray.slice();
}

function llmStyleDescription() {
  const bySection = {};
  for (const tag of tray) {
    const dbName = tag.toLowerCase().replace(/ /g, "_");
    const sec = sectionOf(dbName);
    (bySection[sec] ||= []).push(tag);
  }
  const PHRASE = {
    outfit: "Wearing", accessory: "Accessorised with", pose: "Posed",
    setting: "In", lighting: "With", mood: "Mood is", hair: "Hair styled as",
    makeup: "Makeup:", camera: "Shot", style: "Rendered in",
  };
  const parts = [];
  const order = typeof sectionOrder !== "undefined" && sectionOrder.length ? sectionOrder : TRAY_SECTION_ORDER;
  for (const section of order) {
    const tags = bySection[section];
    if (!tags || !tags.length) continue;
    const joined = tags.length === 1 ? tags[0] : tags.slice(0, -1).join(", ") + " and " + tags[tags.length - 1];
    parts.push(`${PHRASE[section] || "Also"} ${joined}`);
  }
  if (bySection[UNASSIGNED] && bySection[UNASSIGNED].length) {
    parts.push(`Also featuring ${bySection[UNASSIGNED].join(", ")}`);
  }
  return parts.length ? parts.join(". ") + "." : "Nothing in the tray yet — add some tags first.";
}

function renderPromptPreview() {
  const box = document.getElementById("preview-content");
  if (!box) return; // pane not in this build
  document.querySelectorAll(".preview-mode-btn").forEach((b) => b.classList.toggle("active", b.dataset.previewMode === previewMode));

  const tagsText = currentTrayOrdered().join(", ") || "Nothing in the tray yet.";
  const llmText = llmStyleDescription();

  if (previewMode === "tags") {
    box.innerHTML = `<div class="preview-block"><h4>Tags</h4><pre>${escHtml(tagsText)}</pre></div>`;
  } else if (previewMode === "llm") {
    box.innerHTML = `<div class="preview-block"><h4>LLM-style description <span class="experimental-badge" style="color:var(--muted);border-color:var(--muted);">generated locally</span></h4><pre>${escHtml(llmText)}</pre></div>`;
  } else {
    box.innerHTML =
      `<div class="preview-block"><h4>Tags</h4><pre>${escHtml(tagsText)}</pre></div>` +
      `<div class="preview-block"><h4>LLM-style description <span class="experimental-badge" style="color:var(--muted);border-color:var(--muted);">generated locally</span></h4><pre>${escHtml(llmText)}</pre></div>`;
  }
}

document.querySelectorAll(".preview-mode-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    previewMode = btn.dataset.previewMode;
    try { localStorage.setItem(LS_PREVIEW_MODE, previewMode); } catch {}
    renderPromptPreview();
  });
});

document.getElementById("preview-copy").addEventListener("click", () => {
  const text = previewMode === "tags" ? currentTrayOrdered().join(", ")
    : previewMode === "llm" ? llmStyleDescription()
    : currentTrayOrdered().join(", ") + "\n\n" + llmStyleDescription();
  copyText(text);
});

document.getElementById("preview-download").addEventListener("click", () => {
  const text = previewMode === "tags" ? currentTrayOrdered().join(", ")
    : previewMode === "llm" ? llmStyleDescription()
    : currentTrayOrdered().join(", ") + "\n\n" + llmStyleDescription();
  const blob = new Blob([text], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = "prompt.txt";
  a.click();
  URL.revokeObjectURL(url);
});

// ==================== TAG LIBRARY ====================
let libraryOffset = 0;
const LIBRARY_PAGE = 100;

// Precomputed once: all tags sorted by popularity, so filtering doesn't re-sort 138k
// rows on every keystroke.
const tagsByPopularity = DANBOORU_TAGS.slice().sort((a, b) => b[2] - a[2]);

// Fill the section filter dropdown once at startup.
{
  const sel = document.getElementById("library-section");
  for (const s of SECTION_IDS) {
    const opt = document.createElement("option");
    opt.value = s; opt.textContent = SECTION_LABELS[s];
    sel.appendChild(opt);
  }
}

function sectionOptionsHtml(selected) {
  const opts = [`<option value="unassigned" ${selected === "unassigned" ? "selected" : ""}>Unassigned</option>`];
  for (const s of SECTION_IDS) {
    opts.push(`<option value="${s}" ${selected === s ? "selected" : ""}>${SECTION_LABELS[s]}</option>`);
  }
  return opts.join("");
}

function renderLibrary(reset = true) {
  if (reset) libraryOffset = 0;
  const needle = document.getElementById("library-search").value.trim().toLowerCase();
  const cat = document.getElementById("library-category").value;
  const sectionFilter = document.getElementById("library-section").value;
  const favOnly = document.getElementById("library-fav-only")?.checked;

  let filtered = tagsByPopularity;
  if (needle) {
    // Alias-aware: matches the canonical name OR any known alias, but always displays
    // and adds the canonical tag — see aliases.js.
    filtered = filtered.filter((row) => row[0].includes(needle) || (typeof tagMatchesAlias === "function" && tagMatchesAlias(row[0], needle)));
  }
  if (cat) filtered = filtered.filter((row) => row[1] === cat);
  if (sectionFilter) filtered = filtered.filter((row) => sectionOf(row[0]) === sectionFilter);
  if (favOnly) filtered = filtered.filter((row) => isFavourite(row[0]));
  filtered = filtered.filter((row) => !isLibraryHidden(row[0])); // blocked tags still show here, just not in rolls

  document.getElementById("library-count").textContent = filtered.length.toLocaleString();

  const page = filtered.slice(libraryOffset, libraryOffset + LIBRARY_PAGE);
  const list = document.getElementById("library-list");
  const html = page.map((row) => {
    const name = row[0].replace(/_/g, " ");
    const sec = sectionOf(row[0]);
    const fav = isFavourite(row[0]);
    const blocked = isBlocked(row[0]);
    return `<span class="tag-chip${blocked ? " blocked-chip" : ""}" data-tag="${escHtml(row[0])}">
      ${escHtml(name)} <span class="chip-count">${row[2].toLocaleString()}</span>
      <select class="section-select" data-section-for="${escHtml(row[0])}">${sectionOptionsHtml(sec)}</select>
      <button type="button" class="fav-btn${fav ? " active" : ""}" data-fav="${escHtml(row[0])}" title="${fav ? "Unfavourite" : "Favourite (rolls more often)"}">${fav ? "★" : "☆"}</button>
      <button type="button" data-tray="${escHtml(name)}" title="Add to tray">+</button>
      ${blocked
        ? `<span class="blocked-label" title="Blocked — searchable here, never rolled">Blocked</span>`
        : `<button type="button" data-block="${escHtml(row[0])}" title="Block from rolling (stays searchable here)">Block</button>`}
      <button type="button" data-hide="${escHtml(row[0])}" title="Hide this tag">Hide</button>
    </span>`;
  }).join("");
  if (reset) list.innerHTML = html; else list.insertAdjacentHTML("beforeend", html);

  document.getElementById("library-more").hidden = libraryOffset + LIBRARY_PAGE >= filtered.length;
}

document.getElementById("library-search").addEventListener("input", () => renderLibrary(true));
document.getElementById("library-category").addEventListener("change", () => renderLibrary(true));
document.getElementById("library-section").addEventListener("change", () => renderLibrary(true));
document.getElementById("library-more").addEventListener("click", () => { libraryOffset += LIBRARY_PAGE; renderLibrary(false); });

document.getElementById("library-list").addEventListener("click", (e) => {
  const trayBtn = e.target.closest("[data-tray]");
  if (trayBtn) { trayAdd(trayBtn.dataset.tray); return; }
  const favBtn = e.target.closest("[data-fav]");
  if (favBtn) { toggleFavourite(favBtn.dataset.fav); return; }
  const blockBtn = e.target.closest("[data-block]");
  if (blockBtn) {
    const name = blockBtn.dataset.block;
    blockedTags.add(name);
    saveSet(LS_BLOCKED, blockedTags);
    toast("Blocked. It stays searchable here, but never rolls. Unblock it from Removed.");
    renderLibrary(true);
    pushUndo({ label: `Block "${name.replace(/_/g, " ")}"`, undo: () => {
      blockedTags.delete(name); saveSet(LS_BLOCKED, blockedTags); renderLibrary(true); renderRemoved();
    }});
    return;
  }
  const hideBtn = e.target.closest("[data-hide]");
  if (hideBtn) {
    const name = hideBtn.dataset.hide;
    hiddenTags.add(name);
    saveSet(LS_HIDDEN, hiddenTags);
    toast("Hidden. Find it under Removed if you want it back.");
    renderLibrary(true);
    pushUndo({ label: `Hide "${name.replace(/_/g, " ")}"`, undo: () => {
      hiddenTags.delete(name); saveSet(LS_HIDDEN, hiddenTags); renderLibrary(true); renderRemoved();
    }});
  }
});
document.getElementById("library-list").addEventListener("change", (e) => {
  const sel = e.target.closest("[data-section-for]");
  if (!sel) return;
  const name = sel.dataset.sectionFor;
  const previous = sectionOf(name);
  setSectionOverride(name, sel.value);
  renderRoller();
  toast("Section updated.");
  pushUndo({ label: `Section change for "${name.replace(/_/g, " ")}"`, undo: () => {
    setSectionOverride(name, previous); renderRoller(); renderLibrary(true);
  }});
});

// ==================== REMOVED (hidden + deleted, merged) ====================
function renderRemoved() {
  const hiddenList = document.getElementById("hidden-list");
  const hiddenEmpty = document.getElementById("hidden-empty");
  const names = [...hiddenTags];
  hiddenEmpty.hidden = names.length > 0;
  hiddenList.innerHTML = names.map((name) => `
    <span class="tag-chip hidden-chip" data-tag="${escHtml(name)}">
      ${escHtml(name.replace(/_/g, " "))}
      <button type="button" data-restore="${escHtml(name)}">↺ Restore</button>
      <button type="button" class="danger-btn" data-delete-permanent="${escHtml(name)}">Delete permanently</button>
    </span>
  `).join("");

  const deletedList = document.getElementById("deleted-list");
  const deletedEmpty = document.getElementById("deleted-empty");
  const deletedNames = [...deletedTags];
  deletedEmpty.hidden = deletedNames.length > 0;
  deletedList.innerHTML = deletedNames.map((name) => `
    <span class="tag-chip deleted-chip" data-tag="${escHtml(name)}">
      ${escHtml(name.replace(/_/g, " "))}
      <em class="muted">deleted on this device</em>
    </span>
  `).join("");

  const blockedList = document.getElementById("blocked-list");
  const blockedEmpty = document.getElementById("blocked-empty");
  const blockedNames = [...blockedTags];
  if (blockedEmpty) blockedEmpty.hidden = blockedNames.length > 0;
  if (blockedList) blockedList.innerHTML = blockedNames.map((name) => `
    <span class="tag-chip blocked-chip" data-tag="${escHtml(name)}">
      ${escHtml(name.replace(/_/g, " "))}
      <button type="button" data-unblock="${escHtml(name)}">↺ Unblock</button>
    </span>
  `).join("");
}

document.getElementById("hidden-list").addEventListener("click", async (e) => {
  const restore = e.target.closest("[data-restore]");
  if (restore) {
    const name = restore.dataset.restore;
    hiddenTags.delete(name);
    saveSet(LS_HIDDEN, hiddenTags);
    renderRemoved();
    pushUndo({ label: `Restore "${name.replace(/_/g, " ")}"`, undo: () => {
      hiddenTags.add(name); saveSet(LS_HIDDEN, hiddenTags); renderRemoved(); renderLibrary(true);
    }});
    return;
  }
  const del = e.target.closest("[data-delete-permanent]");  if (del) {
    const name = del.dataset.deletePermanent;
    const ok = await confirmAction(
      `Permanently delete "${name.replace(/_/g, " ")}"? This cannot be undone from inside the app — it will be marked deleted on this device, for good, in every tab here.`
    );
    if (!ok) return;
    hiddenTags.delete(name);
    deletedTags.add(name);
    saveSet(LS_HIDDEN, hiddenTags);
    saveSet(LS_DELETED, deletedTags);
    toast("Deleted permanently.");
    renderRemoved();
    renderRoller();
  }
});

document.getElementById("blocked-list")?.addEventListener("click", (e) => {
  const unblock = e.target.closest("[data-unblock]");
  if (!unblock) return;
  const name = unblock.dataset.unblock;
  blockedTags.delete(name);
  saveSet(LS_BLOCKED, blockedTags);
  renderRemoved();
  renderLibrary(true);
  pushUndo({ label: `Unblock "${name.replace(/_/g, " ")}"`, undo: () => {
    blockedTags.add(name); saveSet(LS_BLOCKED, blockedTags); renderRemoved(); renderLibrary(true);
  }});
});

// ---- Undo button (tray bar) ----
function renderUndoButton() {
  const btn = document.getElementById("tray-undo");
  if (!btn) return;
  const label = peekUndoLabel();
  btn.hidden = !label;
  if (label) btn.title = "Undo: " + label;
}
document.getElementById("tray-undo")?.addEventListener("click", () => performUndo());
renderUndoButton();

// ==================== SETTINGS: FAVOURITES, HISTORY, PREVIEW DEFAULTS ====================
{
  const favWeightEl = document.getElementById("fav-weight-select");
  if (favWeightEl) {
    favWeightEl.value = String(favWeight);
    favWeightEl.addEventListener("change", () => {
      favWeight = parseInt(favWeightEl.value, 10) || 3;
      localStorage.setItem(LS_FAV_WEIGHT, String(favWeight));
      toast("Favourite weight updated.");
    });
  }
  const historySizeEl = document.getElementById("history-size-select");
  if (historySizeEl) {
    const saved = parseInt(localStorage.getItem("pb-history-limit"), 10);
    historySizeEl.value = String(Number.isFinite(saved) ? saved : HISTORY_LIMIT);
    historySizeEl.addEventListener("change", () => {
      const n = parseInt(historySizeEl.value, 10) || 40;
      localStorage.setItem("pb-history-limit", String(n));
      // Trim existing history to the new, smaller limit immediately if it shrank.
      const list = loadHistory();
      if (list.length > n) { saveArr(LS_HISTORY, list.slice(0, n)); renderHistory(); }
      toast("History size updated.");
    });
  }
  const defaultPreviewEl = document.getElementById("default-preview-select");
  if (defaultPreviewEl) {
    defaultPreviewEl.value = previewMode;
    defaultPreviewEl.addEventListener("change", () => {
      previewMode = defaultPreviewEl.value;
      try { localStorage.setItem(LS_PREVIEW_MODE, previewMode); } catch {}
      renderPromptPreview();
      toast("Default preview updated.");
    });
  }
}

// ==================== SETTINGS: KEYBOARD SHORTCUTS ====================
// A small registry of actions that can be bound to a key combo. Programmable and
// toggleable from the Settings tab — nothing here is hard-coded for the user to be
// stuck with. Browser-reserved combos (Ctrl+C/V/R/T/W/L etc.) are rejected at record
// time so a shortcut can never break copy/paste or the browser itself.
const SHORTCUT_ACTIONS = [
  { id: "roll", label: "Roll all unlocked", run: rollAllAction, default: "Ctrl+Enter" },
  { id: "addLocked", label: "Add all locked to tray", run: addLockedAction, default: "" },
  { id: "copyAll", label: "Copy all (Roller)", run: copyAllAction, default: "" },
  { id: "saveRoll", label: "Save this roll", run: saveRollAction, default: "" },
  { id: "trayCopy", label: "Copy tray", run: trayCopyAction, default: "" },
  { id: "trayClear", label: "Clear tray", run: trayClearAction, default: "" },
  { id: "focusSearch", label: "Focus tag search", run: () => {
      document.querySelector('[data-tab="library"]').click();
      document.getElementById("library-search").focus();
    }, default: "/" },
];
const RESERVED_COMBOS = new Set(["Ctrl+C", "Ctrl+V", "Ctrl+X", "Ctrl+A", "Ctrl+R", "Ctrl+T", "Ctrl+W", "Ctrl+N", "Ctrl+L", "Ctrl+P", "F5", "F11", "F12"]);

let shortcuts = { ...Object.fromEntries(SHORTCUT_ACTIONS.map((a) => [a.id, a.default])), ...loadObj(LS_SHORTCUTS) };
let shortcutsEnabled = localStorage.getItem(LS_SHORTCUTS_ENABLED) !== "0";

function comboFromEvent(e) {
  const parts = [];
  if (e.ctrlKey) parts.push("Ctrl");
  if (e.metaKey) parts.push("Meta");
  if (e.altKey) parts.push("Alt");
  if (e.shiftKey) parts.push("Shift");
  const key = e.key.length === 1 ? e.key.toUpperCase() : e.key;
  if (!["Control", "Meta", "Alt", "Shift"].includes(e.key)) parts.push(key);
  return parts.join("+");
}
function isTypingTarget(el) {
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
}

document.addEventListener("keydown", (e) => {
  if (!shortcutsEnabled) return;
  if (isTypingTarget(e.target)) return;
  if (recordingActionId) return; // handled separately while recording
  const combo = comboFromEvent(e);
  if (!combo) return;
  for (const action of SHORTCUT_ACTIONS) {
    if (shortcuts[action.id] && shortcuts[action.id] === combo) {
      e.preventDefault();
      action.run();
      return;
    }
  }
});

let recordingActionId = null;
function renderShortcutSettings() {
  document.getElementById("shortcuts-enabled").checked = shortcutsEnabled;
  const list = document.getElementById("shortcuts-list");
  list.innerHTML = SHORTCUT_ACTIONS.map((a) => `
    <div class="shortcut-row" data-action="${a.id}">
      <span class="shortcut-label">${escHtml(a.label)}</span>
      <span class="shortcut-combo" data-combo-for="${a.id}">${shortcuts[a.id] ? escHtml(shortcuts[a.id]) : "<em>none</em>"}</span>
      <button type="button" data-record="${a.id}">Record…</button>
      <button type="button" data-clear-shortcut="${a.id}" title="Remove this shortcut">Clear</button>
    </div>
  `).join("");
}

document.getElementById("shortcuts-enabled").addEventListener("change", (e) => {
  shortcutsEnabled = e.target.checked;
  localStorage.setItem(LS_SHORTCUTS_ENABLED, shortcutsEnabled ? "1" : "0");
});

document.getElementById("shortcuts-list").addEventListener("click", async (e) => {
  const clearBtn = e.target.closest("[data-clear-shortcut]");
  if (clearBtn) {
    const id = clearBtn.dataset.clearShortcut;
    delete shortcuts[id];
    saveObj(LS_SHORTCUTS, shortcuts);
    renderShortcutSettings();
    return;
  }
  const recordBtn = e.target.closest("[data-record]");
  if (!recordBtn) return;
  const id = recordBtn.dataset.record;
  const comboEl = document.querySelector(`[data-combo-for="${id}"]`);
  const originalText = comboEl.textContent;
  comboEl.textContent = "Press a key combo… (Esc to cancel)";
  recordingActionId = id;
  recordBtn.disabled = true;

  const handler = async (ev) => {
    ev.preventDefault();
    if (ev.key === "Escape") { cleanup(); comboEl.textContent = originalText; return; }
    if (["Control", "Meta", "Alt", "Shift"].includes(ev.key)) return; // wait for a real key
    const combo = comboFromEvent(ev);
    cleanup();
    if (RESERVED_COMBOS.has(combo)) {
      toast(`"${combo}" is reserved by the browser and can't be used.`);
      renderShortcutSettings();
      return;
    }
    const conflictAction = SHORTCUT_ACTIONS.find((a) => a.id !== id && shortcuts[a.id] === combo);
    if (conflictAction) {
      const ok = await confirmAction(`"${combo}" is already used for "${conflictAction.label}". Move it to this action instead?`);
      if (!ok) { renderShortcutSettings(); return; }
      delete shortcuts[conflictAction.id];
    }
    shortcuts[id] = combo;
    saveObj(LS_SHORTCUTS, shortcuts);
    renderShortcutSettings();
  };
  function cleanup() {
    document.removeEventListener("keydown", handler, true);
    recordingActionId = null;
    recordBtn.disabled = false;
  }
  document.addEventListener("keydown", handler, true);
});

document.getElementById("shortcuts-restore-defaults").addEventListener("click", async () => {
  const ok = await confirmAction("Restore every shortcut to its default? Any custom keys you've set will be replaced.");
  if (!ok) return;
  shortcuts = Object.fromEntries(SHORTCUT_ACTIONS.map((a) => [a.id, a.default]));
  saveObj(LS_SHORTCUTS, shortcuts);
  renderShortcutSettings();
  toast("Shortcuts reset to defaults.");
});

// ==================== BACKUP & RESET (now under Settings) ====================
document.getElementById("data-export").onclick = () => {
  const backup = {
    version: 3,
    exportedAt: new Date().toISOString(),
    hiddenTags: [...hiddenTags],
    deletedTags: [...deletedTags],
    sectionOverrides,
    rowCounts,
    tray,
    savedRolls: loadArr(LS_SAVED),
    shortcuts,
    shortcutsEnabled,
    nsfwEnabled,
    sectionOrder,
    favouriteTags: typeof favouriteTags !== "undefined" ? [...favouriteTags] : [],
    blockedTags: typeof blockedTags !== "undefined" ? [...blockedTags] : [],
    favWeight: typeof favWeight !== "undefined" ? favWeight : 3,
    presets: typeof loadPresets === "function" ? loadPresets() : [],
    characters: typeof loadCharacters === "function" ? loadCharacters() : [],
    activeCharacterId: typeof getActiveCharacter === "function" ? getActiveCharacter()?.id || null : null,
    rollHistory: typeof loadHistory === "function" ? loadHistory() : [],
    historyLimit: typeof currentHistoryLimit === "function" ? currentHistoryLimit() : 40,
    previewMode,
    // API keys are never exported, on purpose.
  };
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = "prompt-builder-backup.json";
  a.click();
  URL.revokeObjectURL(url);
  toast("Backup downloaded.");
};

document.getElementById("data-import").onclick = () => document.getElementById("data-import-file").click();
document.getElementById("data-import-file").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const text = await file.text();
    const data = JSON.parse(text);
    if (typeof data !== "object" || data === null) throw new Error("Not a valid backup file.");
    const ok = await confirmAction("Import this backup? It will replace everything on this device: tags, favourites, blocked tags, presets, history, settings, and the tray.");
    if (!ok) return;
    hiddenTags = new Set(Array.isArray(data.hiddenTags) ? data.hiddenTags : []);
    deletedTags = new Set(Array.isArray(data.deletedTags) ? data.deletedTags : []);
    sectionOverrides = typeof data.sectionOverrides === "object" && data.sectionOverrides ? data.sectionOverrides : {};
    rowCounts = typeof data.rowCounts === "object" && data.rowCounts ? data.rowCounts : rowCounts;
    // Older backups (v1) had a sceneRowCounts field — harmlessly ignored, Scene Builder no longer exists.
    tray = Array.isArray(data.tray) ? data.tray : [];
    if (typeof data.shortcuts === "object" && data.shortcuts) shortcuts = data.shortcuts;
    if (typeof data.shortcutsEnabled === "boolean") {
      shortcutsEnabled = data.shortcutsEnabled;
      localStorage.setItem(LS_SHORTCUTS_ENABLED, shortcutsEnabled ? "1" : "0");
    }
    if (typeof data.nsfwEnabled === "boolean") {
      nsfwEnabled = data.nsfwEnabled;
      localStorage.setItem(LS_NSFW_ENABLED, nsfwEnabled ? "1" : "0");
      const nsfwEl = document.getElementById("nsfw-enabled");
      if (nsfwEl) nsfwEl.checked = nsfwEnabled;
    }
    if (Array.isArray(data.sectionOrder) && data.sectionOrder.length) {
      const valid = data.sectionOrder.filter((s) => SECTION_IDS.includes(s));
      const missing = SECTION_IDS.filter((s) => !valid.includes(s));
      sectionOrder = [...valid, ...missing];
      saveArr(LS_SECTION_ORDER, sectionOrder);
    }
    if (Array.isArray(data.favouriteTags) && typeof favouriteTags !== "undefined") {
      favouriteTags = new Set(data.favouriteTags);
      saveSet(LS_FAVOURITES, favouriteTags);
    }
    if (Array.isArray(data.blockedTags) && typeof blockedTags !== "undefined") {
      blockedTags = new Set(data.blockedTags);
      saveSet(LS_BLOCKED, blockedTags);
    }
    if (typeof data.favWeight === "number" && typeof favWeight !== "undefined") {
      favWeight = data.favWeight;
      localStorage.setItem(LS_FAV_WEIGHT, String(favWeight));
      const favWeightEl = document.getElementById("fav-weight-select");
      if (favWeightEl) favWeightEl.value = String(favWeight);
    }
    if (Array.isArray(data.presets) && typeof savePresets === "function") {
      savePresets(data.presets);
    }
    if (Array.isArray(data.characters) && typeof saveCharacters === "function") {
      saveCharacters(data.characters);
      if (data.activeCharacterId) setActiveCharacter(data.activeCharacterId);
      else localStorage.removeItem(LS_ACTIVE_CHARACTER);
    }
    if (Array.isArray(data.rollHistory) && typeof saveHistory === "function") {
      saveHistory(data.rollHistory);
    }
    if (typeof data.historyLimit === "number") {
      localStorage.setItem(LS_HISTORY_LIMIT, String(data.historyLimit));
      const historySizeEl = document.getElementById("history-size-select");
      if (historySizeEl) historySizeEl.value = String(data.historyLimit);
    }
    if (typeof data.previewMode === "string") {
      previewMode = data.previewMode;
      try { localStorage.setItem(LS_PREVIEW_MODE, previewMode); } catch {}
    }
    saveSet(LS_HIDDEN, hiddenTags);
    saveSet(LS_DELETED, deletedTags);
    saveObj(LS_SECTION_OVERRIDES, sectionOverrides);
    saveObj(LS_ROW_COUNT, rowCounts);
    saveArr(LS_TRAY, tray);
    saveObj(LS_SHORTCUTS, shortcuts);
    if (Array.isArray(data.savedRolls)) saveArr(LS_SAVED, data.savedRolls);
    tagSectionMap.clear();
    for (const row of DANBOORU_TAGS) tagSectionMap.set(row[0], sectionOverrides[row[0]] || defaultSectionFor(row));
    initRows(rollerRows, rowCounts);
    renderRoller(); renderTray(); renderRemoved(); renderShortcutSettings(); renderPromptPreview();
    if (typeof renderLibrary === "function") renderLibrary(true);
    if (typeof renderPresets === "function") renderPresets();
    if (typeof renderCharacters === "function") { resetCharacterEditor(); renderCharacters(); }
    if (typeof renderHistory === "function") renderHistory();
    toast("Backup imported.");
  } catch (err) {
    toast("That file isn't a valid backup: " + err.message);
  }
  e.target.value = "";
});

document.getElementById("data-reset").onclick = async () => {
  const ok = await confirmAction("Reset everything on this device? This clears all tags, favourites, blocked tags, presets, history, settings, and the tray. Export a backup first if you're not sure.");
  if (!ok) return;
  for (const key of [
    LS_HIDDEN, LS_DELETED, LS_TRAY, LS_ROW_COUNT, LS_SAVED, LS_SECTION_OVERRIDES,
    LS_SHORTCUTS, LS_SHORTCUTS_ENABLED, LS_NSFW_ENABLED, LS_SECTION_ORDER,
    LS_FAVOURITES, LS_BLOCKED, LS_FAV_WEIGHT, LS_PRESETS, LS_CHARACTERS, LS_ACTIVE_CHARACTER, LS_HISTORY, LS_HISTORY_LIMIT,
    LS_PREVIEW_MODE,
  ]) {
    try { localStorage.removeItem(key); } catch {}
  }
  location.reload();
};

// Privacy tab's wipe button: same effect as "Reset everything" above (every key this
// app writes, API key already excluded since it's never saved), kept as a second,
// clearly-labelled entry point for a public page where a visitor's first stop for
// "delete my data" is reasonably the Privacy section, not Backup & reset.
document.getElementById("privacy-wipe")?.addEventListener("click", async () => {
  const ok = await confirmAction("Delete everything this app has saved on this device? This clears every tag, character, preset, and setting. It cannot affect any other device or browser.");
  if (!ok) return;
  for (const key of [
    LS_HIDDEN, LS_DELETED, LS_TRAY, LS_ROW_COUNT, LS_SAVED, LS_SECTION_OVERRIDES,
    LS_SHORTCUTS, LS_SHORTCUTS_ENABLED, LS_NSFW_ENABLED, LS_SECTION_ORDER,
    LS_FAVOURITES, LS_BLOCKED, LS_FAV_WEIGHT, LS_PRESETS, LS_CHARACTERS, LS_ACTIVE_CHARACTER, LS_HISTORY, LS_HISTORY_LIMIT,
    LS_PREVIEW_MODE, LS_AI_SETTINGS,
  ]) {
    try { localStorage.removeItem(key); } catch {}
  }
  location.reload();
});

// ==================== SETTINGS: CONTENT FILTERING (NSFW toggle) ====================
// Kept deliberately separate from the Hidden/Deleted system — see mature-filter.js.
// Default is OFF (mature tags filtered out) on every fresh copy of this app.
{
  const nsfwEl = document.getElementById("nsfw-enabled");
  nsfwEl.checked = nsfwEnabled;
  nsfwEl.addEventListener("change", () => {
  nsfwEnabled = nsfwEl.checked;
  localStorage.setItem(LS_NSFW_ENABLED, nsfwEnabled ? "1" : "0");
  // Turning it OFF must remove mature tags everywhere, including locked slots and the
  // tray — a lock means "don't change this while rolling," not "exempt from the content
  // filter." The lock itself is kept (so the slot rerolls instead of going silent), but
  // the mature tag inside it does not survive.
  if (!nsfwEnabled) {
    for (const section of SECTION_IDS) {
      for (const slot of rollerRows[section] || []) {
        if (slot.tag && isMatureTagName(slot.tag)) { slot.tag = null; slot.desc = ""; }
      }
    }
    for (const section of SECTION_IDS) rollRow(section, true);
    const before = tray.length;
    tray = tray.filter((t) => !isMatureTagName(t));
    if (tray.length !== before) { saveArr(LS_TRAY, tray); renderTray(); renderPromptPreview(); }
  }
  renderRoller();
  renderLibrary(true);
  toast(nsfwEnabled ? "Mature tags allowed." : "Mature tags filtered.");
  });
  }

// ==================== ASK AI (experimental) ====================
const aiSettings = loadObj(LS_AI_SETTINGS);
document.getElementById("ai-provider").value = aiSettings.provider || "deepseek";
document.getElementById("ai-endpoint").value = aiSettings.endpoint || "";
document.getElementById("ai-model").value = aiSettings.model || "";
// No remembered API key on load — this is a public page, potentially sharing a
// browser origin with other GitHub Pages sites under the same account. The key
// lives only in this input field's live memory for the current page view; see
// saveAiSettings() below, which deliberately never touches the key.

const PROVIDER_DEFAULTS = {
  deepseek: { endpoint: "https://api.deepseek.com/chat/completions", model: "deepseek-chat" },
  openai: { endpoint: "https://api.openai.com/v1/chat/completions", model: "gpt-4o-mini" },
  custom: { endpoint: "", model: "" },
};
document.getElementById("ai-provider").addEventListener("change", (e) => {
  const d = PROVIDER_DEFAULTS[e.target.value];
  if (d) {
    if (!document.getElementById("ai-endpoint").value) document.getElementById("ai-endpoint").value = d.endpoint;
    if (!document.getElementById("ai-model").value) document.getElementById("ai-model").value = d.model;
  }
});

// Saves provider/endpoint/model only — never the API key. The key is read fresh
// from the input field at the moment "Ask" is pressed (see below) and is never
// written to localStorage, an export, or anywhere else.
function saveAiSettings() {
  saveObj(LS_AI_SETTINGS, {
    provider: document.getElementById("ai-provider").value,
    endpoint: document.getElementById("ai-endpoint").value,
    model: document.getElementById("ai-model").value,
  });
  // API key is deliberately never saved — see note above.
}
["ai-provider", "ai-endpoint", "ai-model"].forEach((id) => document.getElementById(id).addEventListener("change", saveAiSettings));

// All known tag names, lowercase, for validating whatever the AI sends back —
// an AI reply is never trusted or shown as-is, only tags that are genuinely in the
// database are accepted; anything else is listed separately as "not a real tag".
const knownTagNames = new Set(DANBOORU_TAGS.map((r) => r[0]));
function validateAiTags(list) {
  const valid = [], unknown = [];
  for (const raw of list) {
    const name = String(raw).trim().toLowerCase().replace(/ /g, "_");
    if (knownTagNames.has(name) && !isFiltered(name)) valid.push(name.replace(/_/g, " "));
    else unknown.push(raw);
  }
  return { valid, unknown };
}

document.getElementById("ai-go").addEventListener("click", async () => {
  const status = document.getElementById("ai-status");
  const resultBox = document.getElementById("ai-result");
  resultBox.hidden = true;
  const description = document.getElementById("ai-input").value.trim();
  const endpoint = document.getElementById("ai-endpoint").value.trim();
  const model = document.getElementById("ai-model").value.trim();
  const key = document.getElementById("ai-key").value.trim();

  if (!description) { status.textContent = "Describe an idea first."; return; }
  if (!endpoint || !model || !key) { status.textContent = "Fill in the endpoint, model and API key above first."; return; }

  status.textContent = "Asking… (this may fail — see the note above about browser restrictions)";

  const systemPrompt = "You write Danbooru-style image tags. Reply with ONLY a JSON array of lowercase tag strings (underscores instead of spaces), nothing else, no explanation.";

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": "Bearer " + key },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: description },
        ],
        temperature: 0.7,
      }),
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error("The provider replied with an error (HTTP " + response.status + "). " + text.slice(0, 200));
    }
    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content || "";
    let list;
    try { list = JSON.parse(content.match(/\[[\s\S]*\]/)?.[0] || content); }
    catch { throw new Error("The AI's reply wasn't in the expected format. Try again, or a different model."); }
    if (!Array.isArray(list)) throw new Error("The AI's reply wasn't a list of tags.");

    const { valid, unknown } = validateAiTags(list);
    status.textContent = "";
    resultBox.hidden = false;
    resultBox.innerHTML =
      `<p><strong>Checked against the real tag database:</strong></p>` +
      `<p>${valid.length ? valid.map((t) => escHtml(t)).join(", ") : "<em>No valid tags found.</em>"}</p>` +
      (unknown.length ? `<p class="muted">Not in the database, so left out: ${unknown.map((t) => escHtml(String(t))).join(", ")}</p>` : "") +
      (valid.length ? `<button type="button" id="ai-add-all">+ Add all to tray</button>` : "");
    if (valid.length) document.getElementById("ai-add-all").onclick = () => { valid.forEach(trayAdd); toast("Added to tray."); };
  } catch (err) {
    status.textContent = "Could not reach the AI: " + err.message +
      " — if this says 'Failed to fetch' or similar with no detail, that's very likely the browser blocking the request (CORS), not a mistake in what you typed.";
  }
});

// ---- Init ----
rollAllRows(false);
renderTray();
