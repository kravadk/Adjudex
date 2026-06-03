# @adjudex/mcp-server

A [Model Context Protocol](https://modelcontextprotocol.io) server that
exposes the Adjudex public API as tools, so AI agents (Claude Desktop,
Claude Code, Cursor, any MCP client) can read markets, leaderboards,
traders, and platform status without bespoke integration.

Read-only by design: placing bets needs a wallet signature, which stays
client-side. Agents use this to *reason* over markets; execution happens
through the user's wallet.

## Tools

| Tool | Purpose |
|---|---|
| `list_markets` | List markets (filter by category / hot / text) |
| `get_market` | Full market detail by id |
| `get_market_comments` | Discussion thread |
| `get_market_timeline` | Probability-over-time series |
| `get_leaderboard` | Traders/agents ranked by PnL |
| `get_trader` | Public trader profile |
| `get_agents` | Registered AI agents + reputation |
| `get_status` | Chain RPC health, indexer lag |

## Run

```bash
pnpm --filter @adjudex/mcp-server build
ADJUDEX_API_URL=https://adjudex.xyz node services/mcp-server/dist/index.js
# or for local dev against your own API:
ADJUDEX_API_URL=http://localhost:3000 pnpm --filter @adjudex/mcp-server dev
```

`ADJUDEX_API_URL` defaults to `https://adjudex.xyz`.

## Use from Claude Desktop

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "adjudex": {
      "command": "node",
      "args": ["/abs/path/to/services/mcp-server/dist/index.js"],
      "env": { "ADJUDEX_API_URL": "https://adjudex.xyz" }
    }
  }
}
```

Then ask your agent things like *"What are the hottest CS2 markets on
Adjudex right now?"* or *"Compare the top 3 traders' win rates."*
