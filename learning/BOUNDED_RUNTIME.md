# Bounded trusted worker / PC broker

This is reviewed-deployment preparation, not a learning cutover. All existing
private-learning, interpretation, legacy-work and safety-denial holds remain.
The family extension is excluded. No OpenAI API or paid search provider is used.

## Execution and data flow

Owner OAuth -> existing Access gateway -> authenticated PC broker -> private
durable request -> fixed GitHub Actions dispatch -> trusted-main worker ->
original validated learning/session engine -> sealed private result ->
authenticated PC read-back -> private response to the owner task.

The worker calls the existing closed task adapter. A caller cannot supply scores,
context, code, weights, signer, provider, repository, branch or output file. The
PC's API capability grants no Git write; only trusted Actions writes derived
artifacts. GitHub OIDC still binds every sealed body to the original private
repository, workflow, main ref and executed revision. The worker is not an
arbitrary-digest signing endpoint. Its synthetic tests do not establish live use.

The bounded worker caches only content-addressed Git objects and immutable
comparisons, with repository-local memory/entry limits and cloned responses.
Repository identity/privacy, all current heads, refs and ref inventories are
always read again. Issuer-key/OIDC reads have whole-response byte/time bounds;
key discovery refreshes for rotation while preserving every original claim,
signature, revision and freshness check. No key from an artifact is trusted.

## Independent gates

- Existing `learning/config/activation.json` remains deployment-owned and false.
- PC config defaults to `task_access_enabled:false`. Active access also requires
  `PRIVATE_RESEARCH_BROKER_ALLOWED=true`; config is checked on every operation.
- GitHub's new `PRIVATE_RESEARCH_WORKER_ENABLED` variable defaults to absent/false.
  The PC App has no Variables write permission and cannot enable it.
- Only a manual workflow dispatch on main with nonempty closed `task_request`,
  `dry_run:false`, no consume/probe mixture and the enabled worker variable runs
  the job. Source is freshly pinned main, never research code/dependencies/caches.

The five-minute worker shares existing repository-wide non-cancelling writer
concurrency. It exits after one logical operation; no permanent Actions service
or self-hosted runner is registered. No private-environment paid feature is
assumed. Current branch protection and all stronger requirements remain intact.

## Durable recovery

The PC journal contains closed task requests, dispatch attempts and verified
completion references, never returned feedback pages or learned contexts.
Interpretation submission requests contain private quoted evidence, and search
terms can reveal preferences: the directory must be private to the owner/SYSTEM,
must be outside every public repository/artifact path and must be mounted only
into the broker. Deployment must inspect the resolved Windows path and actual
ACLs before recording `private_directory_verified:true`; the library flag is an
operator assertion, not an automatic Windows ACL audit. Source code alone does
not establish this boundary. One broker process owns a journal; multiple active
processes/replicas are unsupported and must be prevented by the runtime setup.

Requests are flushed to private temporary files and atomically linked without
replacement before dispatch. A crash may retain an orphan temporary; it is
preserved and cannot masquerade as a submitted request. Files are never overwritten
or deleted during reconciliation. A changed query under the same search request
ID conflicts. One outstanding dispatch prevents GitHub's pending-slot eviction.
At most three automatic reservations, ten minutes apart, are made under the same
identity; exhausted, stale or corrupt work remains unresolved, not discarded.
The journal has a100000-file safety bound; hitting it requires reviewed archival
work preserving request identities, not deletion or an empty replacement store.

The worker persists signed pre-search intent before calling a provider. A new job
can recover a signed result, but cannot repeat an unknown provider outcome with a
new nonce/request/provider. Public staging is still refused for new sessions and
searches. Verification-only recovery requires the actual staged packet, current
source heads, original signed context, completed matching intents and searches;
it refuses to backfill missing pre-packet evidence.

## Credentials and network changes requiring an explicit decision

Use a **separate private runtime GitHub App**, installed only on
`Lewdcifer666/wtf-scifi-feedback`: Contents read, Actions write, Metadata read.
Do not expand/reuse the six-addon publication App. Contents read technically
includes private feedback files; broker code restricts reads to metadata, pinned
Git objects and its sealed task refs. Protect the App private key accordingly.
Actions write can dispatch workflows; the broker fixes this capability to one
main workflow and never accepts caller-selected routes. The App cannot change
Git contents, activation policy or repository variables.

The human must approve/create the App installation and generate its private key.
Keep the PEM only in the protected owner/SYSTEM host directory and read-only
broker mount; never paste it into chats, prompts, source, environment logs or argv.
The App factory requests only repository ID1343321761 and the exact two needed
permissions, verifies returned scope/expiry, caches one-hour installation tokens
and refreshes them without a PAT. API authentication is distinct from learning
provenance. No real App/key or installation token has been created by this code.

The search APIs are free/keyless; private GitHub Actions jobs still consume the
account's existing included runner minutes. Before enabling runtime dispatch,
verify available allowance, expected job volume and a zero-overage spending cap.
No paid spending, budget increase, plan upgrade or recurring charge is authorized.
The worker is currently disabled and has not been dispatched against real data.

Retain the current owner-only Access identity/redirects. Runtime approval must
cover a single private writable journal mount and GitHub API HTTPS egress in
addition to the existing fixed Cloudflare network paths. No host ports, Docker
socket, public tunnel hostname, raw-feedback mount or untrusted code. Prepare and
verify the actual contained image, ACLs, shutdown/recovery and token-refresh path
before installing persistent execution or renewing remote-access grants.

## Cutover and acceptance

Before a genuinely new research opening, the trusted worker recomputes and
persists the complete current deterministic receipt/handoffs. Another genre's
publication therefore cannot leave the next task waiting solely for the hourly
job. This writer exists only inside the bounded main Actions worker; read-only
session consumers and the PC client remain read-only. It cannot infer missing
interpretation, activate policy or issue context after research staging.
Existing results/tickets are authenticated and recovered without refreshing or
replacing their frozen session; stale/ambiguous searches remain unresolved under
their original identity. The caller's hold is checked before derived writes.

First validate this code and permissions through normal reviewed PRs. Installing
a held host or testing health cannot authorize private context/feedback access.
Do not set access/worker/learning gates merely to demonstrate a response. An
explicitly authorized private learning cutover must follow fresh complete-source
interpretation and deterministic recomputation, then real saved-task availability,
feedback supersession/retraction, signed search recovery, subsequent research use
and observed recommendation effects. No timestamp renewal or fabricated feedback.

The research worker consumes already validated interpretation state. A separate,
default-disabled [interpretation worker](INTERPRETATION_SUBMISSION.md) can validate
and stage a complete private packet and invoke deterministic reconciliation.
The opt-in interpretation broker/MCP source now connects that worker to a durable
private request journal shared with research. It requires its own independent
server-owned gate. Neither source worker connects the saved tasks or installs
the contained active runtime; those remain required deployment and hold-resolution
work. The existing held image exposes no new interpretation tools.

Keep original task times/states/rotator, all six catalogs and historical bytes.
Use the existing publication/reconciliation architecture after a genuine packet
is staged. This broker cannot stage research/interpretation, merge, deploy or
replay any denied operation. Real source quality and Thriller's provenance rule
remain binding; Wikipedia/TVmaze metadata does not substitute for corroboration.

Rollback disables the PC access and GitHub worker gates, stops the broker and
gateway, preserves private requests and sealed artifacts, and repairs source
through a validated PR. Never reset main, overwrite immutable history, weaken
protection, or restore direct-to-main automation.
