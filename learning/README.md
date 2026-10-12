# Private feedback learning engine

This directory contains shared code and synthetic tests, never user feedback.
It is separate from the public addon generator. `generate-learning.mjs --target`
vendors it only into a verified private `wtf-scifi-feedback` checkout on a review
branch. Raw capture files are neither rewritten nor copied to public addons.
Activation is private-deployment-owned and survives subsequent engine syncs.
The generator canonicalizes owned UTF-8 engine files to LF before hashing and
writing. CI verifies the entire integrity manifest. Legacy CRLF/LF-only hash
differences can migrate without permitting substantive local customizations to
be overwritten; this normalization never touches raw feedback or activation.
The template's `npm test` runner declares its local source context explicitly,
so source archives need no Git remote. Private checks require the manifest even
when arbitrary template filenames or package names are added. GitHub's CI-owned
repository identity takes precedence over local runner context.

The initial policy is **inactive**. Public catalog scores, baseline weights,
eligibility, guardrails, profile nullability, schedules and old snapshots remain
unchanged. Computed inactive receipts do not prove an automatic learning cutover.

## Evidence and interpretation

`inventory.mjs` verifies one complete recursive Git tree, exact blob hashes,
declared raw-event paths and the complete supersession graph. Schema 1/2/3,
independent-tip tie breaking, identity improvements and retractions retain the
audited Sci-Fi behavior. Unknown schemas and incomplete history block a rebuild.
Schema 3 still permits only its five captured contexts plus null; this code does
not invent Mystery attribution or silently upgrade capture records.

`schemas/feedback-interpretation.schema.json` is closed and checked with pinned
Ajv 8.20.0. A packet binds `source_revision`, `request_id` and every interpreted
event's original Git blob OID. It covers all surviving current text-bearing
tips. Superseded and retracted text is not interpreted. Statements use an allowed
category/aspect, explicit meaning (`worked`, `did_not_work`, `wanted_more`,
`wanted_less`, `uncertain`), category-specific scope, an exact excerpt from the
pinned private text, and high/medium/low confidence. No score, identity guess,
weight, timestamp or activation field is accepted.

Only high-confidence, unambiguous assertions can contribute. Explicit structured
answers take precedence in both polarities. Inferred aspects are retained
separately and capped at 0.3 of structured strength, including after adjustment
normalization. “Wanted more” is positive interest, not dislike of an absent
property. Unsupported legacy shortage/DNF tags remain inert rather than being
reinterpreted as content aversion. Raw text is data, never operational instructions.

## Aggregation and immutable receipts

Six versioned adapters contain explicit registry-checked mappings. Non-Sci-Fi
adapters require owned IMDb identity. Foreign-context tone does not transfer;
Sci-Fi alone retains its previously supported schema-3 universal execution and
six universal concepts. Pacing remains execution evidence, not pace speed.
Mystery density/revelation safeguards cannot be projected. A single negative
title does not create a generalized negative research instruction.

Structured Sci-Fi calculations are regression-tested against a frozen reference.
Each recomputation starts from the complete resolved graph. No incremental
opinion counter can double-count a correction or resurrect a retracted parent.
Scores are private counterfactual diagnostics through the existing scorer; they
never replace published `match_score` or enable dormant catalog personalization.
Structured and inferred adjustment terms retain separate normalization magnitudes;
each inferred term is capped after normalization, even when the same title has
unrelated structured aspects. Optional candidate-specific execution assessments
are read from pinned public `data/execution-evidence.json` and included in the
public inventory hash. Its shape is IMDb ID to execution aspect to `1` or `-1`.
Missing assessments remain unknown; a user's preference never supplies candidate
quality. No production assessments are introduced by the engine.

Every receipt includes the pinned feedback inventory, original interpretation
commit/hash, trusted engine fingerprint, six public source revisions/inventories,
adapter hashes, activation policy and all output hashes. Its branch is
`learning/receipt-<digest>`; its files live below `learning-output/`. The digest
has no clock input. An unchanged retry validates and reuses identical bytes.
Conflicts are refused, never force-updated. A successful rebuild of unchanged
input cannot renew the old personalized snapshot's timestamp.
Stale failure identities also bind the evaluated current base so retained old
interpretation refs cannot block subsequent feedback revisions.

