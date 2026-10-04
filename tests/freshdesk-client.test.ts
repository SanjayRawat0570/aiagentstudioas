import assert from "node:assert/strict";
import { test } from "node:test";
import { FreshdeskApiError, FreshdeskClient } from "../src/freshdesk-client.ts";

const ticket = {
  id: 42,
  subject: "Payment status",
  description_text: "Customer cannot confirm the payment.",
  status: 2,
  priority: 1,
  created_at: "2026-09-01T10:00:00Z",
  updated_at: "2026-09-01T10:15:00Z",
  requester_id: 7,
  email: "private@example.test",
};

test("list tickets sends API-key auth and returns only approved ticket fields", async () => {
  let capturedUrl = "";
  let capturedAuthorization = "";
  const client = new FreshdeskClient({
    domain: "acme.freshdesk.com",
    apiKey: "test-key",
    fetchImpl: async (input, init) => {
      capturedUrl = String(input);
      capturedAuthorization = new Headers(init?.headers).get("authorization") ?? "";
      return Response.json([ticket]);
    },
  });

  const results = await client.listTickets(2, 10);
  assert.equal(capturedUrl, "https://acme.freshdesk.com/api/v2/tickets?page=2&per_page=10");
  assert.equal(capturedAuthorization, `Basic ${Buffer.from("test-key:X").toString("base64")}`);
  assert.equal(results[0]?.id, 42);
  assert.equal("email" in (results[0] ?? {}), false);
});

test("search tickets URL-encodes the query and returns total count", async () => {
  let capturedUrl = "";
  const client = new FreshdeskClient({
    domain: "acme.freshdesk.com",
    apiKey: "test-key",
    fetchImpl: async (input) => {
      capturedUrl = String(input);
      return Response.json({ results: [ticket], total: 1 });
    },
  });

  const result = await client.searchTickets("payment failed", 3);
  const url = new URL(capturedUrl);
  assert.equal(url.pathname, "/api/v2/search/tickets");
  assert.equal(url.searchParams.get("query"), '"payment failed"');
  assert.equal(url.searchParams.get("page"), "3");
  assert.equal(result.total, 1);
  assert.equal(result.results[0]?.id, 42);
});

test("retries 429 using Retry-After before succeeding", async () => {
  let attempts = 0;
  const delays: number[] = [];
  const client = new FreshdeskClient({
    domain: "acme.freshdesk.com",
    apiKey: "test-key",
    sleep: async (milliseconds) => { delays.push(milliseconds); },
    fetchImpl: async () => {
      attempts += 1;
      return attempts === 1
        ? new Response("throttled", { status: 429, headers: { "retry-after": "2" } })
        : Response.json(ticket);
    },
  });

  const result = await client.getTicket(42);
  assert.equal(result.id, 42);
  assert.equal(attempts, 2);
  assert.deepEqual(delays, [2000]);
});

test("does not retry authentication failures", async () => {
  let attempts = 0;
  const client = new FreshdeskClient({
    domain: "acme.freshdesk.com",
    apiKey: "test-key",
    fetchImpl: async () => {
      attempts += 1;
      return new Response("unauthorized", { status: 401 });
    },
  });

  await assert.rejects(client.getTicket(42), (error: unknown) => {
    assert.ok(error instanceof FreshdeskApiError);
    assert.equal(error.status, 401);
    return true;
  });
  assert.equal(attempts, 1);
});

test("rejects unsafe domains and invalid pagination", async () => {
  assert.throws(() => new FreshdeskClient({ domain: "localhost", apiKey: "key" }));
  const client = new FreshdeskClient({ domain: "acme.freshdesk.com", apiKey: "key" });
  await assert.rejects(client.listTickets(1, 101), /perPage/);
  await assert.rejects(client.getTicket(0), /ticketId/);
});