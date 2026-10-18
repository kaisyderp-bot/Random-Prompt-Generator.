// Prompt Builder — section definitions and default-section logic.
// This does NOT rewrite data.js. It adds a thin, editable layer on top of it: every
// tag gets a Section (Outfit, Pose, ... or Unassigned), worked out from the existing
// group_label field (297 hand-written tags) and the curated ROLLER_SLOTS lists. You
// (or whoever you give this to) can change any tag's Section from the Tag Library tab
// — that choice is saved on that device and used by the Roller from then on, with no
// AI needed.
//
// Honesty note: there are ~138,794 tags and only 297 of them come with a real section
// already attached. Guessing the rest from the tag name alone would get plenty wrong
// (is "glowing" a mood or lighting? is "maid" an outfit or a job?) so nothing is guessed.
// Artist names, series/copyright tags and meta tags are left Unassigned on purpose —
// they are not "an outfit" or "a pose", and auto-sorting them would just be wrong.

const SECTION_IDS = ["outfit", "pose", "setting", "lighting", "mood", "accessory", "hair", "makeup", "camera", "style"];
const SECTION_LABELS = {
  outfit: "Outfit", pose: "Pose", setting: "Setting", lighting: "Lighting", mood: "Mood",
  accessory: "Accessory", hair: "Hair", makeup: "Makeup", camera: "Camera", style: "Style",
};
const UNASSIGNED = "unassigned";

// group_label -> [slot, slot, ...] — the reverse of GROUP_TO_SLOT in slots.js. A group
// can feed more than one slot (e.g. "Background & lighting" feeds both Setting and
// Lighting), so the first slot listed wins as the default; the other is one click away
// in the Tag Library if that's the one you actually meant.
function buildGroupToSections() {
  const out = {};
  for (const [slot, groups] of Object.entries(GROUP_TO_SLOT)) {
    for (const g of groups) (out[g] ||= []).push(slot);
  }
  return out;
}
const GROUP_TO_SECTIONS = buildGroupToSections();

// Curated tag (as written in ROLLER_SLOTS, spaces not underscores) -> its slot.
function buildCuratedToSection() {
  const out = {};
  for (const [slot, items] of Object.entries(ROLLER_SLOTS)) {
    for (const item of items) out[item.tag.toLowerCase()] = slot;
  }
  return out;
}
const CURATED_TO_SECTION = buildCuratedToSection();

// Only general/character tags are even considered for auto-sorting into a prompt
// section. Artist, copyright and meta tags stay Unassigned unless a person puts them
// somewhere on purpose.
const AUTO_SORTABLE_CATEGORIES = new Set(["general", "character"]);

// row = [name, category, post_count, group] (the shape every row in data.js uses).
// Works out the BUILT-IN default — before any of your own edits are applied.
function defaultSectionFor(row) {
  const [name, cat, , group] = row;
  const curated = CURATED_TO_SECTION[name.replace(/_/g, " ").toLowerCase()];
  if (curated) return curated;
  if (!AUTO_SORTABLE_CATEGORIES.has(cat)) return UNASSIGNED;
  if (group && GROUP_TO_SECTIONS[group] && GROUP_TO_SECTIONS[group].length) return GROUP_TO_SECTIONS[group][0];
  return UNASSIGNED;
}
