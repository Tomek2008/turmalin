const LABEL_OK = 'ok'
const SEVERITY_NA = 'nie_dotyczy'
const SEVERITY_ORDER = { duze: 0, srednie: 1, male: 2, nie_dotyczy: 3 }
const STATUS_MAP = { ok: 'Sprawny', uwaga: 'Uwaga', alarm: 'Alarm' }

const MOCK_LABEL_WEIGHTS = [
  ['ok', 0.72],
  ['zakoksowany', 0.08],
  ['lejacy', 0.06],
  ['pompa', 0.04],
  ['iglica', 0.05],
  ['unknown', 0.05],
]
const MOCK_SEVERITY_WEIGHTS = [
  ['male', 0.4],
  ['srednie', 0.4],
  ['duze', 0.2],
]

const API_ROOT = (process.env.API_BASE || '/api').replace(/\/$/, '')

export function apiLinks(slug) {
  return {
    self: `${API_ROOT}/factories/${slug}/`,
    telemetry: `${API_ROOT}/factories/${slug}/telemetry/`,
    list: `${API_ROOT}/factories/`,
    predict: `${API_ROOT}/predict/`,
  }
}

function seededNoise(engineId, cyl, freq, lo = 7.0, hi = 13.5) {
  const key = `${engineId}:${cyl}:${freq}:0xAE57`
  let h = 0xae57
  for (let i = 0; i < key.length; i++) {
    h = (Math.imul(31, h) + key.charCodeAt(i)) >>> 0
  }
  const t = (h % 10000) / 10000
  return lo + t * (hi - lo)
}

function spectrumOk(engineId, cyl) {
  return Array.from({ length: 21 }, (_, f) => seededNoise(engineId, cyl, f))
}

function weightedChoice(pairs) {
  const r = Math.random()
  let acc = 0
  for (const [value, w] of pairs) {
    acc += w
    if (r <= acc) return value
  }
  return pairs[pairs.length - 1][0]
}

/** Losowa etykieta jak Django api/model.py predict(). */
function predictRandom() {
  const label = weightedChoice(MOCK_LABEL_WEIGHTS)
  if (label === 'ok' || label === 'unknown') return [label, SEVERITY_NA]
  return [label, weightedChoice(MOCK_SEVERITY_WEIGHTS)]
}

function explain(label, severity, cyl, spectrum, healthyMedian, band) {
  const [b0, b1] = band
  const bandVals = spectrum.slice(b0, b1 + 1)
  const medVals = healthyMedian.slice(b0, b1 + 1)
  const amp = bandVals.reduce((a, b) => a + b, 0) / Math.max(bandVals.length, 1)
  const med = medVals.reduce((a, b) => a + b, 0) / Math.max(medVals.length, 1)
  const ratio = med > 0.1 ? Math.round((amp / med) * 10) / 10 : 1.0

  const reasons = {
    zakoksowany: `podwyższona energia w niskim paśmie ${b0}-${b1} kHz`,
    lejacy: `płaskie podwyższenie widma w paśmie ${b0}-${b1} kHz`,
    pompa: `lokalny spike w paśmie środkowym ${b0}-${b1} kHz`,
    iglica: `ostry pik w paśmie ${b0}-${b1} kHz`,
    unknown: `nietypowy kształt widma w paśmie ${b0}-${b1} kHz`,
    ok: 'widmo zgodne z medianą zdrowych cylindrów jednostki',
  }
  const reason = reasons[label] ?? reasons.unknown
  const sevPl = { male: 'małe', srednie: 'średnie', duze: 'duże', nie_dotyczy: 'nie dotyczy' }
  const sevTxt = sevPl[severity] ?? severity

  const text =
    label === LABEL_OK
      ? `Cylinder ${cyl}: ok - ${reason}.`
      : `Cylinder ${cyl}: ${label} / ${sevTxt} - ${reason}; amplituda w ${b0}-${b1} kHz ok. ${ratio}× wyższa niż mediana OK w jednostce.`

  return { anomaly_band: [b0, b1], ratio_vs_median: ratio, text, rule: reason }
}

function anomalyBand(spectrum, healthyMedian) {
  const ratios = spectrum.map((val, f) => {
    const med = healthyMedian[f]
    return [f, med > 0.5 ? val / med : 1.0]
  })
  ratios.sort((a, b) => b[1] - a[1])
  const peak = ratios[0][0]
  return [Math.max(0, peak - 2), Math.min(20, peak + 3)]
}

function buildCylinder(engineId, cyl, nCylinders, label, severity, healthyMedianRef = null) {
  const spectrum = spectrumOk(engineId, cyl)
  const healthy = healthyMedianRef ?? spectrum
  const band = label !== LABEL_OK ? anomalyBand(spectrum, healthy) : [0, 5]
  const explanation = explain(label, severity, cyl, spectrum, healthy, band)

  const row = {
    engine_id: engineId,
    cylinder: cyl,
    n_cylinders: nCylinders,
    label,
    severity,
    explanation,
  }
  for (let f = 0; f < 21; f++) row[`mV_${f}`] = Math.round(spectrum[f] * 100) / 100
  return row
}

function medianSpectrum(cylinders) {
  const med = []
  for (let f = 0; f < 21; f++) {
    const vals = cylinders.map(c => c[`mV_${f}`]).sort((a, b) => a - b)
    med.push(vals[Math.floor(vals.length / 2)] ?? 10.0)
  }
  return med
}

