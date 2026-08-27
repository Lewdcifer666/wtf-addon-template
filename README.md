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
