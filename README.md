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

## Baseline evidence membership is NOT watched status

Marking a title `evidence_type: "watched"` bans it from recommendation
**permanently**. That is a strong claim and it must be earned.

**Watched requires explicit user confirmation that the title was actually
watched.** None of the following are watching:

- trailers, clips, snippets, scenes seen online
- partial exposure, or some episodes of a series
- "looks interesting", "probably liked", "I think I saw it"
- using the title as a structural taste anchor when building the profile
- knowing or liking the franchise
- one franchise entry having been seen

**Franchise membership never propagates watched status.** "I love Fast &
Furious" does not establish that every entry was watched; "I like Harry Potter"
does not establish all eight films. Enumerate only installments explicitly
confirmed, or use individual `scope: "title"` entries.

**Uncertainty resolves to unwatched.** A wrong `watched` silently deletes
something the user may actively want to see and rate; a wrong `unwatched` only
risks recommending something they have already seen. The costs are not
symmetric, so the default is not symmetric either.

This is a research judgement no validator can check — it cannot know what the
user confirmed. So the schema refuses to let the claim pass *silently*: every
watched entry must carry a non-empty **`watched_confirmation`** stating how
watching was established. If that sentence cannot be written honestly, the
entry is not watched.

The rule this replaces is unchanged: `watched` ⇒ `recommendable: false`,
`unwatched` ⇒ `recommendable: true`. What changed is how `evidence_type` gets
assigned in the first place.

## Secondary external ids are inert

An item may optionally carry `external_ids`, a **closed** vocabulary of
secondary identifiers from catalogues this system does not use (currently
`kitsu` only, for anime).

**IMDb remains the one canonical public identity.** A secondary id is a note
for later work and reaches nothing: not `identityKey()`, not duplicate
detection, not the Stremio id, not poster routing, Cinemeta resolution,
Content-DNA scoring, `match_score`, catalog membership or sorting. That
inertness is asserted by tests rather than assumed.

A title with **no resolvable IMDb id has no public identity** and does not
belong in public data. A secondary id can never stand in for it — log the title
as unresolved and skip it. The validator rejects `external_ids` on an item with
no `imdb_id` for exactly this reason.

Widening the namespace list is a deliberate decision, never a side effect of
one item needing somewhere to put a value.

### A repeated citation is not a second source

Wherever a phase asks for "two sources" or "three sources", that always means
**distinct** source URLs. `validate.mjs` rejects a `source` field that cites the
same document twice, so a count can never be reached by repetition.

Distinctness is compared on the normalised URL with the **fragment dropped** —
`#one` and `#two` address the same page. Everything else (host, path, query) is
compared as-is, so two different pages on the same host remain two sources: an
article and its episode list, for instance.

This is deliberately shallow and must not grow into a URL-equivalence engine.
Its job is the obvious duplicate. Whether two genuinely different pages say
anything genuinely different stays a research responsibility.
