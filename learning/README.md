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

`research-session.mjs` supplies the private, read-only request/response adapter
boundary. Its closed request pins the genre, Berlin research date, private main
and selected public main. Opening a session recomputes the complete current
receipt and authenticates the persisted handoff and ordering certificate; it
refuses advanced research refs. The explicit private response rechecks all six
public heads, complete feedback and activation before releasing the sanitized
brief. Missing or stale receipts stay pending; this reader cannot stage their
replacements. Generic serialization of the opaque session handle omits the
brief. A JSON copy cannot act as an authenticated in-process session.

`verifyResearchSessionCommit` binds that session to the actual permitted public
packet using the trusted validator before publication. Source movement,
supersession/retraction and Berlin midnight invalidate consumption. This module
has no CLI, writer, workflow dispatch or exposed service endpoint. Wiring an
authorized private task adapter, durable actual search-use/effect evidence and
explicit cutover remains required. No session or candidate diagnostic alone is
an observed behavioral effect, and the private learning hold remains in place.

The session can also wrap a read-only search function installed by trusted
adapter code. `observeResearchSessionSearch` checks currentness before and after
the actual invocation, privately binds the query, referenced preference indexes,
provider result URLs and an exposed provider request ID (or null), and issues an
opaque in-process record. Caller-authored JSON and records from another session
cannot substitute for that observation. Provider errors stop without retries.
Only the query is sent to the provider, never the complete private brief.
Commit verification can bind these observed invocations to a validated public
packet. This verifies a local adapter invocation, not an authenticated external
provider trace, AI compliance, source semantics, or a causal recommendation
effect. The returned record is private; live task-facing transport and wiring
remain held and incomplete. No external search provider is configured here.

`session-journal-writer.mjs` supplies the dormant durable transport capability
for a future trusted-main adapter. An already active authenticated session can
prepare a signed private context record and persist its observed local searches
before the public packet is staged. These are additive immutable
`learning/session-<session_id>` and `learning/search-<session_id>-<search_id>`
refs containing one closed JSON artifact each. An unchanged retry reuses the
authenticated original bytes, including a racing signer's different JWT. The
writer refuses missing context, copied handles, moved inputs and staged public
research; it cannot create an interpretation, raw event or public packet.
No existing CLI or workflow invokes the writer, and activation stays unchanged.

Normal active observation reconciliation can authenticate these historical
records after publication or feedback corrections, without restoring stale
context to a current task. The observer verifies the original source tuple,
Git graph and trusted private main OIDC proof for every record. At most 100
closed search records of at most 1 MiB each are accepted per session. Missing
issuer keys stay pending; forged or oversized work fails visibly and is retained.
Observation schema 2 adds the private journal only when it exists. Schema 1
observations and all old bytes remain unchanged. Context preparation and local
search invocation still prove neither brief delivery, AI compliance, external
provider execution nor a causal recommendation effect.

Version 2 of the sealed monthly queue index additionally binds the observed
session/search ref heads. A late-visible or interrupted writer invalidates the
completed entry and receives a new immutable observation rather than being
silently skipped. Version 1 indices remain authenticated and migrate by adding
a new index ref; no old index, log or observation is rewritten. The global
non-canceling concurrency and bounded fair recovery model remain in place.
Live task-facing wiring, a configured read-only search provider, hold resolution,
explicit cutover and genuine observed feedback effects are still required.

`research-commit.mjs` adds the read-only post-staging boundary. It authenticates
the public repository and dated research ref, exactly one packet addition and
one parent based on the handoff's policy revision, the complete Git tree and
actual packet bytes. The trusted caller must run its genre-owned packet validator
and currentness checks. The result binds private candidate diagnostics to the
receipt, handoff and real research commit. Diagnostics retain baseline scoring
and unknown-value semantics and explicitly cannot prove a behavioral effect.
This library has no writer and is not yet wired into saved-task execution.
The processor now exposes `--verify-research <genre> <commit>` as a read-only
entry point. It reloads the complete current inputs and authenticated handoff,
validates the actual packet against the pinned public schema/configuration and
declarative registry, and computes the trace. Registry JavaScript is parsed as
closed data and never evaluated. The shared profile validator is generated from
the trusted template source so required-known/nullability semantics remain intact.
Repeated candidates use the finalizer's canonical order and identity forms;
duplicate diagnostics retain their provenance without applying another learned
term. CLI output contains identifiers only; the full trace remains private.

Manual workflow dispatch may select `consume_genre` and an optional research
commit. That separate job has Contents read permission, executes pinned private
main, and cannot create a fallback interpretation, receipt or publication.
Its default is `none`, so existing schedules and reconciliation behavior remain.
This verification interface does not remove the staging hold or activate learning.
Delayed verification may pass the original Berlin date as a fourth CLI argument
or the workflow's `research_date`. It authenticates that date's immutable handoff
and actual packet. Invalid/future dates fail; stale feedback or policy still fail.
Ordinary `--consume` always uses today's date and cannot select a past brief.

