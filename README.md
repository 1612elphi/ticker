# ticker

A receipt printer microservice for the Epson TM-T20II. Exposes a REST API and an MCP server so Claude (or anything else) can print receipts, images, and raw ESC/POS commands over the network.

## Quick Start

```bash
# with Docker
docker compose up -d

# or just bun
bun install
PRINTER_HOST=192.168.1.200 bun run src/index.ts
```

## Environment

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3420` | HTTP server port |
| `PRINTER_HOST` | `192.168.1.200` | Printer IP address |
| `PRINTER_PORT` | `9100` | Printer raw socket port |

## API

### `POST /print/receipt`

Print a structured receipt.

```json
{
  "title": "Order #42",
  "lines": ["1x Espresso", "---", "Total: $3.50"],
  "footer": "thank you!",
  "align": "center",
  "cut": true
}
```

Use `"---"` for a dashed line separator, `"==="` for a double line.

### `POST /print/raw`

Send raw ESC/POS binary data (`Content-Type: application/octet-stream`).

### `POST /print/image`

Print an image (auto-resized and dithered for thermal printing).

```json
{
  "url": "https://example.com/cat.jpg",
  "caption": "a nice cat",
  "cut": true
}
```

Or use `"base64": "..."` instead of `"url"`.

## MCP

Streamable HTTP endpoint at `/mcp` with three tools: `print_receipt`, `print_raw`, `print_image`.

```json
{
  "mcpServers": {
    "ticker": {
      "type": "streamable-http",
      "url": "http://your-server:3420/mcp"
    }
  }
}
```

## Notes

- Initializes with `ESC R 0` (USA charset) to fix tilde rendering on German-configured printers
- Images are Floyd-Steinberg dithered to 1-bit at 576px width (TM-T20II native resolution)
- Print jobs are queued serially to avoid interleaving
