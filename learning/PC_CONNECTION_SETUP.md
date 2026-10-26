# Proposed domain-free PC connection

Source preparation only. No Cloudflare plan, application, Worker, tunnel, binding,
credential, local service or task connection is created by these files. The
private-learning hold remains in force. Setting up transport is separate from
authorizing interpretation, learning or any public write.

## Route and boundaries

```text
ChatGPT cloud task
  -> Cloudflare Access + Managed OAuth (exact owner only)
  -> dedicated workers.dev gateway (no GitHub credentials or storage)
  -> fixed Workers VPC Service (127.0.0.1:6505 only)
  -> outbound cloudflared connection on the PC
  -> held loopback MCP host (verifies the same signed Access assertion)
```

A public Tunnel hostname requires a domain. Workers VPC is a different supported
route: a Worker reaches a private host/port through its VPC Service binding.
Access can protect the Worker's workers.dev production and preview routes, so
this candidate does not require purchasing a domain. VPC is beta and currently
free on Workers plans; normal Workers request/compute limits still apply. Confirm
current account entitlements, limits and actual transport before activation.

Use a dedicated new Worker and one VPC **Service**; no VPC Network binding, broad
LAN route, wildcard destination, inbound router port, or change to the existing
TV capture relay. The gateway checks the signed owner identity before forwarding,
constructs a fixed loopback destination and passes only that assertion and MCP
protocol headers. It strips cookies and Authorization, bounds requests/responses,
sets no-store and makes one backend attempt. Unknown outcomes stay pending;
it never replays a request or changes a research/session identity.

The VPC Service restricts this Worker's binding, not every capability of an
account administrator or the tunnel daemon. Before installing persistent access,
review dedicated local-user/process containment, tunnel credential permissions
and administrative routes so a reconfigured tunnel cannot silently broaden PC
or LAN access. Do not register a general GitHub runner as a shortcut. Access
authentication cannot mint the existing GitHub OIDC evidence provenance.

## Reviewable setup sequence

1. Complete Zero Trust Free onboarding in the existing Cloudflare account.
   The human handles any plan agreement, billing entry or new credential step.
   This is not a learning cutover. No paid plan is required by this candidate.
2. Review the host-containment and credential-storage setup before installing
   any persistent daemon. Use only the held CLI, trusted private-main code,
   a dedicated unprivileged local identity, protected local configuration and
   a verified official cloudflared release. No GitHub/provider/signing secrets
   are configured during transport checks. Do not weaken firewall/TLS controls.
3. Create the dedicated Worker with workers.dev and preview URLs disabled and
   `PRIVATE_GATEWAY_ENABLED=false`. Do not set account-wide Access, which could
   interfere with the existing public append-only TV relay.
4. Configure owner-only Access for the dedicated Worker's entire production and
   preview surface, then Managed OAuth. Record the fixed team issuer, application
   audience and independently verified exact owner subject/email. Never obtain
   these values from an unverified token or put a bearer token in a task prompt.
5. Create a private VPC Service targeting only 127.0.0.1:6505 via the reviewed
   tunnel. Bind it as `PRIVATE_RESEARCH`; do not publish a Tunnel hostname or add
   a VPC Network binding. Configure the gateway's fixed workers.dev origin and
   same port. Keep previews disabled and application logging off.
6. Write a private local access JSON containing exactly `issuer`, `audience`,
   `subject`, `email`. Start the held host with:

   ```text
   node learning/research-mcp-host.mjs --access-config PRIVATE_CONFIG_FILE --port 6505
   ```

   The local bearer environment variable must be absent in this mode. No startup
   option can inject an active adapter, credentials, provider or signing module.
   The sample Worker config contains placeholders and refuses service by default.
7. After concrete deployment/access approval, enable only this gateway route.
   Verify signed owner access, rejection of unsigned/wrong-identity requests,
   fixed VPC destination and no public origin route. Verify actual ChatGPT OAuth,
   discovery of the five tools. Call only `private_research_health` with `{}` to
   check authenticated reachability while held; do not open a private context for
   a connection test. Its transport result reads no feedback, dispatches no task,
   persists nothing and makes no claim that learning is active. Then verify actual saved-task
   availability without changing schedules/states or replaying denied work.

Use `pc-gateway.wrangler.example.jsonc` as a reviewed template, not live config.
Rollback first holds/disables this gateway and stops its local tunnel/service;
preserve packets, immutable attempts and private evidence. Do not touch the TV
relay, public addon protection/history or held legacy PRs.

## Protocol compatibility

The HTTP host uses the pinned official v2 server entry for the 2026-07-28
`server/discover` flow and preserves JSON-only legacy initialization on the same
endpoint. The gateway and origin forward only the bounded standard
`MCP-Protocol-Version`, `Mcp-Method` and `Mcp-Name` headers; the SDK checks their
agreement with the unchanged RPC body before dispatch. No tool declares custom
`Mcp-Param-*` mirrors. Old and modern official clients are development-only test
dependencies; neither caller authentication nor the default hold changes with
protocol negotiation. Test both versions through the real loopback HTTP path and
gateway before deployment. A successful owner browser health check alone does
not establish ChatGPT action discovery or actual saved-task use.

## Remaining learning gates

This gateway forwards transport; it cannot interpret feedback, stage AI packets,
sign evidence, search, publish, authorize access to the task adapter or demonstrate
recommendation effects. The trusted signing runtime, real read-only provider,
revision-pinned interpretation, saved-task use and explicit learning cutover
remain required. Never count a fixture, held response or hosting connection as
successful feedback learning or as a permanent fix for earlier connector denials.

Official references checked October25:

- [Fixed VPC Services](https://developers.cloudflare.com/workers-vpc/configuration/vpc-services/)
- [Tunnel private-service routing](https://developers.cloudflare.com/workers-vpc/configuration/tunnel/)
- [Workers Access, including workers.dev](https://developers.cloudflare.com/workers/configuration/cloudflare-access/)
- [Managed OAuth](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/managed-oauth/)
- [VPC beta pricing](https://developers.cloudflare.com/workers-vpc/platform/pricing/)
- [ChatGPT scheduled-task plugins](https://learn.chatgpt.com/docs/automations)

The product docs permit plugins in scheduled tasks, but that does not prove this
particular account's saved tasks can use this undeployed server. Actual tool
discovery and genuine use must be observed after authorized connection.
