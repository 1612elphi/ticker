// ticker — receipt printer service

import { Hono } from 'hono';
import { api } from './api.ts';
import { handleMcp } from './mcp.ts';

const app = new Hono();

// REST API
app.route('/', api);

// MCP Streamable HTTP transport
app.all('/mcp', (c) => handleMcp(c));

const port = parseInt(process.env.PORT ?? '3420', 10);

console.log(`ticker listening on :${port}`);
console.log(`  REST: http://localhost:${port}/print/{receipt,raw,image}`);
console.log(`  MCP:  http://localhost:${port}/mcp`);
console.log(`  Printer: ${process.env.PRINTER_HOST ?? '192.168.1.200'}:${process.env.PRINTER_PORT ?? '9100'}`);

export default {
  port,
  fetch: app.fetch,
};