When learning is explicitly activated, normal private reconciliation also
collects `learning/handoff-*` refs as a durable observation queue. A verified
public research packet produces an immutable private
`learning/observation-<digest>` branch containing only
`learning-output/observation.json`. Unchanged retries reuse the branch; an
interrupted write can resume without changing main or any public repository.
Missing packets stay pending. A receipt issued after a packet is not relabeled
as the packet's input. Verification failures retain closed private failure
artifacts and fail the job rather than silently dropping an unresolved handoff.

Delayed observation reconstructs the ORIGINAL complete feedback, interpretation
and six public profile snapshots from authenticated ancestors of current main.
It recomputes every receipt and handoff byte using current trusted code and
adapters, reads only the permitted research packet, and refuses incompatible
outputs. No historical code/dependencies are executed. New feedback or retraction
does not rewrite these historical records or revive their taste state.
Current daily consumption still requires fresh inputs; this historical path is
restricted to diagnostic observation. Records explicitly set `current_evidence`,
`actual_context_use_verified` and `behavioral_effect_observed` to false.
Neither matching DNA adjustments nor a matching handoff proves the task used
that context. Actual private search-use evidence remains required integration.

Inactive reconciliation and read-only consumption never run this writer.
Activation, task instructions, schedules and existing safety holds are unchanged.
Do not lift the private learning hold or activate additional publication merely
because this transport passes its synthetic checks. The engine fingerprint also
covers the shared identity helper used to determine candidate duplicates.

Recovery also accepts the documented earlier fingerprint scheme that omitted
the identity helper, validating it against the exact historical source tree.
It preserves the stored fingerprint and all immutable receipt bytes rather than
rewriting history to the new scheme. Other source changes still fail validation.

The queue processes at most six unresolved handoffs per run, prioritizes new
refs and rotates older pending work using a persisted cursor. Completed records
are skipped only when their handoff/research/observation refs still match a
sealed terminal index. The index is bound to a GitHub-signed OIDC statement from
this private repository's `learning-finalize.yml` on trusted main, including the
immutable repository/owner IDs, revision and exact payload digest. A self-declared
checksum or AI-authored completion marker cannot skip pending work. The writer
job adds `id-token: write` solely to request these statements; it grants no new
repository write scope, uses no publisher App or long-lived signing secret, and
requests no statement while learning is inactive. Read-only consumption has no
OIDC mint permission. Statements and their payloads remain private and never
appear in workflow logs.

The index is partitioned by research calendar month, located through immutable
`learning/queue-<YYYY-MM>-<use_id>` aliases to the original handoff commit.
Current-month work is prioritized and older months rotate fairly; at most six
handoffs total are verified per run. Archived index refs have no lifetime count
cutoff, and only four candidate index payloads per selected period are inspected.
Old handoffs without aliases remain recoverable in a bounded legacy cohort.
All aliases, indices and original artifacts are retained without rewriting refs.

GitHub's OIDC `sha` belongs to the triggering event and can precede the newer
main selected after a concurrency wait. The signed audience separately binds
the actual pinned execution revision. A differing trigger must authenticate as
an ancestor of that revision through GitHub's commit graph; a research-branch
or diverged SHA fails. Historical index verification applies the same rule.

An explicit manual `provenance_probe` is the sole inactive exception to token
minting. Its separate job has Contents read and ID-token write permissions,
executes pinned main and verifies a synthetic statement entirely in memory.
The program reads no feedback/profile data and makes no Git writes; it logs
only result/revision identifiers. It cannot create a receipt, handoff, index,
interpretation or learning effect. Default scheduled processing and ordinary
read-only consumption do not run this probe. It is a provenance integration
check, never a genuine feedback or discovery cycle.

Index lookup is bounded; signing-key rotation that makes an old statement
unverifiable triggers bounded re-verification without deleting any old artifact.
An unavailable issuance key keeps ordering verification pending. Expired JWTs
are accepted only as signature evidence about historical bookkeeping, never as
fresh action authorization or a renewed taste snapshot. Daily consumption still
recomputes complete current feedback/policy inputs. Production issuer keys are
loaded only from GitHub's fixed HTTPS endpoint, never from a stored record.

A packet with the same policy parent may still predate the handoff. After the
handoff is persisted, the trusted writer checks that the dated packet is absent
and seals that fact on `learning/issuance-<use_id>`. Consumption requires this
certificate. A handoff first issued after staging receives no certificate and
its packet is recorded as `ordering_unproven`, without candidate diagnostics or
any context-use claim. No late writer can backfill this missing ordering proof.

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
