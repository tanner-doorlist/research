import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { bearerAuth } from 'hono/bearer-auth'
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import { PORT, TEAM_TOKEN } from './config.js'
import { createMcpServer } from './mcp.js'
import { initSchema } from './db.js'
import { api } from './routes.js'

const app = new Hono()

// Init DB schema on startup (idempotent)
await initSchema()

// Require TEAM_TOKEN in production
if (!TEAM_TOKEN) {
  console.error('FATAL: TEAM_TOKEN is not set. Refusing to start without authentication.')
  console.error('Set the TEAM_TOKEN environment variable to enable bearer auth.')
  process.exit(1)
}

app.use('*', async (c, next) => {
  if (c.req.path === '/api/health') return next()
  return bearerAuth({ token: TEAM_TOKEN })(c, next)
})

// REST API
app.route('/api', api)

// MCP Streamable HTTP — stateless (one transport per request, as shown in SDK docs)
app.all('/mcp', async (c) => {
  const mcpServer = createMcpServer()
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  })
  await mcpServer.connect(transport)
  return transport.handleRequest(c.req.raw)
})

serve({ fetch: app.fetch, port: PORT }, (info) => {
  console.log(`knowledge-scribe server running on :${info.port}`)
  console.log(`  REST API: http://localhost:${info.port}/api`)
  console.log(`  MCP:      http://localhost:${info.port}/mcp`)
  console.log(`  Auth:     enabled`)
})
