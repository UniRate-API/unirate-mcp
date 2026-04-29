#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  ProPlanRequiredError,
  UnirateClient,
  UnirateError,
} from "./client.js";

const VERSION = "0.1.0";

function formatError(err: unknown): string {
  if (err instanceof ProPlanRequiredError) {
    return `${err.message}. Free-tier API keys can use 'convert', 'latest_rate', and 'list_currencies'; historical rates require an upgrade at https://unirateapi.com.`;
  }
  if (err instanceof UnirateError) return err.message;
  if (err instanceof Error) return err.message;
  return String(err);
}

type ToolResult = {
  content: Array<{ type: "text"; text: string }>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
};

function ok(text: string, structured?: Record<string, unknown>): ToolResult {
  const out: ToolResult = { content: [{ type: "text", text }] };
  if (structured !== undefined) out.structuredContent = structured;
  return out;
}

function fail(err: unknown): ToolResult {
  return {
    isError: true,
    content: [{ type: "text", text: formatError(err) }],
  };
}

export function buildServer(client: UnirateClient): McpServer {
  const server = new McpServer({ name: "unirate-mcp", version: VERSION });

  server.registerTool(
    "convert",
    {
      title: "Convert currency",
      description:
        "Convert an amount from one currency to another using the latest exchange rate. " +
        "Codes are ISO 4217 (e.g. USD, EUR, GBP). Supports 170+ fiat currencies and major cryptocurrencies.",
      inputSchema: {
        from: z.string().min(3).max(10).describe("Source currency code, e.g. 'USD'"),
        to: z.string().min(3).max(10).describe("Target currency code, e.g. 'EUR'"),
        amount: z.number().positive().describe("Amount in the source currency"),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ from, to, amount }) => {
      try {
        const result = await client.convert(from, to, amount);
        return ok(
          `${amount} ${from.toUpperCase()} = ${result} ${to.toUpperCase()}`,
          { from: from.toUpperCase(), to: to.toUpperCase(), amount, result },
        );
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    "latest_rate",
    {
      title: "Get latest exchange rate(s)",
      description:
        "Fetch the latest exchange rate for a base currency. If 'to' is provided, returns a single rate; " +
        "otherwise returns rates for all supported currencies relative to the base.",
      inputSchema: {
        from: z.string().min(3).max(10).describe("Base currency code, e.g. 'USD'"),
        to: z
          .string()
          .min(3)
          .max(10)
          .optional()
          .describe("Optional target currency. Omit to get rates for all currencies."),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ from, to }) => {
      try {
        if (to) {
          const rate = await client.getRate(from, to);
          return ok(
            `1 ${from.toUpperCase()} = ${rate} ${to.toUpperCase()}`,
            { from: from.toUpperCase(), to: to.toUpperCase(), rate },
          );
        }
        const rates = await client.getRates(from);
        const preview = Object.entries(rates)
          .slice(0, 10)
          .map(([k, v]) => `${k}: ${v}`)
          .join(", ");
        const total = Object.keys(rates).length;
        return ok(
          `${total} rates for base ${from.toUpperCase()}. First 10: ${preview}.`,
          { base: from.toUpperCase(), rates },
        );
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    "historical_rate",
    {
      title: "Get historical exchange rate (Pro plan required)",
      description:
        "Fetch the exchange rate that was in effect on a specific date. Date format YYYY-MM-DD. " +
        "Coverage goes back to 1999-01-04 for major fiat pairs. **Requires UniRate Pro** — " +
        "free-tier keys will receive a clear upgrade-required error.",
      inputSchema: {
        date: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD")
          .describe("Date in YYYY-MM-DD format, e.g. '2020-03-15'"),
        from: z.string().min(3).max(10).describe("Source currency code"),
        to: z.string().min(3).max(10).describe("Target currency code"),
        amount: z
          .number()
          .positive()
          .optional()
          .describe("Optional amount to convert at the historical rate. Defaults to 1."),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ date, from, to, amount }) => {
      try {
        if (amount !== undefined && amount !== 1) {
          const result = await client.convertHistorical(date, from, to, amount);
          return ok(
            `On ${date}, ${amount} ${from.toUpperCase()} = ${result} ${to.toUpperCase()}`,
            { date, from: from.toUpperCase(), to: to.toUpperCase(), amount, result },
          );
        }
        const rate = await client.getHistoricalRate(date, from, to);
        return ok(
          `On ${date}, 1 ${from.toUpperCase()} = ${rate} ${to.toUpperCase()}`,
          { date, from: from.toUpperCase(), to: to.toUpperCase(), rate },
        );
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    "list_currencies",
    {
      title: "List supported currencies",
      description:
        "Return the list of currency codes supported by the UniRate API (170+ fiat plus major crypto).",
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async () => {
      try {
        const currencies = await client.getSupportedCurrencies();
        return ok(
          `${currencies.length} currencies supported: ${currencies.join(", ")}`,
          { count: currencies.length, currencies },
        );
      } catch (err) {
        return fail(err);
      }
    },
  );

  return server;
}

async function main(): Promise<void> {
  const apiKey = process.env.UNIRATE_API_KEY;
  if (!apiKey) {
    process.stderr.write(
      "ERROR: UNIRATE_API_KEY environment variable is required.\n" +
        "Get a free key at https://unirateapi.com and pass it as UNIRATE_API_KEY.\n",
    );
    process.exit(1);
  }

  const client = new UnirateClient({ apiKey });
  const server = buildServer(client);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

const isEntryPoint =
  import.meta.url === `file://${process.argv[1]}` ||
  import.meta.url.endsWith(process.argv[1] ?? "");

if (isEntryPoint) {
  main().catch((err) => {
    process.stderr.write(`Fatal: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  });
}
