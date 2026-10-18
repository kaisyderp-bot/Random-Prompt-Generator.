// Prompt Builder — storage schema versioning and migration.
// Every localStorage key this app writes is listed in STORAGE_KEYS below. This file's
// job is ONE thing: read whatever is already on disk (any past version, or none), and
// make sure nothing is silently lost or corrupted when the app's storage shape changes.
//
// How it works:
//   - CURRENT_SCHEMA_VERSION bumps whenever a stored shape changes.
//   - pb-schema-version holds the version the data on this device was last written at.
//   - runMigrations() applies each migration step in order, starting from whatever
//     version is currently stored (treating "missing" as version 0 — i.e. the first
//     shipped build, before this file existed).
//   - A migration step must be additive/safe: it may rename or restructure a key, but
//     must never delete user data outright. If a step can't make sense of what's there,
//     it leaves that key untouched rather than guessing.
//
// This file does not know about tags, sections, or the roller — it only knows storage
// key names and versions, so it can be tested and extended without touching app logic.

const CURRENT_SCHEMA_VERSION = 1;
const LS_SCHEMA_VERSION = "pb-schema-version";

// Every migration step: { from: <version it runs FROM>, run: (get, set) => void }.
// get(key) reads a raw string or null; set(key, value) writes a raw string.
// Kept deliberately tiny for now — version 1 is the first versioned release, so there is
// nothing to migrate FROM yet. Future steps get added here, one per schema bump, each
// one annotated with what actually changed and why.
const MIGRATIONS = [
  // Example shape for the next real migration:
  // { from: 1, run: (get, set) => { /* ... */ } },
];

function runMigrations(storage = (typeof localStorage !== "undefined" ? localStorage : null)) {
  if (!storage) return;
  const get = (key) => { try { return storage.getItem(key); } catch { return null; } };
  const set = (key, value) => { try { storage.setItem(key, value); } catch {} };

  let version = parseInt(get(LS_SCHEMA_VERSION), 10);
  if (!Number.isFinite(version)) version = 0; // never versioned before — this file is new

  for (const step of MIGRATIONS) {
    if (version === step.from) {
      try { step.run(get, set); } catch (err) {
        // A failed migration must not corrupt data or block startup — skip it and move
        // on; the version number only advances for steps that actually succeeded.
        console.error("Prompt Builder: migration from version " + step.from + " failed, skipping.", err);
        continue;
      }
      version = step.from + 1;
    }
  }

  set(LS_SCHEMA_VERSION, String(CURRENT_SCHEMA_VERSION));
}
