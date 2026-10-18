// Prompt Builder — local character library.
// A character is a reusable personal tag base. It is deliberately separate from
// Presets: a preset stores a whole Roller state; a character stores only the stable
// identity tags that can be added alone or included with a roll.

const LS_CHARACTERS = "pb-characters";
const LS_ACTIVE_CHARACTER = "pb-active-character";

function loadCharacters() {
  const list = loadArr(LS_CHARACTERS);
  return Array.isArray(list) ? list.filter((item) => item && typeof item.id === "string") : [];
}
function saveCharacters(list) { saveArr(LS_CHARACTERS, list); }

function normaliseCharacterTags(value) {
  const seen = new Set();
  const tags = [];
  for (const raw of String(value || "").split(/[\n,]+/)) {
    const tag = raw.trim().replace(/\s+/g, " ");
    const key = tag.toLowerCase();
    if (!tag || seen.has(key)) continue;
    seen.add(key);
    tags.push(tag);
  }
  return tags;
}

function createCharacter(name, tagsInput, note = "") {
  const cleanName = String(name || "").trim().slice(0, 60);
  const tags = Array.isArray(tagsInput) ? normaliseCharacterTags(tagsInput.join(",")) : normaliseCharacterTags(tagsInput);
  if (!cleanName || !tags.length) return null;
  const character = {
    id: Date.now() + "-" + Math.random().toString(36).slice(2, 8),
    name: cleanName,
    tags,
    note: String(note || "").trim().slice(0, 500),
    useWithRoller: false,
    createdAt: new Date().toISOString(),
  };
  const list = loadCharacters();
  list.unshift(character);
  saveCharacters(list);
  setActiveCharacter(character.id);
  return character;
}

function updateCharacter(id, changes = {}) {
  const list = loadCharacters();
  const character = list.find((item) => item.id === id);
  if (!character) return null;
  if (Object.hasOwn(changes, "name")) {
    const name = String(changes.name || "").trim().slice(0, 60);
    if (!name) return null;
    character.name = name;
  }
  if (Object.hasOwn(changes, "tags")) {
    const tags = Array.isArray(changes.tags) ? normaliseCharacterTags(changes.tags.join(",")) : normaliseCharacterTags(changes.tags);
    if (!tags.length) return null;
    character.tags = tags;
  }
  if (Object.hasOwn(changes, "note")) character.note = String(changes.note || "").trim().slice(0, 500);
  saveCharacters(list);
  return character;
}

function deleteCharacter(id) {
  const list = loadCharacters().filter((item) => item.id !== id);
  saveCharacters(list);
  if (localStorage.getItem(LS_ACTIVE_CHARACTER) === id) localStorage.removeItem(LS_ACTIVE_CHARACTER);
}

function duplicateCharacter(id) {
  const source = loadCharacters().find((item) => item.id === id);
  if (!source) return null;
  const copy = { ...source, id: Date.now() + "-" + Math.random().toString(36).slice(2, 8), name: source.name + " (copy)", tags: source.tags.slice(), createdAt: new Date().toISOString() };
  const list = loadCharacters();
  list.unshift(copy);
  saveCharacters(list);
  setActiveCharacter(copy.id);
  return copy;
}

function setActiveCharacter(id) {
  const exists = loadCharacters().some((item) => item.id === id);
  if (exists) localStorage.setItem(LS_ACTIVE_CHARACTER, id);
  else localStorage.removeItem(LS_ACTIVE_CHARACTER);
}
function getActiveCharacter() {
  const id = localStorage.getItem(LS_ACTIVE_CHARACTER);
  return loadCharacters().find((item) => item.id === id) || null;
}
function setCharacterUseWithRoller(id, enabled) {
  const character = updateCharacter(id, {});
  if (!character) return false;
  character.useWithRoller = !!enabled;
  const list = loadCharacters();
  const index = list.findIndex((item) => item.id === id);
  list[index] = character;
  saveCharacters(list);
  return true;
}
