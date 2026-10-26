# Persistent PC transport proposal — disabled until separately approved

This is the deployable, **held-only** connection, not a learning cutover. The
previous short health windows expired. The runtime App grant does not authorize
this installation, a new remote window, or any private task. Do not invoke the
installer or supervisor run mode without the human's concrete transport decision.

## What the installation would do

One Windows task, `WTF Stremio Private Held Runtime`, runs at the current owner's
logon with an interactive, limited principal and no stored Windows password. It
uses the existing Node and Docker installations. The PC must stay on and the
owner must remain logged in; this does not promise operation while logged off.
The task runs hidden, with no execution-policy bypass or administrator elevation.
It copies just the two manifest-verified operator modules from an exact approved
private-main revision into a new versioned owner/SYSTEM-only directory. Existing
tasks or installed code are never overwritten. `-WhatIf` prepares nothing.

`runtime.json` defaults to `remote_service_enabled:false` and requires
`task_access_enabled:false`. The schema rejects enabling private tasks. The
installer requires a separate explicit operator switch and normal ShouldProcess
confirmation. `-StartApprovedTransport` changes only the approved transport gate.
No script, default, task registration or health result supplies human permission.

## Containment

The supervisor exclusively owns one Windows named pipe. The OS releases it after
a crash, avoiding stale PID locks; another owner cannot start Docker operations.
Only fixed container names with this exact deployment's label can be reconciled.
Unknown or mismatched containers are preserved and block startup.

Each 30-minute cycle uses pinned local images, no image pulls or automatic code
updates, no host ports/network/Docker socket, read-only roots, dropped capabilities,
non-root users, CPU/memory/PID limits and no container request logs. The namespace
and both long-lived containers expire independently even if the supervisor dies.
The supervisor normally rolls them before expiry. This runs no permanent GitHub
job and consumes no Actions minutes for the held transport.

Before the app or connector starts, one credential-free helper installs the
policy in the fresh container namespace. Both firewall families default to DROP;
IPv6 and forwarding remain denied. Exact rule read-back rejects extra ACCEPTs.
The app UID can reach only the current fixed owner-issuer's validated public IPv4
addresses on HTTPS and the fixed DNS resolver. The connector UID can reach only
the existing Cloudflare QUIC edge list and origin loopback port6505. No fallback
to broad HTTPS, IPv6, LAN, host services or metadata. Issuer DNS is re-evaluated at
each cycle through1.1.1.1, bounded and fail-closed; TLS verification stays enabled.
An unavailable/changed endpoint stays pending, never silently broadens the list.

The app receives only a generated immutable held broker config and resolver file.
The connector receives only its existing tunnel token and resolver. **Neither
the App PEM nor the research journal, feedback, repository checkout or learned
evidence is mounted. GitHub API/OIDC egress is absent.** The App credential already
verified separately is retained in the protected host directory for a later
reviewed and explicitly authorized learning/runtime transition.

## Configuration and stopping

The protected directory must be the current owner's resolved
`%USERPROFILE%\WTFStremioPrivate\connection`, outside Git, MSIX app caches and
junctions. Packaged Codex can redirect AppData into its package cache, which may
disappear on app uninstall and differs from an ordinary logon task's environment.
The installer resolves the actual path with Node before any copies or task
registration and requires the exact stable profile directory. Package-cache
paths are rejected by the runtime schema. Preparing this location never permits
an automatic service start or a broader credential/identity grant.
Windows ACLs must allow only the owner and SYSTEM; the installer checks them.
The closed config pins the access JSON hash, source revision and four exact image
IDs. A changed config/identity/image stops the running supervisor; it is not
silently adopted. Only changing the transport flag to false is a normal stop.

While the supervisor is running, setting `remote_service_enabled:false` stops
its owned containers on the next poll. Disable the exact Windows task and the
existing Cloudflare gateway as well for rollback. If the supervisor has crashed,
its independent container deadline bounds residual access to at most30minutes
plus10seconds of kill grace; verify/remediate the exact labelled containers for
an immediate stop. Preserve code, credentials, packets, attempts and journals.
Never reset main or remove learning/publication history to repair this runtime.

The supervisor records only closed structural stages. Windows redirects these
to the protected operational log. No raw request, error, token or learned context
is logged. Cycle policy files and previous code versions are preserved; storage
maintenance must be reviewed rather than deleting unresolved personal evidence.

## Review and acceptance before installation

Validate the exact code through normal PRs and run credential-free containment
checks. Prepare a disabled config with actual reviewed image IDs and inspect the
actual resolved directory/ACLs. Review the owner-only Access identity, fixed VPC
origin and existing gateway; no identity, OAuth callback or TV relay changes.
Then obtain the explicit persistent held-transport decision before task creation,
mounting the existing tunnel token or enabling the gateway. A separate learning
cutover is still required for App-key/journal mounts, GitHub egress and private
task execution. That later transition must retain trusted OIDC and all source,
feedback correction/retraction, privacy, actual-use and recommendation-effect
gates. This held installation cannot satisfy those gates by itself.

No account, credential, service, Windows task, gateway change, learning gate,
private task call or publication is created by adding this source or its tests.
