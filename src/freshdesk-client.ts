export type FreshdeskTicket = {
  id: number;
  subject: string | null;
  description_text: string | null;
  status: number;
  priority: number;
  created_at: string;
  updated_at: string;
  requester_id?: number;
  responder_id?: number | null;
  type?: string | null;
  tags?: string[];
};

export type FreshdeskClientOptions = {
  domain: string;
  apiKey: string;
  fetchImpl?: typeof fetch;
  sleep?: (milliseconds: number) => Promise<void>;
  maxRetries?: number;
};

export class FreshdeskApiError extends Error {
  readonly status: number;
  readonly retryAfterSeconds?: number;

  constructor(
    message: string,
    status: number,
    retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = "FreshdeskApiError";
    this.status = status;
    if (retryAfterSeconds !== undefined) {
      this.retryAfterSeconds = retryAfterSeconds;
    }
  }
}

const MAX_PAGE_SIZE = 100;
const MAX_RETRY_DELAY_MS = 30_000;

export class FreshdeskClient {
  private readonly baseUrl: string;
  private readonly authorization: string;
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private readonly maxRetries: number;

  constructor(options: FreshdeskClientOptions) {
    const domain = options.domain.trim().toLowerCase();
    if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.freshdesk\.com$/.test(domain)) {
      throw new Error("FRESHDESK_DOMAIN must be a Freshdesk subdomain, such as acme.freshdesk.com");
    }
    if (!options.apiKey.trim()) {
      throw new Error("FRESHDESK_API_KEY is required");
    }

    this.baseUrl = `https://${domain}/api/v2`;
    this.authorization = `Basic ${Buffer.from(`${options.apiKey}:X`).toString("base64")}`;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.sleep = options.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
    this.maxRetries = options.maxRetries ?? 3;
  }

  async listTickets(page = 1, perPage = 30): Promise<FreshdeskTicket[]> {
    this.validatePagination(page, perPage);
    const query = new URLSearchParams({ page: String(page), per_page: String(perPage) });
    const tickets = await this.request<unknown>(`/tickets?${query.toString()}`);
    if (!Array.isArray(tickets)) {
      throw new Error("Freshdesk returned an unexpected ticket list response");
    }
    return tickets.map(projectTicket);
  }

  async getTicket(ticketId: number): Promise<FreshdeskTicket> {
    this.validateTicketId(ticketId);
    return projectTicket(await this.request<unknown>(`/tickets/${ticketId}`));
  }

  async searchTickets(query: string, page = 1): Promise<{ results: FreshdeskTicket[]; total: number }> {
    const normalizedQuery = query.trim();
    if (normalizedQuery.length < 2 || normalizedQuery.length > 250) {
      throw new Error("Search query must contain between 2 and 250 characters");
    }
    this.validatePagination(page, 1);

    const params = new URLSearchParams({ query: `"${normalizedQuery}"`, page: String(page) });
    const response = await this.request<unknown>(`/search/tickets?${params.toString()}`);
    if (!isRecord(response) || !Array.isArray(response.results) || typeof response.total !== "number") {
      throw new Error("Freshdesk returned an unexpected ticket search response");
    }
    return { results: response.results.map(projectTicket), total: response.total };
  }

  private async request<T>(path: string): Promise<T> {
    for (let attempt = 0; ; attempt += 1) {
      const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        headers: {
          Authorization: this.authorization,
          Accept: "application/json",
        },
        signal: AbortSignal.timeout(15_000),
      });

      if (response.ok) {
        return (await response.json()) as T;
      }

      const retryAfterSeconds = parseRetryAfter(response.headers.get("retry-after"));
      if ((response.status === 429 || response.status >= 500) && attempt < this.maxRetries) {
        const fallbackDelay = Math.min(500 * 2 ** attempt, MAX_RETRY_DELAY_MS);
        const retryDelay = retryAfterSeconds === undefined
          ? fallbackDelay
          : Math.min(retryAfterSeconds * 1000, MAX_RETRY_DELAY_MS);
        await this.sleep(retryDelay);
        continue;
      }

      throw new FreshdeskApiError(
        `Freshdesk API request failed with status ${response.status}`,
        response.status,
        retryAfterSeconds,
      );
    }
  }

  private validatePagination(page: number, perPage: number): void {
    if (!Number.isInteger(page) || page < 1) {
      throw new Error("page must be a positive integer");
    }
    if (!Number.isInteger(perPage) || perPage < 1 || perPage > MAX_PAGE_SIZE) {
      throw new Error(`perPage must be an integer between 1 and ${MAX_PAGE_SIZE}`);
    }
  }

  private validateTicketId(ticketId: number): void {
    if (!Number.isSafeInteger(ticketId) || ticketId < 1) {
      throw new Error("ticketId must be a positive integer");
    }
  }
}

function projectTicket(value: unknown): FreshdeskTicket {
  if (!isRecord(value) || typeof value.id !== "number") {
    throw new Error("Freshdesk returned an invalid ticket");
  }

  return {
    id: value.id,
    subject: typeof value.subject === "string" ? value.subject : null,
    description_text: typeof value.description_text === "string" ? value.description_text : null,
    status: typeof value.status === "number" ? value.status : 0,
    priority: typeof value.priority === "number" ? value.priority : 0,
    created_at: typeof value.created_at === "string" ? value.created_at : "",
    updated_at: typeof value.updated_at === "string" ? value.updated_at : "",
    ...(typeof value.requester_id === "number" ? { requester_id: value.requester_id } : {}),
    ...(typeof value.responder_id === "number" || value.responder_id === null
      ? { responder_id: value.responder_id }
      : {}),
    ...(typeof value.type === "string" || value.type === null ? { type: value.type } : {}),
    ...(Array.isArray(value.tags) && value.tags.every((tag) => typeof tag === "string")
      ? { tags: value.tags }
      : {}),
  };
}

function parseRetryAfter(value: string | null): number | undefined {
  if (value === null) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds;
  const dateMilliseconds = Date.parse(value);
  if (!Number.isNaN(dateMilliseconds)) return Math.max(0, (dateMilliseconds - Date.now()) / 1000);
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}