import { describe, expect, it } from "vitest";
import {
  APIError,
  AuthenticationError,
  type FetchLike,
  InvalidCurrencyError,
  InvalidRequestError,
  ProPlanRequiredError,
  RateLimitError,
  UnirateClient,
} from "../src/client.js";

type MockSpec = {
  status: number;
  body: unknown;
  expectUrl?: (url: string) => void;
};

function mockFetch(spec: MockSpec): FetchLike {
  return async (url) => {
    spec.expectUrl?.(url);
    return {
      ok: spec.status >= 200 && spec.status < 300,
      status: spec.status,
      text: async () => (typeof spec.body === "string" ? spec.body : JSON.stringify(spec.body)),
      json: async () => spec.body,
    };
  };
}

function client(spec: MockSpec): UnirateClient {
  return new UnirateClient({ apiKey: "test-key", fetchImpl: mockFetch(spec) });
}

describe("UnirateClient HTTP plumbing", () => {
  it("attaches api_key, Accept, User-Agent on every call", async () => {
    let captured = "";
    const c = new UnirateClient({
      apiKey: "secret-key-42",
      fetchImpl: async (url, init) => {
        captured = url;
        expect(init?.headers?.["Accept"]).toBe("application/json");
        expect(init?.headers?.["User-Agent"]).toMatch(/^unirate-mcp\//);
        return {
          ok: true,
          status: 200,
          text: async () => "",
          json: async () => ({ rate: "0.92" }),
        };
      },
    });
    await c.getRate("USD", "EUR");
    expect(captured).toContain("api_key=secret-key-42");
    expect(captured).toContain("from=USD");
    expect(captured).toContain("to=EUR");
  });

  it("uppercases currency codes before sending", async () => {
    let captured = "";
    const c = new UnirateClient({
      apiKey: "k",
      fetchImpl: async (url) => {
        captured = url;
        return { ok: true, status: 200, text: async () => "", json: async () => ({ rate: "1" }) };
      },
    });
    await c.getRate("usd", "eur");
    expect(captured).toContain("from=USD");
    expect(captured).toContain("to=EUR");
    expect(captured).not.toContain("from=usd");
  });

  it("rejects empty API key at construction", () => {
    expect(() => new UnirateClient({ apiKey: "" })).toThrow(AuthenticationError);
  });
});

describe("getRate / getRates / convert / getSupportedCurrencies — happy path", () => {
  it("getRate parses string rate to number", async () => {
    const c = client({ status: 200, body: { rate: "0.9234" } });
    expect(await c.getRate("USD", "EUR")).toBeCloseTo(0.9234, 6);
  });

  it("getRates parses all entries", async () => {
    const c = client({
      status: 200,
      body: { rates: { EUR: "0.92", GBP: "0.79", JPY: "150.5" } },
    });
    const rates = await c.getRates("USD");
    expect(rates.EUR).toBeCloseTo(0.92);
    expect(rates.GBP).toBeCloseTo(0.79);
    expect(rates.JPY).toBeCloseTo(150.5);
  });

  it("convert parses string result to number", async () => {
    const c = client({ status: 200, body: { result: "92.50" } });
    expect(await c.convert("USD", "EUR", 100)).toBeCloseTo(92.5);
  });

  it("getSupportedCurrencies returns the array", async () => {
    const c = client({ status: 200, body: { currencies: ["USD", "EUR", "GBP"] } });
    expect(await c.getSupportedCurrencies()).toEqual(["USD", "EUR", "GBP"]);
  });
});

describe("historical endpoints", () => {
  it("getHistoricalRate handles {rate} response", async () => {
    const c = client({ status: 200, body: { rate: "0.85" } });
    expect(await c.getHistoricalRate("2020-03-15", "USD", "EUR")).toBeCloseTo(0.85);
  });

  it("convertHistorical handles {result} response", async () => {
    const c = client({ status: 200, body: { result: "85.00" } });
    expect(
      await c.convertHistorical("2020-03-15", "USD", "EUR", 100),
    ).toBeCloseTo(85);
  });
});

describe("error mapping (table-driven)", () => {
  const cases: Array<{ status: number; ctor: new (...args: never[]) => Error }> = [
    { status: 400, ctor: InvalidRequestError },
    { status: 401, ctor: AuthenticationError },
    { status: 403, ctor: ProPlanRequiredError },
    { status: 404, ctor: InvalidCurrencyError },
    { status: 429, ctor: RateLimitError },
  ];
  for (const { status, ctor } of cases) {
    it(`HTTP ${status} → ${ctor.name}`, async () => {
      const c = client({ status, body: { error: "x" } });
      await expect(c.getRate("USD", "EUR")).rejects.toBeInstanceOf(ctor);
    });
  }

  it("HTTP 503 → APIError with status code preserved", async () => {
    const c = client({ status: 503, body: "down" });
    try {
      await c.getRate("USD", "EUR");
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(APIError);
      expect((err as APIError).statusCode).toBe(503);
    }
  });

  it("unknown HTTP status → generic APIError preserving status + body", async () => {
    const c = client({ status: 418, body: "i am a teapot" });
    try {
      await c.getRate("USD", "EUR");
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(APIError);
      expect((err as APIError).statusCode).toBe(418);
      expect((err as APIError).body).toContain("teapot");
    }
  });

  it("ProPlanRequiredError is the surface for Pro-gated 403s on historical", async () => {
    const c = client({ status: 403, body: { error: "Pro required" } });
    await expect(c.getHistoricalRate("2020-03-15", "USD", "EUR")).rejects.toBeInstanceOf(
      ProPlanRequiredError,
    );
  });
});
