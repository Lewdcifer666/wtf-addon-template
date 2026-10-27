# Private interpretation submission

`interpretation-worker.mjs` connects the complete pinned interpretation contract
to the existing deterministic learner. This is trusted-main code, not an AI API
client or a deployed task connection. The worker and its separate deployment
variable are disabled by default. Installing a held transport does not authorize
private interpretation, staging or learning activation.

## Closed handoff

The worker accepts only `request`, `page`, `validate` and `submit`. The first
three use the read-only interpretation adapter. `submit` validates every current
required event against the complete authenticated feedback inventory, including
supersession, retraction, original blob identities, exact quotes and structured
answer precedence. Missing interpretations fail; unknown values are not invented.
JSON key order and interpretation order cannot allocate another logical request.

The destination is computed by code: `interpretation/<source_revision>` and
`learning-inbox/<source_revision>/<request_id>.json`, only in the verified private
feedback repository. The single added file is checked against the trusted parent.
There is no caller-selected repository, path, branch, writer, script or signer.
Nothing writes main, public data, activation or profile weights.

Requests use the fixed main `learning-finalize.yml` workflow. The dispatcher
validates before obtaining credentials, makes one bounded POST, and treats an
uncertain response as pending. The interpretation broker durably retains the
original request and recovers its signed result before considering another
dispatch. This dispatcher alone is not a durable queue or an authenticated host.

The complete encoded workflow-dispatch body has a conservative60000-byte bound,
including outer JSON escaping. Complete task calls up to1MiB use inline transport
when they fit; larger submissions are split into fixed40KiB byte parts and one
assembly request. Each dispatched body remains below the bound. The AI still
submits one complete closed packet; internal part/assembly methods are not MCP
tools and do not let the AI choose a writer or path. Private feedback pages remain
bounded at128KiB. Larger-than-contract calls fail before dispatch without
truncation; no event is dropped to make a packet fit.

Parts are unsigned, untrusted private transport on fixed immutable refs, never
learning evidence. They carry a canonical packet hash, byte count, part count,
source revision and request identity. Assembly reads every part, checks the full
Git graphs and exact concatenated bytes/hash/UTF-8/canonical JSON, then performs
complete current inventory, provenance and quote validation. Only after that may
the existing worker stage a real interpretation, mint a genuine OIDC receipt and
run deterministic aggregation. Incomplete, conflicting or altered parts stay
unresolved; they cannot become a partial interpretation or arbitrary signed data.

## Trusted execution and recovery

The separate interpretation job requires explicit
`PRIVATE_INTERPRETATION_WORKER_ENABLED=true`, an ordinary main workflow dispatch,
and no conflicting research/consume/probe/dry-run input. It checks out fresh
trusted main, installs its checked-in dependencies without scripts/caches, runs
the shared checks and has a five-minute limit. The PC App can only dispatch and
read; GitHub Actions owns packet staging and genuine GitHub OIDC provenance.
Repository-wide finalization concurrency retains cancellation disabled.

Each result is sealed privately on
`learning/interpretation-result-<canonical_request_hash>`. The reader verifies its
parent, complete changed paths, blob hashes and OIDC proof. A submission receipt
binds the exact canonical packet and original staging commit. It proves staging,
not aggregation, learning activation, delivery, AI use or recommendation effect.

An unchanged retry reuses the original packet and result. Lost ref acknowledgement
is recovered by reading the same ref. Conflicting packets are retained unresolved;
they are never overwritten. If a completed receipt's original packet disappears,
the worker refuses to recreate it. Interrupted result persistence can resume from
the already staged packet. Every retry revalidates current private source; changed
source is stale. Public policy changes cause fresh deterministic aggregation.

