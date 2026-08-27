// Deterministic scaffold generator for a WTF Discovery addon repository.
//
// It writes a COMPLETE, SELF-CONTAINED repo: the engine is copied in verbatim,
// so the generated addon has no runtime and no build-time dependency on this
// template, on any other addon, or on this generator. If every other repo and
// this directory vanished, each generated addon would still validate, build and
// deploy.
//
// That is the deliberate trade. Five vendored copies can drift, which a shared
// npm package would prevent - but a shared package also means one bad version
// breaks all five addons at once, and adds a publish step to every change. So
// drift is made VISIBLE instead of impossible: every vendored file is
// checksummed into the generated repo, and test/engine-checksum.test.mjs fails
// if one is edited locally. Intentional engine changes go into this template
// first and are regenerated outward.
//
// The generator is development tooling. No deployed addon may depend on it.
//
// Usage:
//   node generate.mjs --profile <name> --out <dir> [--force]

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

// Vendored verbatim into <repo>/scripts/. This list IS the engine.
export const ENGINE_FILES = [
  "dna-score.mjs",
  "identity.mjs",
  "sort.mjs",
  "personalized-scores.mjs",
  "validate-profile.mjs",
  "validate.mjs",
  "build-site.mjs",
  "cinemeta.mjs",
  "resolve-library.mjs"
];

// Vendored verbatim into <repo>/test/.
export const ENGINE_TESTS = [
  "safe-fixture.mjs",
  "run-all.mjs",
  "engine-checksum.test.mjs",
  "engine-invariants.test.mjs",
  "baseline-evidence.test.mjs",
  "no-production-mutation.test.mjs"
];

// Written once at creation and NEVER touched by a regeneration. These belong to
// the addon, not to the template: regenerating must never silently revert a
// genre's taste model, its catalog rows or its canonical prompt.
export const GENRE_OWNED = [
  "data/taste-profile.json",
  "data/library.json",
  "data/rejections.json",
  "data/discovery-log.json",
  "config/catalogs.json",
  "DAILY_AUTOMATION_PROMPT.md",
  "README.md"
];

const sha256 = buffer => crypto.createHash("sha256").update(buffer).digest("hex");
const readLF = file => fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n");

function writeFile(root, relative, contents) {
  const full = path.join(root, relative);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, contents, "utf8");
  return full;
}

function writeJson(root, relative, value) {
  return writeFile(root, relative, JSON.stringify(value, null, 2) + "\n");
}

// ---------------------------------------------------------------------------
// the two per-repo generated modules
// ---------------------------------------------------------------------------

// registry.mjs is the FROZEN VOCABULARY GUARD, per repo.
//
// The Sci-Fi engine kept this list inline in validate-profile.mjs, which made
// that file genre-specific and therefore un-vendorable. Splitting it out keeps
// the guard exactly as strong - the declared registry must still equal the
// frozen list EXACTLY - while letting each addon freeze its own vocabulary.
function registryModule(profile) {
  const dimensions = profile.dna_dimensions?.dimensions?.map(d => d.id) || [];
  const tags = profile.dna_dimensions?.tag_registry || [];
  const asList = values => values.length
    ? "\n  " + values.map(v => JSON.stringify(v)).join(",\n  ") + "\n"
    : "";
  return `// GENERATED ONCE AT SCAFFOLD TIME - this repo's frozen DNA vocabulary.
//
// This is the one file the generator writes from the profile rather than
// copying verbatim, and it is what lets validate-profile.mjs stay genre-neutral
// and vendored. The guard it feeds is deliberately strict: data/taste-profile.json
// must declare EXACTLY these dimensions and EXACTLY these tags, no more and no
// fewer, so a typo becomes a loud failure instead of quiet new metadata.
//
// Changing this list is a schema decision. It means a registry version bump, a
// migration for every already-enriched record, and a review of every consumer -
// never a casual edit.

export const CANONICAL_DIMENSIONS = [${asList(dimensions)}];

export const CANONICAL_DNA_TAGS = [${asList(tags)}];

// The single deliberate exception to the shared absent..dominant scale:
// pace_speed measures slow..fast. Exactly one dimension may be slow_to_fast.
export const SLOW_TO_FAST_DIMENSION = "pace_speed";
`;
}

