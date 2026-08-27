# wtf-addon-template

Canonical engine + deterministic scaffold generator for the WTF Discovery addons
(Sci-Fi, Fantasy, Action, Anime, Thriller).

This is **development tooling**. No deployed addon depends on it at runtime or at
build time. Delete this directory and every generated repo still validates,
builds and deploys.

```bash
node generate.mjs --profile <name> --out <dir> [--force]
npm test        # end-to-end: generate, attack, build, regenerate
```

## Why vendoring, not a shared package

A shared npm package would make drift impossible — and would also mean one bad
version breaks all five addons at once, plus a publish step on every change, plus
a build-time dependency in repos that are supposed to stand alone.

So the engine is **copied in verbatim** and drift is made *visible* instead of
impossible: every vendored file's SHA-256 is written into the generated repo, and
`test/engine-checksum.test.mjs` fails if one is edited locally. Intentional
engine changes go into this template first, then get regenerated outward.

A genre repo may only diverge through an explicit, reviewed extension point —
never by silently editing a vendored file.

## Layout

| Path | Role |
|---|---|
| `engine/` | vendored verbatim into `<repo>/scripts/` |
| `engine-test/` | vendored verbatim into `<repo>/test/` |
| `skeleton/` | `.gitignore`, `.gitattributes`, workflows |
| `profiles/<name>/` | one addon's inputs: `addon.json`, `catalogs.json`, `taste-profile.json` |
| `test/generator.test.mjs` | the template's own end-to-end test |

## What each generated repo owns

Two files are **generated once from the profile** rather than copied, and belong
to the repo. They are the extension point that lets the engine stay genre-neutral:

- `scripts/registry.mjs` — that addon's frozen DNA vocabulary. The guard is as
  strict as when the list lived inline in `validate-profile.mjs`: the profile
  must declare *exactly* these dimensions and tags. What changed is only that
  each addon freezes its own.
- `scripts/known-ids.mjs` — Cinemeta seed ids (empty for a new addon) and the
  User-Agent.

These are **written once and never overwritten** by a regeneration, because
regenerating must never silently revert a genre's taste model:

`data/taste-profile.json` · `data/library.json` · `data/rejections.json` ·
`data/discovery-log.json` · `config/catalogs.json` · `DAILY_AUTOMATION_PROMPT.md` ·
`README.md`

## Line endings

Every vendored file is LF-only and `.gitattributes` pins it. The checksum is over
raw bytes, so a CRLF conversion by an editor or by git would be indistinguishable
from someone editing the engine. The Sci-Fi sources these were extracted from had
*mixed* endings; extraction normalised them.

## The fixture profile

`profiles/fixture/` is a throwaway used only to prove the generator and the engine
invariants end to end. It is deliberately not named after any real genre so it can
never be mistaken for production taste policy, and it deliberately declares a
hard exclusion in **each** direction (`superhero` `at_or_above`, `action_density`
`at_or_below`) so both halves of the exclusion grammar are exercised on every run.

## Source provenance is not an evidence summary

Every item in `data/library.json` and `data/discoveries/*.json` carries both:

- **`reason`** — the concise human-readable explanation shown on the catalog card.
- **`source`** — the actual material the research rested on, as HTTP(S) URLs.

These are easy to conflate, and conflating them is how an unsupported DNA
fingerprint ships. "Sustained combat across short episodes" restates a
conclusion; it does not say where the conclusion came from and nobody can check
it later. `validate.mjs` therefore rejects a `source` containing zero usable
URLs.

Recommended form: `"https://source-one/… ; https://source-two/…"`

**Research policy** (not enforceable by a validator, and deliberately not
faked in one):

- Prefer **two or more** useful sources per accepted title — one may establish
  identity and basic premise, but at least one should support the substantive
  Content-DNA assessment.
- `action_density` needs **whole-runtime** evidence: episode structure, scene
  distribution, or reviews describing pacing across the whole work. **A trailer
  is never adequate** — trailers are cut to imply density that may not exist.
- `retro_visual_style` needs evidence about the **presentation itself**.
  **Release year is never adequate**, and is explicitly not a preference signal
  anywhere in this system.

The validator deliberately does not judge whether a URL *proves* a DNA value.
No validator can. What it can do is make an unsupported claim impossible to
ship silently.

## Thresholds are per-profile and must be calibrated per-profile

`automation_rules.minimum_match_score` and `best_match_score` are expressed on
that profile's own deterministic DNA-score scale.

**A shared 0..100 output range does NOT mean the same number is equally
selective across profiles.** Each profile has different weights, a different
archetype set and different guardrails, so the score distribution its real
candidates land in is also different.

Fantasy calibrated to **65 / 80** against its own observed distribution. Those
numbers are **Fantasy-specific and must not be copied** into Action, Anime or
Thriller. Each new genre has to score a real candidate set first, look at where
that profile's titles actually fall, and pick its own bar.

The same trap in the other direction: Fantasy originally inherited 82/90 from
Sci-Fi, where `match_score` is a separate holistic figure on a different scale.
That was a scale error rather than a stricter standard, and it would have
rejected almost everything.

This is a calibration discipline, not engine behaviour. **Do not add
cross-profile threshold coupling to engine code.**
