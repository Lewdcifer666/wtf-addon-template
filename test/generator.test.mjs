// End-to-end proof of the scaffold generator.
//
// This test belongs to the TEMPLATE, not to any generated repo. It generates a
// throwaway addon into a temp directory and then attacks it: every rule the
// engine is supposed to enforce is checked by feeding it data that should be
// rejected, not merely by feeding it data that should pass. A validator that
// accepts everything also passes a happy-path test.
//
// It deliberately does the whole cycle - generate, validate, populate, build,
// regenerate - because the failures worth catching here are integration
// failures: a file the generator forgot, a module that only resolves in the
// template's directory layout, a regeneration that silently reverts a profile.
//
// Run with: node test/generator.test.mjs

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const templateRoot = path.resolve(here, "..");

let passed = 0, failed = 0;
const check = (id, description, condition, detail) => {
  if (condition) { passed++; console.log(`  ok   ${id}  ${description}`); }
  else { failed++; console.error(`  FAIL ${id}  ${description}${detail ? `\n         ${detail}` : ""}`); }
};

console.log("Scaffold generator");
console.log("");

// mkdtemp CREATES the directory, and the generator refuses to write into an
// existing one without --force, so the repo goes in a fresh subdirectory.
const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "wtf-gen-"));
const out = path.join(workspace, "wtf-fixture-stremio");
const cleanup = () => { try { fs.rmSync(workspace, { recursive: true, force: true }); } catch {} };