function knownIdsModule(addon) {
  return `// GENERATED ONCE AT SCAFFOLD TIME - the per-addon values cinemeta.mjs needs.
//
// KNOWN_IMDB_IDS is a seed map of verified fallback ids. It exists only so a
// temporary Cinemeta outage cannot stop an already-known catalog from building.
// A new addon has nothing to protect yet, so it starts empty, and that is the
// correct state - entries are earned by a real outage, not pre-populated.
//
// Keys are \`\${type}:\${normalized title}:\${year}\`.

export const KNOWN_IMDB_IDS = new Map([]);

export const USER_AGENT = ${JSON.stringify(addon.user_agent)};
`;
}

function packageJson(addon) {
  return {
    name: addon.package_name,
    version: "1.0.0",
    private: true,
    type: "module",
    engines: { node: ">=20" },
    scripts: {
      resolve: "node scripts/resolve-library.mjs",
      build: "node scripts/build-site.mjs",
      validate: "node scripts/validate.mjs",
      // Discovered, not listed. package.json is regenerated, so a hardcoded
      // suite list here would silently drop a genre repo's own acceptance tests
      // the next time it was regenerated. See test/run-all.mjs.
      test: "node test/run-all.mjs"
    }
  };
}

function readme(addon, config) {
  const rows = config.catalogs.map(c => `- ${c.name}`).join("\n");
  return `# ${addon.repo}

${config.manifest.name} - ${config.manifest.description}

**Manifest ID:** \`${config.manifest.id}\`

## Catalog rows

${rows}

Each row is emitted for both \`movie\` and \`series\`, so Stremio shows ${config.catalogs.length * 2} catalogs.

## Independence

This repository is self-contained. It has no runtime or build-time dependency on
any other WTF Discovery addon, on their GitHub Pages deployments, or on the
scaffold generator that created it. It validates, builds and deploys alone.

## The vendored engine

Everything in \`scripts/\` except \`registry.mjs\` and \`known-ids.mjs\` is vendored
verbatim from the canonical template and **must not be edited here**.
\`test/engine-checksum.test.mjs\` fails if one of those files changes locally.
Engine changes go into the template first, then get regenerated into every repo.

\`registry.mjs\` (this addon's frozen DNA vocabulary) and \`known-ids.mjs\` are
generated once from this addon's own profile and are owned by this repository.

## Commands

\`\`\`bash
npm test              # full suite, production-state census last
npm run validate      # fail-closed validation of data/ against the profile
npm run build         # build site/ (manifest + catalog JSON)
\`\`\`
`;
}

