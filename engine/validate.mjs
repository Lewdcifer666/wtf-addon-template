import fs from "node:fs";
import path from "node:path";
import { validateProfile, validateItemDna, watchedEvidenceIdentities } from "./validate-profile.mjs";
import { normalizeTitle } from "./cinemeta.mjs";
import { identityKey } from "./identity.mjs";
import { makePolicy, evalCondition, exclusionCondition } from "./dna-score.mjs";

const library = JSON.parse(fs.readFileSync("data/library.json", "utf8"));
const profile = JSON.parse(fs.readFileSync("data/taste-profile.json", "utf8"));

const profileErrors = validateProfile(profile);
for (const message of profileErrors) console.error(`taste-profile.json: ${message}`);

const validTypes = new Set(["movie", "series"]);
const validStatus = new Set(["watch", "seen"]);
const tags = new Set(profile.controlled_tags);
const all = [...(library.items || [])];
const origin = new Map(all.map((_, i) => [i, "data/library.json"]));

const discoveryDir = path.join("data", "discoveries");
if (fs.existsSync(discoveryDir)) {
  for (const name of fs.readdirSync(discoveryDir).filter(x => x.toLowerCase().endsWith(".json")).sort()) {
    const payload = JSON.parse(fs.readFileSync(path.join(discoveryDir, name), "utf8"));
    const items = Array.isArray(payload) ? payload : (payload.items || []);
    if (!Array.isArray(items)) {
      console.error(`${name}: expected an items array`);
      process.exit(1);
    }
    for (const item of items) {
      origin.set(all.length, path.join(discoveryDir, name));
      all.push(item);
    }
  }
}

// Item-level DNA is validated against the registry the profile actually
// declares. On a schema-2 profile there is no registry, so DNA keys on items
// are reported rather than silently accepted.
const dnaDimensionIds = new Set((profile.dna_dimensions?.dimensions || []).map(d => d.id));
const dnaTagIds = new Set(profile.dna_dimensions?.tag_registry || []);

// HARD EXCLUSIONS ARE AN INGESTION GATE, NOT ONLY A SCORING GATE.
//
// hardExcluded() removes an item from DNA-scored rows, but the plain "watch"
// rows do not consult DNA at all - so a hard-excluded title would still be
// published in the Full Watchlist while being absent from every row that
// actually ranks. That is incoherent: a structural exclusion means the title
// does not belong in this addon, full stop. It must never have been accepted.
const policy = profile.dna_dimensions ? makePolicy(profile) : null;

// A WATCHED baseline-evidence title must never be recommended again.
//
// UNWATCHED evidence is deliberately NOT collected here: those titles stay
// fully eligible and may legitimately appear once they have earned it through
// ordinary research and scoring. Both identity forms are indexed because an
// evidence entry and a library item need not agree about whether an IMDb id is
// known, and the exclusion must hold either way.
function identityForms(entry) {
  const forms = [];
  if (entry.imdb_id && /^tt\d+$/.test(entry.imdb_id)) forms.push(`${entry.type}:${entry.imdb_id}`);
  if (Number.isInteger(entry.year)) forms.push(`${entry.type}:${normalizeTitle(entry.title)}:${entry.year}`);
  return forms;
}
const watchedEvidence = new Map();
for (const entry of watchedEvidenceIdentities(profile)) {
  for (const form of identityForms(entry)) {
    if (!watchedEvidence.has(form)) watchedEvidence.set(form, entry.title);
  }
}

let errors = profileErrors.length;
const seenKeys = new Map();

for (const [i, item] of all.entries()) {
  const prefix = `items[${i}] ${item.title || "?"}`;
  if (!validTypes.has(item.type)) { console.error(`${prefix}: invalid type`); errors++; }
  if (!validStatus.has(item.status)) { console.error(`${prefix}: invalid status`); errors++; }
  if (!item.title || !Number.isInteger(item.year)) { console.error(`${prefix}: missing title/year`); errors++; }
  if (item.imdb_id && !/^tt\d+$/.test(item.imdb_id)) { console.error(`${prefix}: invalid imdb_id`); errors++; }
  for (const tag of item.tags || []) if (!tags.has(tag)) { console.error(`${prefix}: unknown tag '${tag}'`); errors++; }

  for (const message of validateItemDna(item, dnaDimensionIds, dnaTagIds)) {
    console.error(`${prefix}: ${message}`);
    errors++;
  }

  // A soft metadata preference, never a score. Non-negative so it can only ever
  // order two already-equal titles, never express a magnitude.
  if (Object.prototype.hasOwnProperty.call(item, "tie_break_rank")
      && (!Number.isInteger(item.tie_break_rank) || item.tie_break_rank < 0)) {
    console.error(`${prefix}: tie_break_rank must be a non-negative integer`);
    errors++;
  }

  if (policy && item.dna) {
    for (const rule of policy.hardExclusions) {
      if (!evalCondition(exclusionCondition(rule), item.dna)) continue;
      const bound = Object.prototype.hasOwnProperty.call(rule, "at_or_above")
        ? `>= ${rule.at_or_above}`
        : `<= ${rule.at_or_below}`;
      console.error(`${prefix}: violates hard exclusion '${rule.id}' (${rule.dimension} ` +
        `${item.dna[rule.dimension]} is ${bound}) - a hard-excluded title must never be ingested, ` +
        `because the plain watch rows do not consult DNA and would publish it anyway`);
      errors++;
    }
  }

  for (const form of identityForms(item)) {
    if (!watchedEvidence.has(form)) continue;
    console.error(`${prefix}: '${watchedEvidence.get(form)}' is WATCHED baseline evidence ` +
      `(${form}) and must never be recommended again. Baseline anchors are taste evidence, ` +
      `not watchlist content. Unwatched evidence titles are unaffected and stay eligible.`);
    errors++;
    break;
  }

  // A public identity may exist exactly once across library.json and every
  // discovery file. This is the canonical automation contract - an already
  // known title must never be re-added as a new discovery - so it is an ERROR,
  // not a warning, even when the two copies happen to agree.
  const key = identityKey(item, normalizeTitle);
  if (seenKeys.has(key)) {
    const first = seenKeys.get(key);
    console.error(`${prefix}: duplicate public identity ${key}` +
      ` - already present as items[${first.index}] in ${first.file}; this occurrence is in ${origin.get(i)}`);
    errors++;
  } else {
    seenKeys.set(key, { index: i, file: origin.get(i) });
  }
}

if (errors) process.exit(1);
console.log(`Validation OK: ${all.length} source items.`);
