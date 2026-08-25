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
export async function createFactory({ name, address, description, slug, csvFile, imageFile }) {
  const body = new FormData()
  body.append('name', name)
  if (address) body.append('address', address)
  if (description) body.append('description', description)
  if (slug) body.append('slug', slug)
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

function interpolateSpectrum(row) {
  const out = Array.from({ length: 21 }, (_, i) => {
    const v = row[`mV_${i}`]
    if (v == null || v === '') return null
    const n = Number(v)
    return Number.isFinite(n) ? n : null
  })
  let i = 0
  while (i < 21) {
    if (out[i] != null) {
      i += 1
      continue
    }
    const start = i - 1
    let j = i
    while (j < 21 && out[j] == null) j += 1
    const left = start >= 0 ? out[start] : null
    const right = j < 21 ? out[j] : null
    const gap = j - start - 1
    if (gap > 0) {
      if (left != null && right != null) {
        for (let k = 1; k <= gap; k++) out[start + k] = left + ((right - left) * k) / (gap + 1)
      } else if (left != null) {
        for (let k = 1; k <= gap; k++) out[start + k] = left
      } else if (right != null) {
        for (let k = 1; k <= gap; k++) out[start + k] = right
      } else {
        for (let k = 1; k <= gap; k++) out[start + k] = 10
      }
    }
    i = j
  }
  return out.map(v => (v == null ? 10 : v))
}

function medianSpectrum(cylinders) {
  return Array.from({ length: 21 }, (_, f) => {
    const vals = cylinders.map(c => c[`mV_${f}`]).filter(v => v != null).sort((a, b) => a - b)
    if (!vals.length) return 10
    return vals[Math.floor(vals.length / 2)]
  })
}

function anomalyBandFromPeak(spectrum, healthyMedian) {
  const ratios = spectrum.map((val, f) => {
    const med = healthyMedian[f]
    return [f, med > 0.5 ? val / med : 1]
  })
  ratios.sort((a, b) => b[1] - a[1])
  const peak = ratios[0][0]
  return [Math.max(0, peak - 2), Math.min(20, peak + 3)]
}

/** Pasmo z cech drzewa (residual_k / dip_18), nie z peak ratio. */
function anomalyBandFromPath(decisionPath, spectrum, healthyMedian) {
  const freqs = []
  for (const step of decisionPath || []) {
    const feat = step.feature || ''
    const mRes = /^residual_(\d+)$/.exec(feat)
    if (mRes) {
      freqs.push(Number(mRes[1]))
      continue
    }
    if (feat === 'dip_18') freqs.push(17, 18, 19)
  }
  if (!freqs.length) return anomalyBandFromPeak(spectrum, healthyMedian)
  const lo = Math.min(...freqs)
  const hi = Math.max(...freqs)
  return [Math.max(0, lo - 1), Math.min(20, hi + 1)]
}

function buildExplain(label, severity, cyl, spectrum, healthyMedian, band, decisionPath) {
  const [b0, b1] = band
  const bandVals = spectrum.slice(b0, b1 + 1)
  const medVals = healthyMedian.slice(b0, b1 + 1)
  const amp = bandVals.reduce((s, v) => s + v, 0) / Math.max(bandVals.length, 1)
  const med = medVals.reduce((s, v) => s + v, 0) / Math.max(medVals.length, 1)
  const ratio = med > 0.1 ? Math.round((amp / med) * 10) / 10 : 1

  const pathFreqs = (decisionPath || [])
    .map(s => {
      const m = /^residual_(\d+)$/.exec(s.feature || '')
      return m ? Number(m[1]) : s.feature === 'dip_18' ? 18 : null
    })
    .filter(f => f != null)
  const keyFreq =
    pathFreqs.length > 0 ? [...new Set(pathFreqs)].sort((a, b) => a - b).join(', ') : null

  const bandTxt = b0 === b1 ? `${b0} kHz` : `${b0}–${b1} kHz`
  const reasons = {
    zakoksowany: keyFreq
      ? `drzewo: odchyłka w paśmie ${keyFreq} kHz (zakoksowany)`
      : `podwyższona energia w paśmie ${bandTxt}`,
    lejacy: keyFreq
      ? `drzewo: odchyłka / podobieństwo — pasmo ${keyFreq} kHz (lejący)`
      : `płaskie podwyższenie widma w paśmie ${bandTxt}`,
    pompa: keyFreq
      ? `drzewo: odchyłka w paśmie ${keyFreq} kHz (pompa)`
      : `lokalny spike w paśmie ${bandTxt}`,
    iglica: keyFreq
      ? `drzewo: odchyłka w paśmie ${keyFreq} kHz (iglica)`
      : `ostry pik w paśmie ${bandTxt}`,
    unknown: keyFreq
      ? `drzewo: nietypowy kształt — pasmo ${keyFreq} kHz`
      : `nietypowy kształt widma w paśmie ${bandTxt}`,
    ok: 'widmo zgodne z medianą zdrowych cylindrów jednostki',
  }
  const reason = reasons[label] || reasons.unknown
  const sevPl = { male: 'małe', srednie: 'średnie', duze: 'duże', nie_dotyczy: 'nie dotyczy' }
  const sevTxt = sevPl[severity] || severity
  const text =
    label === 'ok'
      ? `Cylinder ${cyl}: ok - ${reason}.`
      : `Cylinder ${cyl}: ${label} / ${sevTxt} - ${reason}; amplituda w ${bandTxt} ok. ${ratio}× vs mediana OK.`

  return {
    anomaly_band: [b0, b1],
    ratio_vs_median: ratio,
    text,
    rule: reason,
  }
}

async function enrichWithPredictions(data) {
  const engines = data.engines || []
  const items = []
  for (const eng of engines) {
    for (const c of eng.cylinders || []) {
      items.push({
        spectrum: interpolateSpectrum(c),
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
      const spectrum = interpolateSpectrum(c)
      const p = byKey[`${c.engine_id}:${c.cylinder}`] || {
        label: 'ok',
        severity: 'nie_dotyczy',
      }
      const filled = Object.fromEntries(
        spectrum.map((v, i) => [`mV_${i}`, Math.round(v * 100) / 100]),
      )
      return {
        engine_id: c.engine_id,
        cylinder: c.cylinder,
        n_cylinders: c.n_cylinders,
        ...filled,
        label: p.label,
        severity: p.severity,
        decision_path: p.decision_path || [],
        features: p.features || null,
      }
    })

    // Mediana zdrowych cylindrów — zawsze per silnik (po etykietach z predict)
    const healthy = cylinders.filter(c => c.label === 'ok')
    const medianArr = medianSpectrum(healthy.length ? healthy : cylinders)
    const healthyMedian = Object.fromEntries(
      medianArr.map((v, i) => [`mV_${i}`, Math.round(v * 100) / 100]),
    )

    const withExplain = cylinders.map(c => {
      const spectrum = Array.from({ length: 21 }, (_, i) => c[`mV_${i}`])
      const band =
        c.label !== 'ok'
          ? anomalyBandFromPath(c.decision_path, spectrum, medianArr)
          : null
      return {
        ...c,
        explanation: buildExplain(
          c.label,
          c.severity,
          c.cylinder,
          spectrum,
          medianArr,
          band || [0, 0],
          c.decision_path,
        ),
      }
    })

    return {
      ...eng,
      cylinders: withExplain,
      healthy_median: healthyMedian,
    }
  })

  return { ...data, engines: enrichedEngines }
}
