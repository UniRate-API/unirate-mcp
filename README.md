# UniRate MCP Server

[![npm](https://img.shields.io/npm/v/@unirate/mcp.svg)](https://www.npmjs.com/package/@unirate/mcp)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

A [Model Context Protocol](https://modelcontextprotocol.io) server for the [UniRate API](https://unirateapi.com) — give Claude, Cursor, Continue, and any MCP-compatible AI assistant first-class access to currency conversion and exchange rates.

- 🔄 Real-time conversion between **170+ currencies** (fiat + major crypto)
- 📈 **Historical rates back to 1999** (Pro plan)
- 🆓 **Free tier**, no credit card required — get a key at [unirateapi.com](https://unirateapi.com)
- 🧩 Four tools, fully-typed inputs (Zod schemas), structured outputs
- ⚡ Pure Node 18+, single dependency on `@modelcontextprotocol/sdk`

## Why this exists

Most "currency for AI" workflows today involve hand-rolled fetch wrappers in custom tools, or generic HTTP MCP servers that hand the model raw JSON. This server gives models a tight, typed, currency-aware tool surface — they ask "what was 100 USD in EUR on 2020-03-15?" and get back a formatted answer plus a structured payload they can chain into other tool calls.

## Quick start

### 1. Install

```bash
npm install -g @unirate/mcp
```

Or run on demand with `npx @unirate/mcp` (no install).

### 2. Get a UniRate API key

Free tier covers `convert`, `latest_rate`, and `list_currencies`. Sign up at [unirateapi.com](https://unirateapi.com) — no credit card required.

### 3. Wire it into your MCP client

#### Claude Desktop

Edit `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "unirate": {
      "command": "npx",
      "args": ["-y", "@unirate/mcp"],
      "env": {
        "UNIRATE_API_KEY": "your-api-key-here"
      }
    }
  }
}
```

Restart Claude Desktop. The four UniRate tools will appear in the tool picker.

#### Cursor / Continue / Cline

Add to your MCP config (`.cursor/mcp.json`, `~/.continue/config.json`, etc.):

```json
{
  "mcpServers": {
    "unirate": {
      "command": "npx",
      "args": ["-y", "@unirate/mcp"],
      "env": { "UNIRATE_API_KEY": "your-api-key-here" }
    }
  }
}
```

#### From source

```bash
git clone https://github.com/UniRate-API/unirate-mcp.git
cd unirate-mcp
npm install && npm run build
UNIRATE_API_KEY=your-key node dist/index.js
```

## Tools

### `convert`

Convert an amount from one currency to another at the latest rate.

| Param   | Type     | Required | Notes                          |
|---------|----------|----------|--------------------------------|
| `from`  | string   | yes      | ISO 4217 code (e.g. `USD`)     |
| `to`    | string   | yes      | ISO 4217 code (e.g. `EUR`)     |
| `amount`| number   | yes      | Positive amount in `from`      |

**Example call:**

```json
{ "name": "convert", "arguments": { "from": "USD", "to": "EUR", "amount": 100 } }
```

**Response:** human-readable text plus structured `{ from, to, amount, result }`.

### `latest_rate`

Get current exchange rate(s).

| Param  | Type   | Required | Notes                                            |
|--------|--------|----------|--------------------------------------------------|
| `from` | string | yes      | Base currency                                    |
| `to`   | string | no       | Target. **Omit** to get rates for all currencies |

### `historical_rate` *(Pro plan)*

Get the exchange rate that was in effect on a specific date. Coverage back to **1999-01-04** for major fiat pairs.

| Param   | Type   | Required | Notes                              |
|---------|--------|----------|------------------------------------|
| `date`  | string | yes      | `YYYY-MM-DD` (e.g. `2020-03-15`)   |
| `from`  | string | yes      | Source currency                    |
| `to`    | string | yes      | Target currency                    |
| `amount`| number | no       | Defaults to 1                      |

> Free-tier keys receive a clear error pointing to [unirateapi.com](https://unirateapi.com) for upgrade.

### `list_currencies`

Returns the array of supported currency codes (170+) with no parameters. Useful for autocomplete or validating user-supplied codes.

## Errors

All UniRate API failures are mapped to friendly tool errors:

| HTTP | Error class            | What the model sees                                   |
|------|------------------------|-------------------------------------------------------|
| 400  | `InvalidRequestError`  | "Invalid request parameters"                          |
| 401  | `AuthenticationError`  | "Missing or invalid API key"                          |
| 403  | `ProPlanRequiredError` | "…requires Pro… upgrade at https://unirateapi.com"    |
| 404  | `InvalidCurrencyError` | "Currency not found or no data available"             |
| 429  | `RateLimitError`       | "Rate limit exceeded"                                 |
| 503  | `APIError`             | "Service unavailable"                                 |

Network/timeout errors are wrapped in `UnirateError`. Tool calls always return a response object with `isError: true` rather than throwing protocol-level errors, so the model can recover gracefully.

## Development

```bash
npm install
npm run build       # compile TypeScript to dist/
npm test            # 24 mock tests
UNIRATE_LIVE=1 UNIRATE_API_KEY=... npm run test:live  # +4 live free-tier tests
```

## Related projects

UniRate offers official client libraries in 9 languages:

- [Python](https://github.com/UniRate-API/unirate-api-python) (`pip install unirate-api`)
- [Node.js](https://github.com/UniRate-API/unirate-api-nodejs) (`npm install unirate-api`)
- [Swift](https://github.com/UniRate-API/unirate-api-swift)
- [Java](https://github.com/UniRate-API/unirate-api-java)
- [Go](https://github.com/UniRate-API/unirate-api-go)
- [Rust](https://github.com/UniRate-API/unirate-api-rust)
- [Ruby](https://github.com/UniRate-API/unirate-api-ruby)
- [PHP](https://github.com/UniRate-API/unirate-api-php)
- [.NET](https://github.com/UniRate-API/unirate-api-dotnet)

Plus an [n8n community node](https://github.com/UniRate-API/n8n-nodes-unirate).

## License

MIT — see [LICENSE](LICENSE).