try {
  // -------------------------------------------------------------------------
  // generate
  // -------------------------------------------------------------------------
  const genLog = execFileSync(process.execPath,
    [path.join(templateRoot, "generate.mjs"), "--profile", "fixture", "--out", out],
    { encoding: "utf8", cwd: templateRoot });

  const exists = rel => fs.existsSync(path.join(out, rel));
  const read = rel => fs.readFileSync(path.join(out, rel), "utf8");
  const readJson = rel => JSON.parse(read(rel));
  const write = (rel, value) => {
    fs.mkdirSync(path.dirname(path.join(out, rel)), { recursive: true });
    fs.writeFileSync(path.join(out, rel), typeof value === "string" ? value : JSON.stringify(value, null, 2) + "\n");
  };

  check("G1", "the generator reports a template revision", /template revision : [0-9a-f]{16}/.test(genLog));

  for (const rel of ["package.json", "README.md", ".gitignore", ".gitattributes",
    "config/catalogs.json", "data/taste-profile.json", "data/library.json",
    "data/rejections.json", "data/discovery-log.json",
    "scripts/dna-score.mjs", "scripts/registry.mjs", "scripts/known-ids.mjs",
    "test/engine-checksums.json", ".github/workflows/deploy-pages.yml"]) {
    check("G2", `generated ${rel}`, exists(rel));
  }
  check("G3", "data/discoveries/ exists so the first daily run has somewhere to append",
    fs.existsSync(path.join(out, "data", "discoveries")));

  // -------------------------------------------------------------------------
  // standalone: nothing reaches outside this repo
  // -------------------------------------------------------------------------
  {
    const offenders = [];
    const walk = dir => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) { walk(full); continue; }
        if (!/\.(mjs|json|yml|md)$/.test(entry.name)) continue;
        const text = fs.readFileSync(full, "utf8");
        const relative = path.relative(out, full);
        for (const bad of ["wtf-addon-template", "wtf-scifi-stremio", "wtf-scifi-feedback", "../../"]) {
          if (!text.includes(bad)) continue;
          // README describes the template in prose, and engine-checksums.json
          // RECORDS its provenance on purpose - knowing which template a repo
          // was cut from is the point of the drift manifest. Neither is a
          // dependency: no code path reads them to find the template.
          if (relative === "README.md") continue;
          if (relative.split(path.sep).join("/") === "test/engine-checksums.json" && bad === "wtf-addon-template") continue;
          offenders.push(`${relative} -> ${bad}`);
        }
      }
    };
    walk(out);
    check("G4", "no generated file depends on the template or another addon repo",
      offenders.length === 0, offenders.join("\n         "));

    const pkg = readJson("package.json");
    check("G5", "package.json declares no dependencies at all",
      !pkg.dependencies && !pkg.devDependencies,
      "a generated addon must build with a bare node install");
  }

  // -------------------------------------------------------------------------
  // manifest + catalog structure
  // -------------------------------------------------------------------------
  execFileSync(process.execPath, ["scripts/build-site.mjs"], { cwd: out, stdio: "pipe" });
  const config = readJson("config/catalogs.json");
  const manifest = readJson("site/manifest.json");

  check("G6", "manifest id matches the profile's declared id",
    manifest.id === config.manifest.id, `${manifest.id} vs ${config.manifest.id}`);
  check("G7", "manifest declares catalog resource and both types",
    manifest.resources.includes("catalog") && manifest.types.includes("movie") && manifest.types.includes("series"));
  check("G8", "manifest emits one catalog per row per type",
    manifest.catalogs.length === config.catalogs.length * 2,
    `${manifest.catalogs.length} vs ${config.catalogs.length * 2}`);
  check("G9", "every manifest catalog id is unique",
    new Set(manifest.catalogs.map(c => `${c.type}:${c.id}`)).size === manifest.catalogs.length);
  check("G10", "every configured row id is unique",
    new Set(config.catalogs.map(c => c.id)).size === config.catalogs.length);
  check("G11", "EXACTLY ONE baseline_profile row exists",
    config.catalogs.filter(c => c.dna && c.dna.mode === "baseline_profile").length === 1,
    "the general profile-fit row is also the only place personalization applies; a second one would silently duplicate it");
  check("G12", "the generated site page is branded from the config, not from the template",
    read("site/index.html").includes(config.manifest.name)
    && !read("site/index.html").includes("Sci-Fi Discovery"));
  check("G13", "idPrefixes is tt-only", JSON.stringify(manifest.idPrefixes) === JSON.stringify(["tt"]));

  // -------------------------------------------------------------------------
  // the registry guard is real
  // -------------------------------------------------------------------------
  {
    const profile = readJson("data/taste-profile.json");
    const registry = read("scripts/registry.mjs");
    check("G14", "registry.mjs freezes exactly the profile's declared dimensions",
      profile.dna_dimensions.dimensions.every(d => registry.includes(`"${d.id}"`)));

    const tampered = JSON.parse(JSON.stringify(profile));
    tampered.dna_dimensions.dimensions.pop();
    tampered.dna_dimensions.count = tampered.dna_dimensions.dimensions.length;
    write("data/taste-profile.json", tampered);
    const result = runValidate();
    check("G15", "removing a dimension from the profile FAILS validation against the frozen registry",
      result.code !== 0 && /is missing dimension/.test(result.output));
    write("data/taste-profile.json", profile);
  }

  // -------------------------------------------------------------------------
  // ingestion gates - fed data that must be REJECTED
  // -------------------------------------------------------------------------
  function runValidate() {
    try {
      const output = execFileSync(process.execPath, ["scripts/validate.mjs"], { cwd: out, encoding: "utf8", stdio: "pipe" });
      return { code: 0, output };
    } catch (error) {
      return { code: error.status, output: `${error.stdout || ""}${error.stderr || ""}` };
    }
  }
  const library = items => write("data/library.json", { schema_version: 2, updated_at: "2026-08-27T00:00:00Z", items });

  const fullDna = {
    mystery: 7, suspense: 7, action_density: 8, action_intensity: 7, worldbuilding: 6,
    horror: 2, comedy: 1, visual_quality: 8, retro_visual_style: 2, military_focus: 1,
    superhero: 0, pace_speed: 7
  };
  const item = (over = {}) => ({
    imdb_id: "tt9100001", type: "movie", title: "Fixture Candidate", year: 2024,
    status: "watch", match_score: 91, tags: ["best"], reason: "A scaffold fixture candidate.",
    added_at: "2026-08-27T00:00:00Z", added_by: "bootstrap",
    dna: { ...fullDna }, dna_confidence: 0.9, dna_tags: ["probe_alpha"],
    ...over
  });

  library([item()]);
  check("G16", "a well-formed item validates", runValidate().code === 0);

  library([item({ dna: { ...fullDna, action_density: 2 } })]);
  {
    const r = runValidate();
    check("G17", "an item below the action_density floor is REJECTED AT INGESTION",
      r.code !== 0 && /insufficient_action_density/.test(r.output),
      "hard_exclusion only hides it from DNA rows; the plain watch row would publish it anyway");
  }

  library([item({ dna: { ...fullDna, superhero: 9 } })]);
  {
    const r = runValidate();
    check("G18", "an item above the superhero ceiling is REJECTED AT INGESTION",
      r.code !== 0 && /superhero_first/.test(r.output));
  }

  library([item({ imdb_id: "tt9000001", type: "series", title: "Fixture Anchor One", year: 2011 })]);
  {
    const r = runValidate();
    check("G19", "a WATCHED baseline-evidence title is REJECTED",
      r.code !== 0 && /WATCHED baseline evidence/.test(r.output));
  }

  library([item({ imdb_id: "tt9000010", title: "Fixture Saga", year: 2001 })]);
  {
    const r = runValidate();
    check("G20", "a watched FRANCHISE MEMBER is REJECTED",
      r.code !== 0 && /WATCHED baseline evidence/.test(r.output),
      "the franchise entry has to expand to its members or the exclusion is only aspirational");
  }

  // ---- and the rule that must NOT over-reach ----
  library([item({ imdb_id: "tt9100077", title: "Fixture Prospect", year: 2023 })]);
  check("G21", "an UNWATCHED baseline-evidence title is ACCEPTED",
    runValidate().code === 0,
    "unwatched interest is a weak prior, not a ban - it must stay eligible once it earns its place");

  library([item({ tie_break_rank: -1 })]);
  check("G22", "a negative tie_break_rank is REJECTED",
    runValidate().code !== 0);

  library([item({ tie_break_rank: 1 })]);
  check("G23", "a valid tie_break_rank is ACCEPTED", runValidate().code === 0);

  library([item(), item({ title: "Fixture Candidate Copy" })]);
  {
    const r = runValidate();
    check("G24", "a duplicate public identity is REJECTED", r.code !== 0 && /duplicate public identity/.test(r.output));
  }

  library([item({ dna: { ...fullDna, mystery: null } })]);
  check("G25", "an unmeasured REQUIRED dimension does not crash the builder", (() => {
    try { execFileSync(process.execPath, ["scripts/build-site.mjs"], { cwd: out, stdio: "pipe" }); return true; }
    catch { return false; }
  })(), "it must degrade to ineligible, never throw out of bestArchetype()");

  // -------------------------------------------------------------------------
  // rows actually rank
  // -------------------------------------------------------------------------
  library([
    item({ imdb_id: "tt9100002", title: "Dense", dna: { ...fullDna, action_density: 9 } }),
    item({ imdb_id: "tt9100003", title: "Intense But Sparse", dna: { ...fullDna, action_density: 4, action_intensity: 10 } })
  ]);
  check("G26", "the populated library validates", runValidate().code === 0);
  execFileSync(process.execPath, ["scripts/build-site.mjs"], { cwd: out, stdio: "pipe" });
  {
    const row = readJson("site/catalog/movie/high-action-movie.json");
    check("G27", "a high-density title reaches the High Action row",
      row.metas.some(m => m.name === "Dense"));
    check("G28", "a sparse-but-intense title does NOT reach it",
      !row.metas.some(m => m.name === "Intense But Sparse"),
      "density gates the row; intensity cannot substitute for it");

    const dnaRow = readJson("site/catalog/movie/dna-match-movie.json");
    const dense = dnaRow.metas.findIndex(m => m.name === "Dense");
    const sparse = dnaRow.metas.findIndex(m => m.name === "Intense But Sparse");
    check("G29", "density outranks intensity in the general DNA row",
      dense > -1 && sparse > -1 && dense < sparse,
      `Dense@${dense} vs Intense But Sparse@${sparse}`);
    // The row LABEL legitimately contains the words "DNA Match" - that is the
    // row the user is looking at. What must never leak is the measurement:
    // any dimension id, any dna_tag, or the confidence value.
    const profileNow = readJson("data/taste-profile.json");
    const leakTokens = [
      ...profileNow.dna_dimensions.dimensions.map(d => d.id),
      ...profileNow.dna_dimensions.tag_registry,
      "dna_confidence", "dna_tags"
    ];
    const leaked = [];
    for (const meta of dnaRow.metas) {
      for (const token of leakTokens) if (meta.description.includes(token)) leaked.push(`${meta.name}: ${token}`);
    }
    check("G30", "row descriptions expose no DNA dimension, tag or confidence value",
      leaked.length === 0, leaked.join(", "));
    check("G30b", "the row description does show the final row score",
      dnaRow.metas.every(m => m.description.includes("/100")),
      "only the final post-guardrail score is ever displayed");
  }

  // -------------------------------------------------------------------------
  // regeneration preserves what the genre owns
  // -------------------------------------------------------------------------
  {
    const marked = readJson("data/taste-profile.json");
    marked.profile_name = "EDITED BY THE ADDON, MUST SURVIVE REGENERATION";
    write("data/taste-profile.json", marked);
    write("README.md", "# hand-written readme\n");

    const log = execFileSync(process.execPath,
      [path.join(templateRoot, "generate.mjs"), "--profile", "fixture", "--out", out, "--force"],
      { encoding: "utf8", cwd: templateRoot });

    check("G31", "regeneration preserves the genre-owned profile",
      readJson("data/taste-profile.json").profile_name === "EDITED BY THE ADDON, MUST SURVIVE REGENERATION");
    check("G32", "regeneration preserves a hand-written README",
      read("README.md") === "# hand-written readme\n");
    check("G33", "regeneration reports what it preserved", /preserved \(genre-owned/.test(log));
    check("G34", "regeneration still refreshes the vendored engine",
      read("scripts/dna-score.mjs") === fs.readFileSync(path.join(templateRoot, "engine", "dna-score.mjs"), "utf8"));
    check("G35", "regeneration without --force refuses to touch an existing repo", (() => {
      try {
        execFileSync(process.execPath, [path.join(templateRoot, "generate.mjs"), "--profile", "fixture", "--out", out],
          { stdio: "pipe", cwd: templateRoot });
        return false;
      } catch { return true; }
    })());
  }

  // -------------------------------------------------------------------------
  // determinism
  // -------------------------------------------------------------------------
  {
    const twinBase = fs.mkdtempSync(path.join(os.tmpdir(), "wtf-gen-twin-"));
    const twin = path.join(twinBase, "wtf-fixture-stremio");
    execFileSync(process.execPath,
      [path.join(templateRoot, "generate.mjs"), "--profile", "fixture", "--out", twin],
      { stdio: "pipe", cwd: templateRoot });
    const a = readJson("test/engine-checksums.json");
    const b = JSON.parse(fs.readFileSync(path.join(twin, "test", "engine-checksums.json"), "utf8"));
    check("G36", "two generations of the same profile produce identical engine checksums",
      JSON.stringify(a.files) === JSON.stringify(b.files) && a.template_revision === b.template_revision);
    fs.rmSync(twinBase, { recursive: true, force: true });
  }

} finally {
  cleanup();
}

console.log("");
console.log(`${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
