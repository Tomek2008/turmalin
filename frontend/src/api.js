const API_ROOT = (import.meta.env.VITE_API_BASE || '/api').replace(/\/$/, '')

/** Absolute path from backend (`reverse`) or relative to API_ROOT. */
function resolveUrl(path) {
  if (!path) throw new Error('Brak ścieżki API')
  if (/^https?:\/\//i.test(path) || path.startsWith('/')) return path
  return `${API_ROOT}/${path.replace(/^\//, '')}`
}

async function request(path, options) {
  const res = await fetch(resolveUrl(path), options)
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.error || `API ${res.status}`)
  }
  return res.json()
}

export function fetchFactories() {
  return request(`${API_ROOT}/factories/`)
}

/** Nowy zakład z CSV (multipart). */
export async function createFactory({ name, address, description, slug, lat, lng, csvFile, imageFile }) {
  const body = new FormData()
  body.append('name', name)
  if (address) body.append('address', address)
  if (description) body.append('description', description)
  if (slug) body.append('slug', slug)
  if (lat !== '' && lat != null) body.append('lat', String(lat))
  if (lng !== '' && lng != null) body.append('lng', String(lng))
  body.append('csv_file', csvFile)
  if (imageFile) body.append('image', imageFile)

  const res = await fetch(resolveUrl(`${API_ROOT}/factories/`), {
    method: 'POST',
    body,
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error(data.error || `API ${res.status}`)
  }
  return data
}

export function fetchFactory(factoryIdOrFactory) {
  if (typeof factoryIdOrFactory === 'object' && factoryIdOrFactory?.api?.self) {
    return request(factoryIdOrFactory.api.self)
  }
  return request(`${API_ROOT}/factories/${factoryIdOrFactory}/`)
}

/** Widma zakładu z GET /factories/{id}/ + etykiety z /predict/. */
export async function fetchTelemetry(factoryIdOrFactory) {
  const detail = await fetchFactory(factoryIdOrFactory)
  return enrichWithPredictions({
    factory_id: detail.factory_id || detail.id,
    factory_name: detail.factory_name || detail.name,
    status_key: detail.status_key,
    engines: detail.engines || [],
    api: detail.api,
    generated_at: detail.generated_at,
    source: detail.source || 'train',
  })
}

/** Predykcja etykiety z widma (POST …/predict/). */
export function predictLabel(payload, predictUrl) {
  const path = predictUrl || `${API_ROOT}/predict/`
  return request(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
}

function spectrumPayload(row) {
  return Array.from({ length: 21 }, (_, i) => {
    const v = row[`mV_${i}`]
    if (v == null || v === '') return null
    const n = Number(v)
    return Number.isFinite(n) ? n : null
  })
}

function roundBin(v) {
  if (v == null || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null
}

function medianSpectrum(cylinders) {
  return Array.from({ length: 21 }, (_, f) => {
    const vals = cylinders.map(c => c[`mV_${f}`]).filter(v => v != null).sort((a, b) => a - b)
    if (!vals.length) return null
    return vals[Math.floor(vals.length / 2)]
  })
}

function bandFromHighlights(highlights) {
  const freqs = (highlights || []).map(Number).filter(n => Number.isFinite(n))
  if (!freqs.length) return [0, 0]
  return [Math.max(0, Math.min(...freqs)), Math.min(20, Math.max(...freqs))]
}

function buildExplain(p, cyl) {
  const band = bandFromHighlights(p.highlight_khz)
  const [b0, b1] = band
  const lines = (p.decision || []).filter(line => !/Werdykt:/i.test(String(line)))
  const text = lines.length
    ? `Cylinder ${cyl}: ${lines.join(' ')}`
    : `Cylinder ${cyl}: ${p.label}.`
  return {
    anomaly_band: [b0, b1],
    ratio_vs_median: null,
    text,
    rule: lines[0] || '',
  }
}

async function enrichWithPredictions(data) {
  const engines = data.engines || []
  const items = []
  for (const eng of engines) {
    for (const c of eng.cylinders || []) {
      items.push({
        spectrum: spectrumPayload(c),
        engine_id: c.engine_id,
        cylinder: c.cylinder,
        n_cylinders: c.n_cylinders,
      })
    }
  }
  if (!items.length) return data

  let predictions = []
  try {
    const body = await predictLabel({ items }, data.api?.predict)
    predictions = body.predictions || []
  } catch {
    predictions = items.map(it => ({
      engine_id: it.engine_id,
      cylinder: it.cylinder,
      label: 'ok',
      severity: 'nie_dotyczy',
    }))
  }

  const byKey = Object.fromEntries(
    predictions.map(p => [`${p.engine_id}:${p.cylinder}`, p]),
  )

  const enrichedEngines = engines.map(eng => {
    const cylinders = (eng.cylinders || []).map(c => {
      const p = byKey[`${c.engine_id}:${c.cylinder}`] || {
        label: 'ok',
        severity: 'nie_dotyczy',
      }
      const bins = Object.fromEntries(
        Array.from({ length: 21 }, (_, i) => [`mV_${i}`, roundBin(c[`mV_${i}`])]),
      )
      return {
        engine_id: c.engine_id,
        cylinder: c.cylinder,
        n_cylinders: c.n_cylinders,
        ...bins,
        label: p.label,
        severity: p.severity,
        decision: p.decision || [],
        highlight_khz: p.highlight_khz || [],
        amplituda_mV: p.amplituda_mV,
        istotnosc_sigma: p.istotnosc_sigma,
        chi_dopasowania: p.chi_dopasowania,
        szablon: p.szablon,
        profile_mV: p.profile_mV || null,
        residual_mV: p.residual_mV || null,
        fitted_fault_mV: p.fitted_fault_mV || null,
      }
    })

    const fromProfile = cylinders.find(c => Array.isArray(c.profile_mV) && c.profile_mV.some(v => v != null))
    const healthy = cylinders.filter(c => c.label === 'ok')
    const medianArr = fromProfile
      ? fromProfile.profile_mV.map(v => roundBin(v))
      : medianSpectrum(healthy.length ? healthy : cylinders)
    const healthyMedian = Object.fromEntries(
      medianArr.map((v, i) => [`mV_${i}`, roundBin(v)]),
    )

    const withExplain = cylinders.map(c => ({
      ...c,
      explanation: buildExplain(c, c.cylinder),
    }))

    return {
      ...eng,
      cylinders: withExplain,
      healthy_median: healthyMedian,
    }
  })

  return { ...data, engines: enrichedEngines }
}
