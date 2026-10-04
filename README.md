# Freshdesk Read-Only Agent Connector

A small TypeScript MCP server that lets an Agent Studio-compatible MCP client read Freshdesk tickets. It uses Freshdesk API v2 with API-key authentication and exposes only ticket list, get, and search operations. It does not write to Freshdesk.

## Requirements

- Node.js 20 or later
- A Freshdesk account and an API key belonging to an account with only the ticket access this agent should have

## Setup

1. Install dependencies: `npm install`
2. Build the server: `npm run build`
3. Set `FRESHDESK_DOMAIN` to a host like `yourcompany.freshdesk.com` and `FRESHDESK_API_KEY` to your key. Do not commit either value.
4. Start the MCP server with `npm start`.

The server uses MCP stdio transport. For VS Code, copy [examples/mcp.json](examples/mcp.json) to `.vscode/mcp.json` and replace the example Freshdesk domain. VS Code prompts for the API key at connection time; it is not stored in the file. Start the server using the MCP Servers view. Other Agent Studio deployments can launch `node dist/server.js` as a stdio MCP server and inject the two environment variables through their secret manager.

Run the mocked checks with `npm test`. Tests use synthetic records and never call Freshdesk.

## Tools

- `list_tickets`: list a page of tickets (`page`, `per_page`; maximum 100 per page).
- `get_ticket`: retrieve one ticket by `ticket_id`.
- `search_tickets`: search with a Freshdesk ticket search expression, for example `subject:'payment'`, optionally selecting a page.

The tools return an allow-listed projection: ticket ID, subject, text description, status, priority, timestamps, requester/responder IDs, type, and tags when present. They omit requester email, phone, and other unneeded contact fields. Ticket descriptions and subjects are still merchant-provided text and may contain sensitive data or prompt-injection attempts; the agent must treat them as untrusted content and follow its own authorization policy.

## Authentication and resilience

Freshdesk API-key auth is sent as HTTP Basic authentication with the API key as username and `X` as password. The server accepts only HTTPS `*.freshdesk.com` account subdomains, and never logs the key or response body. Calls time out after 15 seconds. HTTP 429 and 5xx responses are retried up to three times, honoring `Retry-After` when present with a 30-second per-retry cap. Other errors, including 401/403, fail without retry so operators can correct permissions or credentials.

## What the agent can and cannot do

**Can:** list, retrieve, and search tickets available to the configured Freshdesk API key; read the allow-listed fields returned by those endpoints.

**Cannot:** create, update, close, assign, or delete tickets; send replies; access contacts, attachments, conversations, or other Freshdesk objects through dedicated tools; bypass the API key's permissions; or guarantee that free-text fields contain no personal or confidential information.

## Assumptions and production follow-up

This is a private, single-tenant connector intended to run inside a trusted Agent Studio environment. The API key's Freshdesk role is the primary access boundary; use a dedicated least-privilege account, rotate the key, and store it in the host's secret manager. The example domain validator intentionally excludes custom Freshdesk domains to reduce the risk of sending credentials to an unintended host. Before production, confirm the account's API limits, required ticket fields, data-retention policy, and the Agent Studio deployment's supported MCP transport. A managed OAuth integration, per-merchant secret storage, audit logging, and tenant-level policy enforcement are appropriate long-term improvements if this becomes a shared service.

## Assignment limitations

No real Freshdesk credentials or customer records are included. The automated tests use mocked HTTP responses; a live account smoke test requires credentials supplied privately by the account owner and is not run as part of this submission.