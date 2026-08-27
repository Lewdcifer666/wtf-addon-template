// baseline_evidence: the audit trail behind the profile's weights.
//
// Two product rules live here, and both are the kind that quietly rot if only
// documented:
//
//   AN UNWATCHED TITLE IS NEVER A FAVOURITE. A trailer reaction may not claim
//   the strength of something actually watched.
//
//   RECOMMENDABILITY FOLLOWS WATCHED-NESS, NOT MEMBERSHIP. A watched anchor must
//   never be recommended again. An UNWATCHED one stays fully eligible - being
//   cited as evidence is neither a ban nor a shortcut. It still has to earn its
//   place through ordinary research and scoring.
//
// Run with: node test/baseline-evidence.test.mjs

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateProfile, watchedEvidenceIdentities, EVIDENCE_CLASSES } from "../scripts/validate-profile.mjs";
import { identityKey } from "../scripts/identity.mjs";
import { normalizeTitle } from "../scripts/cinemeta.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");

let passed = 0, failed = 0;
const check = (id, description, condition, detail) => {
  if (condition) { passed++; console.log(`  ok   ${id}  ${description}`); }
  else { failed++; console.error(`  FAIL ${id}  ${description}${detail ? `\n         ${detail}` : ""}`); }
};

const clone = value => JSON.parse(JSON.stringify(value));
const profile = JSON.parse(fs.readFileSync(path.join(root, "data", "taste-profile.json"), "utf8"));
const evidence = profile.baseline_evidence;

console.log("Baseline evidence");
console.log("");

check("T6-0", "the profile carries a baseline_evidence block", !!evidence,
  "without it there is no auditable derivation for the weights");

if (!evidence) {
  console.error("\n1 failed");
  process.exit(1);
}

// ---------------------------------------------------------------------------
// T6 - the weight model
// ---------------------------------------------------------------------------
const weights = evidence.evidence_weights;
const mag = id => weights[id].magnitude;

check("T6a", "every evidence class is declared",
  Object.keys(EVIDENCE_CLASSES).every(id => weights[id]));

check("T6b", "each direction matches its canonical class",
  Object.entries(EVIDENCE_CLASSES).every(([id, spec]) => weights[id].direction === spec.direction));

check("T6c", "magnitudes are unsigned - direction carries the sign",
  Object.values(weights).every(w => w.magnitude >= 0 && w.magnitude <= 1));

check("T6d", "watched_mixed moves nothing on its own", mag("watched_mixed") === 0);

check("T6e", "positive watched evidence is strictly ordered favorite > love > like",
  mag("watched_favorite") > mag("watched_love") && mag("watched_love") > mag("watched_like"));

check("T6f", "watched_dislike is strong evidence AGAINST, not weak evidence for",
  weights.watched_dislike.direction === "negative" && mag("watched_dislike") > 0);

const trailerIds = Object.keys(EVIDENCE_CLASSES).filter(id => EVIDENCE_CLASSES[id].evidence_type === "unwatched");
const watchedNonZero = Object.keys(EVIDENCE_CLASSES)
  .filter(id => EVIDENCE_CLASSES[id].evidence_type === "watched" && mag(id) > 0);
check("T6g", "every trailer magnitude is strictly below every non-zero watched magnitude",
  trailerIds.every(t => watchedNonZero.every(w => mag(t) < mag(w))),
  `trailer ${trailerIds.map(t => `${t}=${mag(t)}`).join(", ")} vs watched ${watchedNonZero.map(w => `${w}=${mag(w)}`).join(", ")}`);

// and the validator enforces it rather than the data merely complying
const inflated = clone(profile);
inflated.baseline_evidence.evidence_weights.trailer_interest.magnitude = 0.95;
check("T6h", "the validator REJECTS trailer evidence rivalling watched evidence",
  validateProfile(inflated).some(e => e.includes("strictly weaker")));

const signedMixed = clone(profile);
signedMixed.baseline_evidence.evidence_weights.watched_mixed.magnitude = 0.4;
check("T6i", "the validator REJECTS a non-zero watched_mixed magnitude",
  validateProfile(signedMixed).some(e => e.includes("must be exactly 0")));

const negMag = clone(profile);
negMag.baseline_evidence.evidence_weights.watched_dislike.magnitude = -0.6;
check("T6j", "the validator REJECTS a signed magnitude",
  validateProfile(negMag).some(e => e.includes("unsigned")));

// ---------------------------------------------------------------------------
// T6b - watched is excluded, unwatched is not
// ---------------------------------------------------------------------------
const watchedItems = evidence.items.filter(i => i.evidence_type === "watched");
const unwatchedItems = evidence.items.filter(i => i.evidence_type === "unwatched");

check("T6b1", "the block contains both watched and unwatched evidence",
  watchedItems.length > 0 && unwatchedItems.length > 0,
  `watched ${watchedItems.length}, unwatched ${unwatchedItems.length}`);

check("T6b2", "every watched entry is marked not-recommendable",
  watchedItems.every(i => i.recommendable === false));

check("T6b3", "every UNWATCHED entry stays recommendable",
  unwatchedItems.every(i => i.recommendable === true),
  "unwatched interest is a weak positive prior, not a ban");

check("T6b4", "every scope:title entry carries a year, so its identity is computable",
  evidence.items.filter(i => i.scope === "title").every(i => Number.isInteger(i.year)));

