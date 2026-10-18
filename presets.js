// Prompt Builder — Presets. A preset is a complete, named Roller setup: section order
// (future-proofed — currently fixed, see sections.js), slot counts, current tag/desc/
// locked per slot. Independent of Roll History (history is automatic and recent-only;
// presets are named and deliberate).

const LS_PRESETS = "pb-presets"; // [{ id, name, createdAt, sections: {...} }]

function loadPresets() { return loadArr(LS_PRESETS); }
function savePresets(list) { saveArr(LS_PRESETS, list); }

function capturePresetSections() {
  const sections = {};
  for (const section of SECTION_IDS) {
    sections[section] = (rollerRows[section] || []).map((s) => ({ tag: s.tag, desc: s.desc, locked: s.locked }));
  }
  return sections;
}

function savePreset(name) {
  const trimmed = String(name || "").trim().slice(0, 60);
  if (!trimmed) return false;
  const list = loadPresets();
  list.unshift({ id: Date.now() + "-" + Math.random().toString(36).slice(2, 7), name: trimmed, createdAt: new Date().toISOString(), sections: capturePresetSections() });
  savePresets(list);
  if (typeof renderPresets === "function") renderPresets();
  return true;
}

function loadPreset(id) {
  const preset = loadPresets().find((p) => p.id === id);
  if (!preset) return false;
  for (const section of SECTION_IDS) {
    const saved = preset.sections[section] || [];
    rowCounts[section] = Math.min(MAX_SLOTS, Math.max(MIN_SLOTS, saved.length || 1));
    rollerRows[section] = saved.length
      ? saved.map((s) => ({ id: nextSlotId++, tag: s.tag, desc: s.desc, locked: !!s.locked }))
      : [{ id: nextSlotId++, tag: null, desc: "", locked: false }];
  }
  saveObj(LS_ROW_COUNT, rowCounts);
  if (typeof renderRoller === "function") renderRoller();
  if (typeof renderPromptPreview === "function") renderPromptPreview();
  if (typeof toast === "function") toast(`Loaded preset "${preset.name}".`);
  return true;
}

function renamePreset(id, newName) {
  const trimmed = String(newName || "").trim().slice(0, 60);
  if (!trimmed) return false;
  const list = loadPresets();
  const preset = list.find((p) => p.id === id);
  if (!preset) return false;
  preset.name = trimmed;
  savePresets(list);
  if (typeof renderPresets === "function") renderPresets();
  return true;
}

function duplicatePreset(id) {
  const list = loadPresets();
  const preset = list.find((p) => p.id === id);
  if (!preset) return false;
  list.unshift({ ...preset, id: Date.now() + "-" + Math.random().toString(36).slice(2, 7), name: preset.name + " (copy)", createdAt: new Date().toISOString() });
  savePresets(list);
  if (typeof renderPresets === "function") renderPresets();
  return true;
}

function deletePreset(id) {
  const list = loadPresets().filter((p) => p.id !== id);
  savePresets(list);
  if (typeof renderPresets === "function") renderPresets();
}

function exportPreset(id) {
  const preset = loadPresets().find((p) => p.id === id);
  if (!preset) return;
  const blob = new Blob([JSON.stringify(preset, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = "preset-" + preset.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase() + ".json";
  a.click();
  URL.revokeObjectURL(url);
}

function renderPresets() {
  const box = document.getElementById("presets-list");
  if (!box) return;
  const list = loadPresets();
  const empty = document.getElementById("presets-empty");
  if (empty) empty.hidden = list.length > 0;
  box.innerHTML = list.map((p) => `
    <div class="preset-row" data-preset-id="${p.id}">
      <span class="preset-name">${escHtml(p.name)}</span>
      <span class="muted" style="font-size:.75rem;">${new Date(p.createdAt).toLocaleDateString()}</span>
      <div class="preset-actions">
        <button type="button" data-preset-load="${p.id}">Load</button>
        <button type="button" data-preset-rename="${p.id}">Rename</button>
        <button type="button" data-preset-duplicate="${p.id}">Duplicate</button>
        <button type="button" data-preset-export="${p.id}">Export</button>
        <button type="button" class="danger-btn" data-preset-delete="${p.id}">Delete</button>
      </div>
    </div>
  `).join("");
}

document.getElementById("preset-save")?.addEventListener("click", () => {
  const input = document.getElementById("preset-name-input");
  if (!input) return;
  if (savePreset(input.value)) { input.value = ""; toast("Preset saved."); }
  else toast("Give the preset a name first.");
});

document.getElementById("presets-list")?.addEventListener("click", async (e) => {
  const load = e.target.closest("[data-preset-load]");
  if (load) { loadPreset(load.dataset.presetLoad); return; }
  const duplicate = e.target.closest("[data-preset-duplicate]");
  if (duplicate) { duplicatePreset(duplicate.dataset.presetDuplicate); toast("Duplicated."); return; }
  const exportBtn = e.target.closest("[data-preset-export]");
  if (exportBtn) { exportPreset(exportBtn.dataset.presetExport); return; }
  const rename = e.target.closest("[data-preset-rename]");
  if (rename) {
    const id = rename.dataset.presetRename;
    const current = loadPresets().find((p) => p.id === id);
    const row = rename.closest(".preset-row");
    const nameEl = row.querySelector(".preset-name");
    nameEl.outerHTML = `<input class="preset-rename-input" value="${escHtml(current?.name || "")}" maxlength="60">`;
    const input = row.querySelector(".preset-rename-input");
    input.focus(); input.select();
    input.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") { renamePreset(id, input.value); }
      if (ev.key === "Escape") { renderPresets(); }
    });
    input.addEventListener("blur", () => renamePreset(id, input.value));
    return;
  }
  const del = e.target.closest("[data-preset-delete]");
  if (del) {
    const id = del.dataset.presetDelete;
    const preset = loadPresets().find((p) => p.id === id);
    const ok = await confirmAction(`Delete preset "${preset?.name || ""}"? This can't be undone.`);
    if (!ok) return;
    deletePreset(id);
    toast("Preset deleted.");
  }
});
