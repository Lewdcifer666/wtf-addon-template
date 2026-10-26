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
uncertain response as pending. The host must durably retain that original request
and recover its signed result before deciding whether any further dispatch is
safe. This dispatcher alone is not a durable queue or an authenticated task host.

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

This code does not expose new MCP tools, connect saved ChatGPT tasks, install a PC
broker image, mount the App key/journal, broaden network access or enable any
worker. Durable host request transport and actual saved-task consumption must be
connected and reviewed before cutover. Existing holds and denied operations stay
held. Completion still requires explicitly authorized recomputation and genuine
new feedback affecting subsequent research, including correction and retraction.
