export class UnirateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnirateError";
  }
}

export class AuthenticationError extends UnirateError {
  constructor(message = "Missing or invalid API key") {
    super(message);
    this.name = "AuthenticationError";
  }
}

export class ProPlanRequiredError extends UnirateError {
  constructor(message = "This endpoint requires a UniRate Pro subscription") {
    super(message);
    this.name = "ProPlanRequiredError";
  }
}

export class InvalidCurrencyError extends UnirateError {
  constructor(message = "Currency not found or no data available") {
    super(message);
    this.name = "InvalidCurrencyError";
  }
}

export class InvalidRequestError extends UnirateError {
  constructor(message = "Invalid request parameters") {
    super(message);
    this.name = "InvalidRequestError";
  }
}

export class RateLimitError extends UnirateError {
  constructor(message = "Rate limit exceeded") {
    super(message);
    this.name = "RateLimitError";
  }
}

export class APIError extends UnirateError {
  public readonly statusCode: number;
  public readonly body?: string;
  constructor(message: string, statusCode: number, body?: string) {
    super(message);
    this.name = "APIError";
    this.statusCode = statusCode;
    this.body = body;
  }
}

export type FetchLike = (
  input: string,
  init?: { method?: string; headers?: Record<string, string>; signal?: AbortSignal },
) => Promise<{
  ok: boolean;
  status: number;
  text: () => Promise<string>;
  json: () => Promise<unknown>;
}>;

export interface UnirateClientOptions {
  apiKey: string;
  baseUrl?: string;
  timeoutMs?: number;
  fetchImpl?: FetchLike;
  userAgent?: string;
}

export class UnirateClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: FetchLike;
  private readonly userAgent: string;

  constructor(opts: UnirateClientOptions) {
    // Allow empty apiKey at construction so MCP host scanners can enumerate
    // tools without a key set. Calls without a key will fail at request time
    // with the API's own 401, which maps to AuthenticationError below.
    this.apiKey = opts.apiKey ?? "";
    this.baseUrl = opts.baseUrl ?? "https://api.unirateapi.com";
    this.timeoutMs = opts.timeoutMs ?? 30_000;
    this.fetchImpl = opts.fetchImpl ?? (globalThis.fetch as unknown as FetchLike);
    this.userAgent = opts.userAgent ?? "unirate-mcp/0.2.2";
  }

  private requireApiKey(): void {
    if (!this.apiKey) {
      throw new AuthenticationError(
        "Missing UniRate API key. Set UNIRATE_API_KEY (get a free key at https://unirateapi.com).",
      );
    }
  }

  private async request<T>(path: string, params: Record<string, string | number>): Promise<T> {
    this.requireApiKey();
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) qs.set(k, String(v));
    qs.set("api_key", this.apiKey);

    const url = `${this.baseUrl}${path}?${qs.toString()}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    let response;
    try {
      response = await this.fetchImpl(url, {
        method: "GET",
        headers: {
          Accept: "application/json",
          "User-Agent": this.userAgent,
        },
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timer);
      if (err instanceof Error && err.name === "AbortError") {
        throw new UnirateError(`Request to ${path} timed out after ${this.timeoutMs}ms`);
      }
      throw new UnirateError(
        `Network error calling ${path}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    clearTimeout(timer);

    if (response.ok) {
      return (await response.json()) as T;
    }

    const body = await response.text().catch(() => "");
    switch (response.status) {
      case 400:
        throw new InvalidRequestError();
      case 401:
        throw new AuthenticationError();
      case 403:
        throw new ProPlanRequiredError();
      case 404:
        throw new InvalidCurrencyError();
      case 429:
        throw new RateLimitError();
      case 503:
        throw new APIError("Service unavailable", 503, body);
      default:
        throw new APIError(
          `UniRate API returned HTTP ${response.status}`,
          response.status,
          body,
        );
    }
  }

  async getRate(from: string, to: string): Promise<number> {
    const data = await this.request<{ rate: string }>("/api/rates", {
      from: from.toUpperCase(),
      to: to.toUpperCase(),
    });
    return parseFloat(data.rate);
  }

  async getRates(from: string): Promise<Record<string, number>> {
    const data = await this.request<{ rates: Record<string, string> }>("/api/rates", {
      from: from.toUpperCase(),
    });
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(data.rates)) out[k] = parseFloat(v);
    return out;
  }

  async convert(from: string, to: string, amount: number): Promise<number> {
    const data = await this.request<{ result: string }>("/api/convert", {
      from: from.toUpperCase(),
      to: to.toUpperCase(),
      amount,
    });
    return parseFloat(data.result);
  }

  async getSupportedCurrencies(): Promise<string[]> {
    const data = await this.request<{ currencies: string[] }>("/api/currencies", {});
    return data.currencies;
  }

  async getHistoricalRate(date: string, from: string, to: string): Promise<number> {
    const data = await this.request<{ rate?: string; result?: string }>(
      "/api/historical/rates",
      { date, from: from.toUpperCase(), to: to.toUpperCase(), amount: 1 },
    );
    if (data.rate !== undefined) return parseFloat(data.rate);
    if (data.result !== undefined) return parseFloat(data.result);
    throw new APIError("Unexpected historical rate response shape", 500);
  }

  async convertHistorical(
    date: string,
    from: string,
    to: string,
    amount: number,
  ): Promise<number> {
    const data = await this.request<{ rate?: string; result?: string }>(
      "/api/historical/rates",
      { date, from: from.toUpperCase(), to: to.toUpperCase(), amount },
    );
    if (data.result !== undefined) return parseFloat(data.result);
    if (data.rate !== undefined) return parseFloat(data.rate) * amount;
    throw new APIError("Unexpected historical rate response shape", 500);
  }
}
