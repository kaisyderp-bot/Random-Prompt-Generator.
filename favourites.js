// Prompt Builder — Favourites and Blocked tags.
// Deliberately separate from Hidden/Deleted (see mature-filter.js's comment for the same
// reasoning): these are different concepts and must never be merged.
//   Blocked  — stays searchable in the Tag Library, but is never randomly rolled.
//   Favourite — rolls MORE often (weighted), never less; starring something never hides it.
// Both lists are tiny (tag names only) and never touch the 139k-row tag database itself.

const LS_FAVOURITES = "pb-favourites";
const LS_BLOCKED = "pb-blocked-tags";
const LS_FAV_WEIGHT = "pb-fav-weight";

let favouriteTags = loadSet(LS_FAVOURITES);
let blockedTags = loadSet(LS_BLOCKED);
let favWeight = (() => {
  const n = parseInt(localStorage.getItem(LS_FAV_WEIGHT), 10);
  return Number.isFinite(n) && n >= 1 && n <= 10 ? n : 3; // default 3x, matches the Settings field
})();

function isBlocked(nameRaw) { return blockedTags.has(String(nameRaw).toLowerCase()); }
function isFavourite(nameRaw) { return favouriteTags.has(String(nameRaw).toLowerCase()); }

function toggleFavourite(nameRaw) {
  const name = String(nameRaw).toLowerCase();
  const was = favouriteTags.has(name);
  if (was) favouriteTags.delete(name); else favouriteTags.add(name);
  saveSet(LS_FAVOURITES, favouriteTags);
  if (typeof pushUndo === "function") {
    pushUndo({ label: (was ? "Unfavourite " : "Favourite ") + '"' + nameRaw.replace(/_/g, " ") + '"', undo: () => {
      if (was) favouriteTags.add(name); else favouriteTags.delete(name);
      saveSet(LS_FAVOURITES, favouriteTags);
      if (typeof renderLibrary === "function") renderLibrary(true);
    }});
  }
  if (typeof renderLibrary === "function") renderLibrary(true);
}

function unblockTag(nameRaw) {
  const name = String(nameRaw).toLowerCase();
  blockedTags.delete(name);
  saveSet(LS_BLOCKED, blockedTags);
  if (typeof renderRemoved === "function") renderRemoved();
  if (typeof renderLibrary === "function") renderLibrary(true);
}

// Expands a section's candidate pool so favourited tags appear favWeight times more often
// than a plain entry, WITHOUT ever including a blocked tag at all. Call this instead of
// using slotPool()'s raw list directly wherever a random pick happens.
function weightedPool(pool) {
  const out = [];
  for (const item of pool) {
    const dbName = item.tag.toLowerCase().replace(/ /g, "_");
    if (isBlocked(dbName)) continue;
    const copies = isFavourite(dbName) ? Math.max(1, favWeight) : 1;
    for (let i = 0; i < copies; i++) out.push(item);
  }
  return out.length ? out : pool.filter((item) => !isBlocked(item.tag.toLowerCase().replace(/ /g, "_")));
}
