// Prompt Builder — Roll History. Stores the last HISTORY_LIMIT rolls (slot values, locks,
// slot counts per section) so a previous roll can be restored, copied, or deleted without
// re-rolling. Independent of the Undo stack — history is a deliberate save, not an
// automatic "oops" trail.

const LS_HISTORY = "pb-roll-history";
const HISTORY_LIMIT = 40;
const LS_HISTORY_LIMIT = "pb-history-limit";

function currentHistoryLimit() {
  const n = parseInt(localStorage.getItem(LS_HISTORY_LIMIT), 10);
  return Number.isFinite(n) && n > 0 ? n : HISTORY_LIMIT;
}

function loadHistory() { return loadArr(LS_HISTORY); }
function saveHistory(list) { saveArr(LS_HISTORY, list.slice(0, currentHistoryLimit())); }

// Snapshots exactly what's needed to restore the Roller: per section, each slot's tag/
// desc/locked, in SECTION_IDS order (so section order changes are captured implicitly).
function captureHistoryEntry() {
  const sections = {};
  for (const section of SECTION_IDS) {
    sections[section] = (rollerRows[section] || []).map((s) => ({ tag: s.tag, desc: s.desc, locked: s.locked }));
  }
  return { date: new Date().toISOString(), sections };
}

function pushHistory() {
  const list = loadHistory();
  list.unshift(captureHistoryEntry());
  saveHistory(list);
  if (typeof renderHistory === "function") renderHistory();
}

function restoreHistoryEntry(index) {
  const list = loadHistory();
  const entry = list[index];
  if (!entry) return;
  for (const section of SECTION_IDS) {
    const saved = entry.sections[section] || [];
    rowCounts[section] = Math.min(MAX_SLOTS, Math.max(MIN_SLOTS, saved.length || 1));
    rollerRows[section] = saved.length
      ? saved.map((s) => ({ id: nextSlotId++, tag: s.tag, desc: s.desc, locked: !!s.locked }))
      : [{ id: nextSlotId++, tag: null, desc: "", locked: false }];
  }
  saveObj(LS_ROW_COUNT, rowCounts);
  renderRoller();
  renderPromptPreview();
  toast("Roll restored from history.");
}

function deleteHistoryEntry(index) {
  const list = loadHistory();
  list.splice(index, 1);
  saveHistory(list);
  renderHistory();
}

function historyEntryText(entry) {
  const tags = SECTION_IDS.flatMap((s) => (entry.sections[s] || []).map((slot) => slot.tag).filter(Boolean));
  return tags.join(", ") || "(empty roll)";
}

function renderHistory() {
  const box = document.getElementById("history-list");
  if (!box) return; // pane not present in this build
  const list = loadHistory();
  const empty = document.getElementById("history-empty");
  if (empty) empty.hidden = list.length > 0;
  box.innerHTML = list.map((entry, i) => `
    <div class="history-row" data-index="${i}">
      <span class="history-date">${new Date(entry.date).toLocaleString()}</span>
      <span class="history-text">${escHtml(historyEntryText(entry))}</span>
      <div class="history-actions">
        <button type="button" data-history-restore="${i}">Restore</button>
        <button type="button" data-history-copy="${i}">Copy</button>
        <button type="button" class="danger-btn" data-history-delete="${i}">Delete</button>
      </div>
    </div>
  `).join("");
}

document.getElementById("history-list")?.addEventListener("click", (e) => {
  const restore = e.target.closest("[data-history-restore]");
  if (restore) { restoreHistoryEntry(Number(restore.dataset.historyRestore)); return; }
  const copy = e.target.closest("[data-history-copy]");
  if (copy) {
    const list = loadHistory();
    const entry = list[Number(copy.dataset.historyCopy)];
    if (entry) copyText(historyEntryText(entry));
    return;
  }
  const del = e.target.closest("[data-history-delete]");
  if (del) deleteHistoryEntry(Number(del.dataset.historyDelete));
});

document.getElementById("history-clear")?.addEventListener("click", async () => {
  const ok = await confirmAction("Clear all roll history on this device? This can't be undone.");
  if (!ok) return;
  saveHistory([]);
  renderHistory();
});