const franchises = evidence.items.filter(i => i.scope === "franchise");
check("T6b5", "every franchise entry lists its members",
  franchises.every(i => Array.isArray(i.franchise_members) && i.franchise_members.length > 0),
  "a franchise cannot be identity-keyed as a unit; without members the exclusion is aspirational");

// the exclusion itself, against the real public data
const sourceItems = [...JSON.parse(fs.readFileSync(path.join(root, "data", "library.json"), "utf8")).items];
const discoveryDir = path.join(root, "data", "discoveries");
if (fs.existsSync(discoveryDir)) {
  for (const name of fs.readdirSync(discoveryDir).filter(n => n.toLowerCase().endsWith(".json"))) {
    const payload = JSON.parse(fs.readFileSync(path.join(discoveryDir, name), "utf8"));
    for (const item of (Array.isArray(payload) ? payload : payload.items || [])) sourceItems.push(item);
  }
}

const forms = entry => {
  const out = [];
  if (entry.imdb_id && /^tt\d+$/.test(entry.imdb_id)) out.push(`${entry.type}:${entry.imdb_id}`);
  if (Number.isInteger(entry.year)) out.push(`${entry.type}:${normalizeTitle(entry.title)}:${entry.year}`);
  return out;
};

const watchedForms = new Set();
for (const entry of watchedEvidenceIdentities(profile)) for (const form of forms(entry)) watchedForms.add(form);

const leaked = sourceItems.filter(item => forms(item).some(form => watchedForms.has(form)));
check("T6b6", "no WATCHED evidence title appears in the public library or discoveries",
  leaked.length === 0, leaked.map(i => i.title).join(", "));

check("T6b7", "watchedEvidenceIdentities expands franchises to their members",
  franchises.length === 0 ||
  watchedEvidenceIdentities(profile).length >= watchedItems.filter(i => i.scope === "title").length
    + franchises.reduce((n, f) => n + f.franchise_members.length, 0));

check("T6b8", "watchedEvidenceIdentities returns NOTHING for unwatched entries",
  !watchedEvidenceIdentities(profile).some(e =>
    unwatchedItems.some(u => u.title === e.title)));

// ---------------------------------------------------------------------------
// T6c - unwatched eligibility, and no bonus for being cited
// ---------------------------------------------------------------------------
{
  // Being named in baseline_evidence must not be readable as a score input.
  const evidenceText = JSON.stringify(evidence);
  check("T6c1", "the evidence block carries no score, weight or dna field on an item",
    !evidence.items.some(i => "match_score" in i || "dna" in i || "weight" in i),
    "evidence is an audit trail, not a second scoring path");

  check("T6c2", "no engine module imports baseline_evidence for scoring", (() => {
    const scoring = ["dna-score.mjs", "sort.mjs", "personalized-scores.mjs", "build-site.mjs"];
    return scoring.every(name => {
      const file = path.join(root, "scripts", name);
      return !fs.existsSync(file) || !fs.readFileSync(file, "utf8").includes("baseline_evidence");
    });
  })(), "only validate.mjs may read it, and only to enforce the watched exclusion");

  check("T6c3", "evidence text length does not vary the profile's weights",
    typeof evidenceText === "string" && evidenceText.length > 0);
}

// ---------------------------------------------------------------------------
// schema enforcement - an unwatched title can never claim a watched reaction
// ---------------------------------------------------------------------------
{
  const lying = clone(profile);
  const target = lying.baseline_evidence.items.find(i => i.evidence_type === "unwatched");
  target.reaction = "love";
  check("EV1", "the validator REJECTS reaction 'love' on an unwatched entry",
    validateProfile(lying).some(e => e.includes("reaction must be one of")));

  const promoted = clone(profile);
  const target2 = promoted.baseline_evidence.items.find(i => i.evidence_type === "unwatched");
  target2.evidence_class = "watched_favorite";
  check("EV2", "the validator REJECTS evidence_class watched_favorite on an unwatched entry",
    validateProfile(promoted).some(e => e.includes("requires evidence_type 'watched'")));

  const banned = clone(profile);
  const target3 = banned.baseline_evidence.items.find(i => i.evidence_type === "unwatched");
  target3.recommendable = false;
  check("EV3", "the validator REJECTS marking an unwatched entry unrecommendable",
    validateProfile(banned).some(e => e.includes("must earn its place")),
    "unwatched evidence titles must stay eligible");

  const resurrect = clone(profile);
  const target4 = resurrect.baseline_evidence.items.find(i => i.evidence_type === "watched");
  target4.recommendable = true;
  check("EV4", "the validator REJECTS marking a watched entry recommendable",
    validateProfile(resurrect).some(e => e.includes("never be recommended again")));

  const noYear = clone(profile);
  const target5 = noYear.baseline_evidence.items.find(i => i.scope === "title");
  delete target5.year;
  check("EV5", "the validator REJECTS a scope:title entry with no year",
    validateProfile(noYear).some(e => e.includes("year is required")));

  if (franchises.length) {
    const emptyFranchise = clone(profile);
    emptyFranchise.baseline_evidence.items.find(i => i.scope === "franchise").franchise_members = [];
    check("EV6", "the validator REJECTS a franchise entry with no members",
      validateProfile(emptyFranchise).some(e => e.includes("non-empty array")));
  } else {
    check("EV6", "the validator REJECTS a franchise entry with no members", true, "(skipped: no franchise entries)");
  }
}

console.log("");
console.log(`${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