After submission the same bounded Actions job calls the existing reconciliation
engine. This is necessary because Git writes made by `GITHUB_TOKEN` do not wake
another push workflow. Hourly reconciliation independently recovers interrupted
post-staging work. The caller's separate access gate is rechecked before derived
writes, while the existing activation policy continues to control learned output.
Inactive policy yields genuinely computed inactive state, never an activated or
timestamp-renewed taste snapshot.

## Remaining deployment work

The source host can expose `private_interpretation_request`, `page`, `validate`
and `submit`, only when a separately enabled interpretation adapter is explicitly
installed. Ordinary held/legacy host configuration still advertises its original
five tools. Interpretation requires both server-owned
`interpretation_access_enabled:true` and
`PRIVATE_INTERPRETATION_BROKER_ALLOWED=true`. Research authorization cannot enable
interpretation. Both permissions are rechecked on every call and before releasing
cached results; health does not enter either adapter.

The pure read-only `private_interpretation_status({})` resolves the current
private source and authenticates its existing staged packet plus signed
submission. It needs no GitHub connector call, raw-feedback inventory, journal
write or workflow. A daily task must call it first: unchanged accepted state
needs no new AI interpretation. An unsigned/partial staged branch is explicitly
unverified, never permission to overwrite it or generate a replacement packet.
Proof/source errors stop rather than masquerading as missing feedback. It makes
no assertion about learning activation or recommendation effects.

Once interpretation is explicitly enabled, the existing trusted reconciliation
job prepares the complete current descriptor and every private feedback page
after its ordinary reconciliation step. No extra hourly job, AI call or task
slot is added. This is skipped for dry runs and remains bounded at five minutes.
The scheduled AI task can then read already prepared signed input directly,
without waiting for a separate Actions job per page. Preparation never stages
an interpretation or activates learning.

An immutable signed preparation receipt binds all request/page commit identities
and hashes. An interrupted producer reuses its completed pages; once the receipt
exists, a lost descriptor or page cannot be regenerated. Unchanged preparation
reuses its authenticated input without reloading raw blobs or minting new proofs.
Privacy/current source/hold checks remain fresh. These records prove prepared
input, not AI interpretation, learning use or recommendation effects.

The read-only PC client can fetch only fixed metadata, immutable Git objects and
the exact interpretation/result refs needed for verification. Git writes and
OIDC signing stay inside trusted Actions. MCP annotations disclose private
bookkeeping; submission returns staged state rather than an invented learning
effect. The encrypted connection and owner authentication requirements are
unchanged.

Research and interpretation use one protected journal and one outstanding
dispatch lease, not competing independent workflow queues. Original requests,
attempts and completion hints survive PC replacement. At most three reservations,
ten minutes apart, are permitted under the same identity. Missing completed
artifacts cannot regenerate evidence. A changed submission for the same source
and request conflicts with its retained original; it cannot silently replace it.
Stale/exhausted/corrupt requests remain unresolved. Each family polls its own
pending work fairly while sharing the dispatch limit.

Multipart requests use that same lease one part at a time. The original complete
packet and each internal attempt survive a PC restart; successful parts are read
back and reused, never overwritten. Missing previously completed parts block
recovery rather than allowing regeneration. The PC caches only already verified
immutable graphs and commit identities to avoid quadratic payload downloads;
mutable refs, privacy, source and access are checked fresh. After a PC restart,
graphs are verified again; local completion hints alone are never authority.

Interpretation submissions contain personal quotes. The journal therefore holds
private normalized evidence as well as search requests and must remain outside
Git, under the approved owner/SYSTEM-only directory, never logged or published.
No returned feedback pages or learned contexts are stored there. A future journal
mount decision must explicitly cover these private submissions.

This code does not update the installed held image, connect saved ChatGPT tasks,
mount the App key/journal, broaden network access or enable a worker. The contained
runtime policy/packaging and actual saved-task consumption still require review
before cutover. Existing holds and denied operations stay held. Completion
requires explicitly authorized recomputation and genuine new feedback affecting
subsequent research, including correction and retraction.