function engineStatusFromCylinders(cylinders) {
  const bad = cylinders.filter(c => c.label !== LABEL_OK)
  const n = bad.length
  const worst = n === 0 ? 9 : Math.min(...bad.map(c => SEVERITY_ORDER[c.severity] ?? 9))
  if (n === 0) return ['Sprawny', '#5c9a72', 0]
  if (worst === 0) return [`${n}/${cylinders.length} cylindrów - interwencja`, '#c44d4d', n]
  if (worst === 1) return [`${n}/${cylinders.length} cylindrów - uwagi`, '#c4843a', n]
  return [`${n}/${cylinders.length} cylindrów - monitoring`, '#a89040', n]
}

/** Lekki podgląd silnika - bez widm (tylko lista zakładów). */
function buildEngineSummary(spec) {
  const { engine_id: engineId, n_cylinders: n } = spec
  let intervention = 0
  let worst = 9
  for (let cyl = 1; cyl <= n; cyl++) {
    const [label, severity] = predictRandom()
    if (label !== LABEL_OK) {
      intervention++
      worst = Math.min(worst, SEVERITY_ORDER[severity] ?? 9)
    }
  }
  const [status, statusColor] =
    intervention === 0
      ? ['Sprawny', '#5c9a72']
      : worst === 0
        ? [`${intervention}/${n} cylindrów - interwencja`, '#c44d4d']
        : worst === 1
          ? [`${intervention}/${n} cylindrów - uwagi`, '#c4843a']
          : [`${intervention}/${n} cylindrów - monitoring`, '#a89040']
  return { engine_id: engineId, intervention_count: intervention, status_color: statusColor, status }
}

export function buildEngine(spec) {
  const { engine_id: engineId, n_cylinders: n } = spec

  const preds = []
  const raw = []
  for (let cyl = 1; cyl <= n; cyl++) {
    const [label, severity] = predictRandom()
    preds.push([label, severity])
    raw.push(buildCylinder(engineId, cyl, n, label, severity))
  }

  const healthy = raw.filter(c => c.label === LABEL_OK)
  const median = medianSpectrum(healthy.length ? healthy : raw)

  const cylinders = []
  for (let cyl = 1; cyl <= n; cyl++) {
    const [label, severity] = preds[cyl - 1]
    const c = buildCylinder(engineId, cyl, n, label, severity, median)
    c.healthy_median = Object.fromEntries(
      Array.from({ length: 21 }, (_, f) => [`mV_${f}`, Math.round(median[f] * 100) / 100]),
    )
    cylinders.push(c)
  }

  cylinders.sort((a, b) => {
    const sa = SEVERITY_ORDER[a.severity] ?? 9
    const sb = SEVERITY_ORDER[b.severity] ?? 9
    if (sa !== sb) return sa - sb
    const la = a.label !== LABEL_OK ? 0 : 1
    const lb = b.label !== LABEL_OK ? 0 : 1
    if (la !== lb) return la - lb
    return a.cylinder - b.cylinder
  })

  const [status, statusColor, intervention] = engineStatusFromCylinders(cylinders)
  return {
    engine_id: engineId,
    n_cylinders: n,
    layout: `V${n}`,
    status,
    status_color: statusColor,
    intervention_count: intervention,
    healthy_median: Object.fromEntries(
      Array.from({ length: 21 }, (_, f) => [`mV_${f}`, Math.round(median[f] * 100) / 100]),
    ),
    cylinders,
  }
}

function factoryWorstStatusFromSummaries(summaries) {
  if (!summaries.length) return ['ok', 0]
  const counts = summaries.reduce((s, e) => s + e.intervention_count, 0)
  const colors = summaries.map(e => e.status_color)
  if (colors.includes('#c44d4d')) return ['alarm', counts]
  if (colors.includes('#c4843a') || colors.includes('#a89040')) return ['uwaga', counts]
  return ['ok', counts]
}

function factoryWorstStatus(engines) {
  if (!engines.length) return ['ok', 0]
  const counts = engines.reduce((s, e) => s + e.intervention_count, 0)
  const colors = engines.map(e => e.status_color)
  if (colors.includes('#c44d4d')) return ['alarm', counts]
  if (colors.includes('#c4843a') || colors.includes('#a89040')) return ['uwaga', counts]
  return ['ok', counts]
}

const listCache = new Map()
const telemetryCache = new Map()

export function buildFactoryListItem(factory) {
  if (listCache.has(factory.slug)) return listCache.get(factory.slug)

  const summaries = factory.engines.map(buildEngineSummary)
  const [statusKey, anomalyCount] = factoryWorstStatusFromSummaries(summaries)
  const item = {
    id: factory.slug,
    name: factory.name,
    lat: factory.lat,
    lng: factory.lng,
    type: factory.facility_type,
    address: factory.address,
    description: factory.description,
    ae_focus: factory.ae_focus,
    contact: null,
    image: factory.image,
    notes: factory.notes,
    status: STATUS_MAP[statusKey],
    status_key: statusKey,
    anomaly_count: anomalyCount,
    engine_count: summaries.length,
    api: apiLinks(factory.slug),
  }
  listCache.set(factory.slug, item)
  return item
}

export function buildTelemetry(factory) {
  if (telemetryCache.has(factory.slug)) return telemetryCache.get(factory.slug)

  const engines = factory.engines.map(buildEngine)
  const [statusKey] = factoryWorstStatus(engines)
  const payload = {
    factory_id: factory.slug,
    factory_name: factory.name,
    type: factory.facility_type,
    address: factory.address,
    info: factory.description,
    ae_focus: factory.ae_focus,
    notes: factory.notes,
    status_key: statusKey,
    engines,
    api: apiLinks(factory.slug),
  }
  telemetryCache.set(factory.slug, payload)
  return payload
}

/** Pre-kalkulacja przy starcie serwera - pierwsze żądanie bez opóźnienia. */
export function warmCache(factories) {
  for (const f of factories) {
    buildFactoryListItem(f)
    buildTelemetry(f)
  }
}