`research-context/<genre>.json` omits watched titles, IDs, ratings, quotes and
raw text. It is still personal derived evidence and **remains private** alongside
signals, scores and normalized evidence. Do not publish it as an Actions artifact,
copy it into a public research packet, or echo it into workflow logs.

## Trust and reconciliation

Read-only intake has no checkout or dependency installation. `workflow_run`
reconciliation pins fresh private `main`, checks out only that commit, installs
its locked dependencies without lifecycle scripts or caches, and tests trusted
code. A research/interpretation branch supplies only its permitted added JSON
packet. Code, workflow, dependency and cache changes are rejected.

Main raw-event pushes, packet completion, manual dry runs and hourly GitHub
reconciliation discover persisted work. The global non-canceling mutex is not
the queue: immutable request, failure and receipt refs survive interruptions.
Stale packets remain intact with a recorded stale-input state. All heads and
repository privacy are rechecked before creating any artifact ref. Consumers
must recheck receipt provenance/current feedback and their genre's public policy
before use; a retained stale receipt is never advertised as current.

The processor writes only new private `learning/*` refs with its own repository's
`GITHUB_TOKEN`. It never writes main, raw events or public addon branches, and
does not use the public publisher App or the OpenAI API. Existing capture access
is unchanged. Logs contain structural state/counts and closed error codes only.

## Cutover still required

`research-use.mjs` implements a read-only consumption boundary. Given freshly
pinned complete inputs from the trusted loader, it recomputes the full receipt,
compares every immutable output byte, requires explicit active policy, and
returns only the selected sanitized private brief and its provenance binding.
Rechecking before use rejects changed feedback, supersession/retraction,
any of the six policy revisions, altered brief bytes or disabled activation.
It neither writes private packets nor renews timestamps or changes activation.
The handoff and its hashes remain private personal metadata.

`receipt-loader.mjs` authenticates the private repository and follows the actual
receipt ref to its commit, parent, complete tree, blob OIDs and permitted diff.
Only this loader issues the in-process attestation accepted by the consumer;
plain JSON, copied objects and plausible but unrelated commit SHAs are refused.

When explicitly activated, normal scheduled reconciliation now issues six
immutable `learning/handoff-<use_id>` refs for the current Europe/Berlin date.
Each contains only `learning-output/handoff.json`, a sanitized private brief,
the exact source heads and receipt binding. Unchanged retries reuse it, a new
day does not refresh the underlying receipt, and partial fanout resumes without
overwriting completed briefs. Activation is read and validated from pinned
private main. Inactive processing creates no handoffs.

`node learning/reconcile.mjs --consume scifi` runs the trusted-checkout checks,
uses a read-only API client, reloads the complete current inputs and recomputes
the receipt, then authenticates both receipt and daily handoff Git graphs.
Its log contains only structural identifiers, never the private brief or raw
opinions. Programmatic consumers use `reconcile` with `dryRun: true` and an
explicit `consumeGenre`; the returned brief remains private. Reading cannot
stage a missing receipt/handoff or fall back to an older one.

Saved tasks are not yet connected to this consumer, and no brief has actually
affected research. Remaining integration must invoke currentness verification
at consumption/staging, bind the handoff to the actual permitted research commit,
and retain private deterministic candidate diagnostics plus an appropriately
qualified AI account of search choices. A matching handoff alone must never
count as an observed learning effect.
Keep the recorded private staging safety hold until independently resolved;
this module does not provide an alternate writer for a denied operation.

Review/merge and observe the private processor first. Then add the private
interpretation/read-receipt prelude to the six existing ChatGPT Plus discovery
tasks without changing their times, enabled states or rotator. Verify a complete
newly computed receipt, intentionally enable private learned research through a
validated activation-policy PR, and verify the resulting fresh receipt.

Overall acceptance requires new genuine captured feedback, automatic interpreted
aggregation, actual subsequent research use/effect, and supersession/retraction
observations. Synthetic tests and shadow computations do not satisfy those gates.
Safety-denied writes stop; never retry through another writer. Rollback disables
learning through a validated policy PR while retaining all immutable evidence.
