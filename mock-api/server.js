import cors from 'cors'
import express from 'express'
import { FACTORIES, getFactory } from './data/factories.js'
import { buildFactoryListItem, buildTelemetry, warmCache } from './telemetry.js'

const PORT = process.env.PORT || 3001
const app = express()

app.use(cors())
app.use(express.json())

warmCache(FACTORIES)
console.log(`Cache: ${FACTORIES.length} zakładów pre-kalkulowanych`)

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', service: 'turmalin-mock-api' })
})

app.get('/api/factories/', (_req, res) => {
  res.json(FACTORIES.map(buildFactoryListItem))
})

app.get('/api/factories/:factoryId/', (req, res) => {
  const factory = getFactory(req.params.factoryId)
  if (!factory) {
    res.status(404).json({ error: 'Nie znaleziono zakładu' })
    return
  }
  res.json(buildFactoryListItem(factory))
})

app.get('/api/factories/:factoryId/telemetry/', (req, res) => {
  const factory = getFactory(req.params.factoryId)
  if (!factory) {
    res.status(404).json({ error: 'Nie znaleziono zakładu' })
    return
  }
  res.json(buildTelemetry(factory))
})

app.listen(PORT, () => {
  console.log(`Turmalin mock API → http://localhost:${PORT}/api`)
})
