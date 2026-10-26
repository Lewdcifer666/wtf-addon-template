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

The complete encoded workflow-dispatch body has a conservative 60000-byte bound,
including outer JSON escaping. Oversized packets fail before dispatch without
truncation. Private feedback pages are separately bounded at128KiB. This inline
submission transport does not yet support larger complete interpretation packets;
they require a reviewed chunk/assembly transport, never omitted feedback or a
partial packet presented as complete.

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
