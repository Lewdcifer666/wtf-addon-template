# Contained private task runtime — deployment requires approval

The installed held connection stays unchanged. The new operator-only
`--run-approved-task-runtime` entry accepts a separate closed version2
`task-runtime.json`. Its default transport and task flags are false. The old held
schema/entry cannot enable private tasks. Preparing source/config is not an
installation, an access grant, a worker enable or a learning cutover.

The task runtime retains the existing owner-only Access connection, fixed private
tunnel and loopback6505 origin. It shares the held supervisor's exclusive Windows
pipe and three exact container names/ownership labels, so two modes cannot own
the connection concurrently. Switching the scheduled task requires a concrete
reviewed operator change; this program never edits an installed task or stops an
unrelated process. Owned stale containers can recover under the exclusive lease;
unknown labels are preserved and block startup.

## Exact additional capability

The broker alone receives two new fixed mounts under the protected owner's
`WTFStremioPrivate/connection` directory: read-only
`runtime-app.private-key.pem` at `/run/secrets/runtime-app.pem`, and the writable
`requests` journal at `/run/private-requests`. The journal contains private
interpretation quotes and public-search requests; never log, publish, commit or
discard it. No raw-feedback checkout, Docker socket or caller-selected mount is
present. The tunnel container receives neither the App key nor the journal.

The separate approved App5479574/installation175447684 is installed only on the
private feedback repository, with Contents read, Actions write and Metadata read.
GitHub's Contents read technically includes raw feedback. The broker capability
restricts requests to metadata, immutable graphs and its fixed sealed refs. It
cannot write Git objects, stage a packet directly, sign GitHub learning evidence,
merge, deploy or change activation. Bounded trusted-main Actions jobs own private
packet staging and genuine GitHub OIDC signing.

Only the broker UID gains HTTPS egress to resolved public IPv4 addresses for the
fixed `api.github.com` and `token.actions.githubusercontent.com` hosts, alongside
the existing owner issuer. The union is bounded at16addresses. Arbitrary hosts,
private/reserved addresses, IPv6 and broad allow rules remain blocked. Exact
IPv4/IPv6 kernel policy is read back before the app or connector starts. The PC
does not gain search-provider or OpenAI API egress; real keyless provider calls
remain inside trusted Actions.

Before each cycle, read-only Windows checks verify owner/SYSTEM-only ACLs on the
protected root, key and journal, plus regular files/canonical paths. The
supervisor never reads the key's contents or places it in arguments or logs.
The broker consumes the key through its read-only mount and uses renewable
scoped installation tokens. Research and interpretation each require their own
config flag and matching environment gate; one grant cannot enable the other.
Repository worker variables remain independently default-disabled.

## Lifecycle and rollback

Images and source are pinned, roots read-only, users unprivileged, capabilities
dropped, host ports absent and logs disabled. Only the short-lived policy helper
receives NET_ADMIN before the service starts. All three containers retain their
independent30minute deadlines; the supervisor normally rolls them earlier.
Private requests and sealed results survive rollover, crashes and revocation.
An ambiguous provider invocation remains pending under its original identity.

Changing images, source or task permissions stops the current pinned cycle;
the supervisor cannot hot-load a broader grant. Setting its transport flag false
stops owned containers. Rollback disables task/worker gates, restores the reviewed
held task configuration and retains every private request and immutable artifact.
Learning activation policy still changes only through a separately authorized,
validated PR from genuinely recomputed state. Never reset main or weaken public
branch protection. Installed task updates, actual cloud tool availability and
genuine feedback/recommendation effects still require observed verification.