// ---------------------------------------------------------------------------
// generate
// ---------------------------------------------------------------------------
export function generate({ profileName, outDir, force = false, templateRevision }) {
  const profileDir = path.join(here, "profiles", profileName);
  if (!fs.existsSync(profileDir)) throw new Error(`no such profile: ${profileDir}`);

  const addon = JSON.parse(readLF(path.join(profileDir, "addon.json")));
  const config = JSON.parse(readLF(path.join(profileDir, "catalogs.json")));
  const profile = JSON.parse(readLF(path.join(profileDir, "taste-profile.json")));

  const existing = fs.existsSync(outDir);
  if (existing && !force) {
    throw new Error(`${outDir} already exists; pass --force to regenerate (genre-owned files are preserved)`);
  }

  const written = [];
  const preserved = [];

  // 1. vendored engine
  const checksums = {};
  for (const name of ENGINE_FILES) {
    const contents = readLF(path.join(here, "engine", name));
    written.push(writeFile(outDir, path.join("scripts", name), contents));
    checksums[`scripts/${name}`] = sha256(Buffer.from(contents, "utf8"));
  }
  for (const name of ENGINE_TESTS) {
    const contents = readLF(path.join(here, "engine-test", name));
    written.push(writeFile(outDir, path.join("test", name), contents));
    checksums[`test/${name}`] = sha256(Buffer.from(contents, "utf8"));
  }

  // 2. per-repo generated modules (owned by the repo, NOT checksummed as engine)
  written.push(writeFile(outDir, "scripts/registry.mjs", registryModule(profile)));
  written.push(writeFile(outDir, "scripts/known-ids.mjs", knownIdsModule(addon)));

  // 3. drift manifest
  written.push(writeJson(outDir, "test/engine-checksums.json", {
    template_revision: templateRevision,
    generated_from: "wtf-addon-template",
    note: "Vendored engine files. Edit the template and regenerate; never edit these in place.",
    files: checksums
  }));

  // 4. skeleton
  for (const relative of [".gitignore", ".gitattributes"]) {
    written.push(writeFile(outDir, relative, readLF(path.join(here, "skeleton", relative))));
  }
  for (const wf of fs.readdirSync(path.join(here, "skeleton", ".github", "workflows"))) {
    written.push(writeFile(outDir, path.join(".github", "workflows", wf),
      readLF(path.join(here, "skeleton", ".github", "workflows", wf))));
  }
  written.push(writeJson(outDir, "package.json", packageJson(addon)));

  // 5. genre-owned files: written once, never overwritten by a regeneration
  const genreFiles = [
    ["config/catalogs.json", () => JSON.stringify(config, null, 2) + "\n"],
    ["data/taste-profile.json", () => JSON.stringify(profile, null, 2) + "\n"],
    ["data/library.json", () => JSON.stringify({ schema_version: 2, updated_at: addon.created_at, items: [] }, null, 2) + "\n"],
    ["data/rejections.json", () => JSON.stringify({ items: [] }, null, 2) + "\n"],
    ["data/discovery-log.json", () => JSON.stringify({ schema_version: 1, runs: [] }, null, 2) + "\n"],
    ["README.md", () => readme(addon, config)]
  ];
  for (const [relative, build] of genreFiles) {
    if (fs.existsSync(path.join(outDir, relative))) { preserved.push(relative); continue; }
    written.push(writeFile(outDir, relative, build()));
  }
  fs.mkdirSync(path.join(outDir, "data", "discoveries"), { recursive: true });

  return { outDir, written, preserved, checksums, manifestId: config.manifest.id, catalogs: config.catalogs.length };
}

// ---------------------------------------------------------------------------
// cli
// ---------------------------------------------------------------------------
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  const arg = name => {
    const i = process.argv.indexOf(`--${name}`);
    return i > -1 ? process.argv[i + 1] : undefined;
  };
  const profileName = arg("profile");
  const outDir = arg("out");
  if (!profileName || !outDir) {
    console.error("usage: node generate.mjs --profile <name> --out <dir> [--force]");
    process.exit(2);
  }

  // The template revision is a checksum of the template's own engine sources, so
  // a generated repo can say which engine it was cut from without a manual bump.
  const revisionInput = [...ENGINE_FILES.map(n => `engine/${n}`), ...ENGINE_TESTS.map(n => `engine-test/${n}`)]
    .map(rel => readLF(path.join(here, rel)))
    .join("\0");
  const templateRevision = sha256(Buffer.from(revisionInput, "utf8")).slice(0, 16);

  const result = generate({
    profileName,
    outDir: path.resolve(outDir),
    force: process.argv.includes("--force"),
    templateRevision
  });

  console.log(`Generated ${result.outDir}`);
  console.log(`  template revision : ${templateRevision}`);
  console.log(`  manifest id       : ${result.manifestId}`);
  console.log(`  catalog rows      : ${result.catalogs}`);
  console.log(`  files written     : ${result.written.length}`);
  if (result.preserved.length) {
    console.log(`  preserved (genre-owned, not overwritten):`);
    for (const p of result.preserved) console.log(`      ${p}`);
  }
}
