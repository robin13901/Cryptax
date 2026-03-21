import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import { registerHealthRoutes } from './routes/health.js'

const app = new Hono()

app.use('*', logger())
app.use('/api/*', cors())

registerHealthRoutes(app)

serve({ fetch: app.fetch, port: 3001 }, () => {
  console.log('Backend server running on http://localhost:3001')
})
