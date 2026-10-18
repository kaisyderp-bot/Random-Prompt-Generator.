// Prompt Builder — mature/NSFW tag list and matching, kept deliberately separate from
// Hidden/Deleted (those are per-person choices; this is a content-maturity filter).
//
// HONESTY NOTE: data.js has no safe/NSFW rating field at all — Danbooru-style dumps don't
// ship one in this shape. This file is therefore a hand-maintained, best-effort keyword
// list, not a guarantee. A tag can slip through, and a tag can be flagged that someone
// wouldn't consider mature. Treat the toggle as "reduces mature content," not "makes this
// child-safe" — the UI says exactly that, on purpose.
//
// Default is OFF (safe) wherever this app is opened fresh. Turning it on is an explicit,
// visible choice in Settings, not something turned on for someone.

const MATURE_KEYWORDS = [
  "nude", "naked", "nipple", "pussy", "penis", "cum", "sex", "masturbat",
  "fellatio", "cunnilingus", "penetrat", "breast", "areola", "anus", "ass_focus",
  "pubic_hair", "erection", "orgasm", "bukkake", "ejaculat", "nsfw", "hentai",
  "uncensored", "bottomless", "topless", "see-through", "bar_censor", "pussy_juice",
  "cameltoe", "futanari", "bestiality", "rape", "bondage", "tentacle_sex", "sexual",
];

// A tag counts as mature if its (underscore) name contains any keyword above as a whole
// word/segment — not a loose substring match, so "classroom" never matches "ass_focus"
// style fragments and "assassin" never matches "ass". Display names ("pussy juice") are
// normalised to underscore form first, same as every other lookup in this app.
function isMatureTagName(nameRaw) {
  const name = String(nameRaw).toLowerCase().replace(/ /g, "_");
  return MATURE_KEYWORDS.some((kw) => {
    const pattern = kw.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");
    return new RegExp("(^|_)" + pattern + "[a-z]*(_|$)").test(name);
  });
}
