// Prompt Builder — prompt exports. Every export in this file reads only from the tray
// and the local llmStyleDescription() template — never calls the network, never includes
// an API key, matches the same rule as everything else in this app.

function downloadText(filename, text) {
  const blob = new Blob([text], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
function downloadJson(filename, obj) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function exportTagsTxt() { downloadText("prompt-tags.txt", currentTrayOrdered().join(", ")); }
function exportLlmTxt() { downloadText("prompt-llm-style.txt", llmStyleDescription()); }
function exportBothTxt() { downloadText("prompt-both.txt", currentTrayOrdered().join(", ") + "\n\n" + llmStyleDescription()); }

// Grouped JSON: tray tags organised by section, in the user's current section order —
// the same order the Roller, tray sort, and preview use. Never includes API keys,
// shortcuts, or anything from Settings — this is a prompt export, not a backup.
function exportGroupedJson() {
  const order = typeof sectionOrder !== "undefined" ? sectionOrder : SECTION_IDS;
  const grouped = {};
  for (const section of order) grouped[section] = [];
  grouped[UNASSIGNED] = [];
  for (const tag of tray) {
    const dbName = tag.toLowerCase().replace(/ /g, "_");
    const sec = sectionOf(dbName);
    (grouped[sec] ||= []).push(tag);
  }
  // Drop empty sections so the file stays readable for a small tray.
  for (const key of Object.keys(grouped)) if (!grouped[key].length) delete grouped[key];
  downloadJson("prompt-grouped.json", { exportedAt: new Date().toISOString(), sections: grouped, flat: currentTrayOrdered() });
}

document.getElementById("export-tags-txt")?.addEventListener("click", exportTagsTxt);
document.getElementById("export-llm-txt")?.addEventListener("click", exportLlmTxt);
document.getElementById("export-both-txt")?.addEventListener("click", exportBothTxt);
document.getElementById("export-grouped-json")?.addEventListener("click", exportGroupedJson);
