import { useState, useEffect, useId, useRef, useMemo, memo, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { fetchFactories, fetchTelemetry, createFactory } from './api'

function usterkiLabel(n) {
  if (n === 1) return '1 usterka'
  if (n >= 2 && n <= 4) return `${n} usterki`
  return `${n} usterek`
}

const SEVERITY_COLOR = {
  duze: '#b42318',
  srednie: '#9a6700',
  male: '#7a6520',
  nie_dotyczy: '#2d6a4f',
}

const SEVERITY_BG = {
  duze: 'rgba(180, 35, 24, 0.1)',
  srednie: 'rgba(154, 103, 0, 0.1)',
  male: 'rgba(122, 101, 32, 0.1)',
  nie_dotyczy: 'rgba(45, 106, 79, 0.1)',
}

const LABEL_PL = {
  ok: 'Ok',
  zakoksowany: 'Zakoksowany',
  lejacy: 'Lejący',
  pompa: 'Pompa',
  iglica: 'Iglica',
  unknown: 'Nieznany',
}

const SEVERITY_PL = {
  duze: 'duże',
  srednie: 'średnie',
  male: 'małe',
  nie_dotyczy: '-',
}

const SEVERITY_RANK = { duze: 0, srednie: 1, male: 2, nie_dotyczy: 3 }

function engineHealthScore(engine) {
  const bad = engine.cylinders.filter(c => c.label !== 'ok')
  if (!bad.length) return 10_000
  const worst = Math.min(...bad.map(c => SEVERITY_RANK[c.severity] ?? 9))
  return worst * 1000 + (engine.cylinders.length - bad.length)
}

function sortEnginesByHealth(engines) {
  return [...engines]
    .sort((a, b) => engineHealthScore(a) - engineHealthScore(b))
    .map((eng, i) => ({ ...eng, health_rank: eng.health_rank ?? i + 1 }))
}

const CHART_GRID = 'rgba(0,0,0,0.06)'
const CHART_MEDIAN = '#9a9590'
const CHART_RECON = '#2f4f66'

function formatNowDate(d) {
  return d.toLocaleDateString('pl-PL', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
}

function formatNowTime(d) {
  return d.toLocaleTimeString('pl-PL', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

function HeaderClock() {
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(timer)
  }, [])

  return (
    <div className="main-header-clock">
      <time dateTime={now.toISOString()} className="main-header-time">
        {formatNowTime(now)}
      </time>
      <span className="main-header-date">{formatNowDate(now)}</span>
    </div>
  )
}

function MainHeader({ title, onAddClick }) {
  return (
    <header className="main-header">
      <div className="main-header-brand">
        <img
          className="main-header-logo"
          src="/wide_logo.svg"
          alt="Turmalin"
          width="2048"
          height="512"
        />
        {title ? (
          <h1 className="main-header-title" key={title}>
            {title}
          </h1>
        ) : null}
      </div>
      <div className="main-header-end">
        {onAddClick ? (
          <button type="button" className="main-header-add" onClick={onAddClick}>
            Nowy zakład przemysłowy
          </button>
        ) : null}
        <HeaderClock />
      </div>
    </header>
  )
}

const PIE_ENGINES = [
  { key: 'ok', label: 'Sprawne', color: '#2d6a4f' },
  { key: 'fault', label: 'Z uwagami', color: '#b42318' },
]

const PIE_SEVERITY = [
  { key: 'male', label: 'Małe', color: '#7a6520' },
  { key: 'srednie', label: 'Średnie', color: '#9a6700' },
  { key: 'duze', label: 'Duże', color: '#b42318' },
]

function polar(cx, cy, r, angleDeg) {
  const rad = ((angleDeg - 90) * Math.PI) / 180
  return [cx + r * Math.cos(rad), cy + r * Math.sin(rad)]
}

function donutSlice(cx, cy, rOuter, rInner, startDeg, endDeg) {
  const sweep = endDeg - startDeg
  if (sweep <= 0.01) return null
  if (sweep >= 359.99) {
    return [
      `M ${cx} ${cy - rOuter}`,
      `A ${rOuter} ${rOuter} 0 1 1 ${cx} ${cy + rOuter}`,
      `A ${rOuter} ${rOuter} 0 1 1 ${cx} ${cy - rOuter}`,
      `M ${cx} ${cy - rInner}`,
      `A ${rInner} ${rInner} 0 1 0 ${cx} ${cy + rInner}`,
      `A ${rInner} ${rInner} 0 1 0 ${cx} ${cy - rInner}`,
      'Z',
    ].join(' ')
  }
  const large = sweep > 180 ? 1 : 0
  const [x0, y0] = polar(cx, cy, rOuter, startDeg)
  const [x1, y1] = polar(cx, cy, rOuter, endDeg)
  const [x2, y2] = polar(cx, cy, rInner, endDeg)
  const [x3, y3] = polar(cx, cy, rInner, startDeg)
  return [
    `M ${x0} ${y0}`,
    `A ${rOuter} ${rOuter} 0 ${large} 1 ${x1} ${y1}`,
    `L ${x2} ${y2}`,
    `A ${rInner} ${rInner} 0 ${large} 0 ${x3} ${y3}`,
    'Z',
  ].join(' ')
}

function DonutChart({ segments, size = 96, thickness = 14, centerValue, centerLabel }) {
  const total = segments.reduce((s, seg) => s + seg.value, 0)
  const cx = size / 2
  const cy = size / 2
  const rOuter = size / 2 - 2
  const rInner = rOuter - thickness

  let angle = 0
  const paths = []
  if (total > 0) {
    for (const seg of segments) {
      if (!seg.value) continue
      const sweep = (seg.value / total) * 360
      const d = donutSlice(cx, cy, rOuter, rInner, angle, angle + sweep)
      if (d) {
        paths.push(
          <path key={seg.key} d={d} fill={seg.color} stroke="var(--surface)" strokeWidth="1" />,
        )
      }
      angle += sweep
    }
  } else {
    paths.push(
      <circle
        key="empty"
        cx={cx}
        cy={cy}
        r={(rOuter + rInner) / 2}
        fill="none"
        stroke="var(--border)"
        strokeWidth={thickness}
      />,
    )
  }

  return (
    <svg
      className="factory-donut"
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      aria-hidden="true"
    >
      {paths}
      <text
        x={cx}
        y={cy - (centerLabel ? 4 : 0)}
        textAnchor="middle"
        dominantBaseline="central"
        className="factory-donut-value"
      >
        {centerValue}
      </text>
      {centerLabel ? (
        <text
          x={cx}
          y={cy + 12}
          textAnchor="middle"
          dominantBaseline="central"
          className="factory-donut-label"
        >
          {centerLabel}
        </text>
      ) : null}
    </svg>
  )
}

function aggregateFactoryHover(engines) {
  let engOk = 0
  let engFault = 0
  const sev = { male: 0, srednie: 0, duze: 0 }

  for (const eng of engines) {
    if ((eng.intervention_count || 0) === 0) engOk += 1
    else engFault += 1

    const counts = eng.severity_counts
    if (counts) {
      sev.male += counts.male || 0
      sev.srednie += counts.srednie || 0
      sev.duze += counts.duze || 0
    }
  }

  return {
    engOk,
    engFault,
    enginesTotal: engines.length,
    sev,
    anomalies: sev.male + sev.srednie + sev.duze,
  }
}

function FactoryHoverOverlay({ factory, engines }) {
  const stats = useMemo(() => aggregateFactoryHover(engines), [engines])

  const engineSegments = PIE_ENGINES.map(s => ({
    ...s,
    value: s.key === 'ok' ? stats.engOk : stats.engFault,
  }))
  const severitySegments = PIE_SEVERITY.map(s => ({
    ...s,
    value: stats.sev[s.key] || 0,
  }))

  return (
    <div className="factory-card-hover" aria-hidden="true">
      <div className="factory-hover-charts">
        <div className="factory-hover-chart">
          <DonutChart
            segments={engineSegments}
            size={72}
            thickness={11}
            centerValue={stats.enginesTotal}
            centerLabel="silniki"
          />
          <ul className="factory-hover-legend">
            {engineSegments.map(s => (
              <li key={s.key}>
                <span className="factory-hover-swatch" style={{ background: s.color }} />
                <span>{s.label}</span>
                <strong>{s.value}</strong>
              </li>
            ))}
          </ul>
        </div>
        <div className="factory-hover-chart">
          <DonutChart
            segments={severitySegments}
            size={72}
            thickness={11}
            centerValue={stats.anomalies || factory.anomaly_count || 0}
            centerLabel="usterki"
          />
          <ul className="factory-hover-legend">
            {severitySegments.map(s => (
              <li key={s.key}>
                <span className="factory-hover-swatch" style={{ background: s.color }} />
                <span>{s.label}</span>
                <strong>{s.value}</strong>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  )
}

function previewEngineScore(engine) {
  const sc = engine.severity_counts || {}
  const duze = sc.duze || 0
  const srednie = sc.srednie || 0
  const male = sc.male || 0
  if (duze + srednie + male === 0) return -1
  return duze * 1_000_000 + srednie * 1_000 + male
}

function aggregateFleet(factories) {
  const sev = { duze: 0, srednie: 0, male: 0 }
  let worst = null
  let worstScore = -1
  for (const f of factories) {
    for (const e of f.engines || []) {
      const sc = e.severity_counts || {}
      sev.duze += sc.duze || 0
      sev.srednie += sc.srednie || 0
      sev.male += sc.male || 0
      const score = previewEngineScore(e)
      if (score > worstScore) {
        worstScore = score
        worst = { factory: f, engine: e }
      }
    }
  }
  return { sev, worst: worstScore >= 0 ? worst : null }
}

function FleetBar({ factories, onOpenWorst }) {
  const { sev, worst } = useMemo(() => aggregateFleet(factories), [factories])
  if (!factories.length) return null

  const loc = worst?.factory.location || 'unknown'
  const dist = worst?.factory.distance || 'unknown'

  return (
    <div className="fleet-bar">
      <ul className="fleet-bar-counts">
        <li className="is-duze">
          <span>Duże</span>
          <strong>{sev.duze}</strong>
        </li>
        <li className="is-srednie">
          <span>Średnie</span>
          <strong>{sev.srednie}</strong>
        </li>
        <li className="is-male">
          <span>Małe</span>
          <strong>{sev.male}</strong>
        </li>
      </ul>
      {worst ? (
        <button
          type="button"
          className="fleet-bar-worst"
          onClick={e => onOpenWorst(worst, e.currentTarget.getBoundingClientRect())}
        >
          <span className="fleet-bar-kicker">Najgorszy silnik</span>
          <strong>{worst.engine.engine_id}</strong>
          <span className="fleet-bar-sep" aria-hidden="true">
            ·
          </span>
          <span>{worst.factory.name}</span>
          <span className="fleet-bar-sep" aria-hidden="true">
            ·
          </span>
          <span className="fleet-bar-loc">{loc}</span>
          <span className="fleet-bar-sep" aria-hidden="true">
            ·
          </span>
          <span className="fleet-bar-dist">{dist}</span>
        </button>
      ) : (
        <p className="fleet-bar-ok">Brak usterek</p>
      )}
    </div>
  )
}

const FactoryCard = memo(function FactoryCard({ factory: f, selected, onSelect }) {
  const engines = f.engines || []

  return (
    <button
      type="button"
      className={`factory-card${selected ? ' active' : ''}`}
      data-factory-id={f.id}
      onClick={e => onSelect(f.id, e.currentTarget.getBoundingClientRect())}
    >
      <div className="factory-card-media">
        <img
          src={f.image}
          alt=""
          className="factory-img"
          loading="lazy"
          decoding="async"
        />
        <FactoryHoverOverlay factory={f} engines={engines} />
      </div>
      <div className="factory-card-body">
        <div className="factory-card-meta">
          <span className="status-pill" data-status={f.status_key || 'ok'}>
            <span className="status-dot" />
            {f.status}
          </span>
        </div>
        <h3>{f.name}</h3>
        <p>{f.address}</p>
      </div>
    </button>
  )
})

const FactoryGrid = memo(function FactoryGrid({ factories, selectedId, onSelect, onAddClick }) {
  return (
    <div className="factory-grid">
      {factories.map(f => (
        <FactoryCard
          key={f.id}
          factory={f}
          selected={f.id === selectedId}
          onSelect={onSelect}
        />
      ))}
      <button type="button" className="factory-add-card" onClick={onAddClick}>
        <div className="factory-add-card-media">
          <span className="factory-add-plus" aria-hidden="true">
            +
          </span>
        </div>
        <div className="factory-add-card-body">
          <span className="factory-add-label">Nowy zakład przemysłowy</span>
          <span className="factory-add-hint">Nazwa + CSV z widmami</span>
        </div>
      </button>
    </div>
  )
})

function AddFactoryModal({ open, onClose, onCreated }) {
  const [name, setName] = useState('')
  const [address, setAddress] = useState('')
  const [lat, setLat] = useState('')
  const [lng, setLng] = useState('')
  const [description, setDescription] = useState('')
  const [csvFile, setCsvFile] = useState(null)
  const [imageFile, setImageFile] = useState(null)
  const [imagePreview, setImagePreview] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const csvRef = useRef(null)
  const imageRef = useRef(null)

  useEffect(() => {
    if (!open) return
    setName('')
    setAddress('')
    setLat('')
    setLng('')
    setDescription('')
    setCsvFile(null)
    setImageFile(null)
    setImagePreview('')
    setError('')
    setBusy(false)
    if (csvRef.current) csvRef.current.value = ''
    if (imageRef.current) imageRef.current.value = ''
  }, [open])

  useEffect(() => {
    if (!imageFile) {
      setImagePreview('')
      return
    }
    const url = URL.createObjectURL(imageFile)
    setImagePreview(url)
    return () => URL.revokeObjectURL(url)
  }, [imageFile])

  useEffect(() => {
    if (!open) return
    const onKey = e => {
      if (e.key === 'Escape' && !busy) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, busy, onClose])

  if (!open) return null

  const submit = async e => {
    e.preventDefault()
    if (busy) return
    if (!name.trim()) {
      setError('Podaj nazwę zakładu.')
      return
    }
    if (!csvFile) {
      setError('Wybierz plik CSV.')
      return
    }
    const latTrim = lat.trim()
    const lngTrim = lng.trim()
    if (Boolean(latTrim) !== Boolean(lngTrim)) {
      setError('Podaj lat i lng razem, albo oba puste (unknown).')
      return
    }
    setBusy(true)
    setError('')
    try {
      const created = await createFactory({
        name: name.trim(),
        address: address.trim(),
        lat: latTrim,
        lng: lngTrim,
        description: description.trim(),
        csvFile,
        imageFile,
      })
      onCreated(created)
      onClose()
    } catch (err) {
      setError(err.message || 'Nie udało się dodać zakładu.')
      setBusy(false)
    }
  }

  return createPortal(
    <div className="factory-modal" role="dialog" aria-modal="true" aria-label="Nowy zakład przemysłowy">
      <button type="button" className="factory-modal-backdrop" aria-label="Zamknij" onClick={busy ? undefined : onClose} />
      <form className="factory-modal-panel" onSubmit={submit}>
        <header className="factory-modal-head">
          <h2>Nowy zakład przemysłowy</h2>
          <button type="button" className="factory-modal-close" onClick={onClose} disabled={busy}>
            ×
          </button>
        </header>

        <label className="factory-modal-field">
          <span>Nazwa</span>
          <input
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="np. Huta Przykładowa"
            autoFocus
            required
            disabled={busy}
          />
        </label>

        <label className="factory-modal-field">
          <span>Adres</span>
          <input
            type="text"
            value={address}
            onChange={e => setAddress(e.target.value)}
            placeholder="opcjonalnie"
            disabled={busy}
          />
        </label>

        <div className="factory-modal-row">
          <label className="factory-modal-field">
            <span>Szerokość (lat)</span>
            <input
              type="text"
              inputMode="decimal"
              value={lat}
              onChange={e => setLat(e.target.value)}
              placeholder="np. 50.4875"
              disabled={busy}
            />
          </label>
          <label className="factory-modal-field">
            <span>Długość (lng)</span>
            <input
              type="text"
              inputMode="decimal"
              value={lng}
              onChange={e => setLng(e.target.value)}
              placeholder="np. 19.4568"
              disabled={busy}
            />
          </label>
        </div>
        <em className="factory-modal-help">Puste lat i lng = lokalizacja unknown. Baza: Zawiercie.</em>

        <label className="factory-modal-field">
          <span>Opis</span>
          <textarea
            value={description}
            onChange={e => setDescription(e.target.value)}
            placeholder="opcjonalnie"
            rows={2}
            disabled={busy}
          />
        </label>

        <div className="factory-modal-field">
          <span>Zdjęcie</span>
          <input
            ref={imageRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp"
            className="factory-modal-file-input"
            onChange={e => setImageFile(e.target.files?.[0] || null)}
            disabled={busy}
          />
          <div className="factory-modal-upload">
            {imagePreview ? (
              <img className="factory-modal-upload-preview" src={imagePreview} alt="" />
            ) : (
              <div className="factory-modal-upload-placeholder" aria-hidden="true">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
                  <rect x="3" y="5" width="18" height="14" rx="2" />
                  <circle cx="8.5" cy="10" r="1.5" />
                  <path d="M21 15l-5-5L5 19" />
                </svg>
              </div>
            )}
            <div className="factory-modal-upload-meta">
              <button
                type="button"
                className="factory-modal-file-btn"
                onClick={() => imageRef.current?.click()}
                disabled={busy}
              >
                {imageFile ? 'Zmień zdjęcie' : 'Dodaj zdjęcie'}
              </button>
              {imageFile ? (
                <em className="factory-modal-file">{imageFile.name}</em>
              ) : (
                <em className="factory-modal-help">JPG, PNG lub WebP — opcjonalnie</em>
              )}
            </div>
          </div>
        </div>

        <div className="factory-modal-field">
          <span>CSV z widmami</span>
          <input
            ref={csvRef}
            type="file"
            accept=".csv,text/csv"
            className="factory-modal-file-input"
            onChange={e => setCsvFile(e.target.files?.[0] || null)}
            required
            disabled={busy}
          />
          <div className="factory-modal-upload factory-modal-upload--file">
            <button
              type="button"
              className="factory-modal-file-btn"
              onClick={() => csvRef.current?.click()}
              disabled={busy}
            >
              {csvFile ? 'Zmień plik CSV' : 'Wybierz plik CSV'}
            </button>
            {csvFile ? <em className="factory-modal-file">{csvFile.name}</em> : null}
          </div>
        </div>

        {error ? <p className="factory-modal-error">{error}</p> : null}

        <footer className="factory-modal-actions">
          <button type="button" className="btn-back" onClick={onClose} disabled={busy}>
            Anuluj
          </button>
          <button type="submit" className="factory-modal-submit" disabled={busy}>
            {busy ? 'Dodawanie…' : 'Dodaj zakład'}
          </button>
        </footer>
      </form>
    </div>,
    document.body,
  )
}

function highlightFreqs(cylinder) {
  if (cylinder.label === 'ok') return []
  return [...new Set((cylinder.highlight_khz || []).map(Number).filter(n => Number.isFinite(n) && n >= 0 && n <= 20))]
}

function HighlightBands({ freqs, toX, padTop, plotH, color }) {
  const binW = Math.max(toX(1) - toX(0), 4)
  return freqs.map(f => (
    <rect
      key={f}
      x={toX(f) - binW / 2}
      y={padTop}
      width={binW}
      height={plotH}
      fill={`${color}22`}
    />
  ))
}
function binValues(values, length = 21) {
  return Array.from({ length }, (_, i) => {
    const v = values?.[i]
    if (v == null || v === '') return null
    const n = Number(v)
    return Number.isFinite(n) ? n : null
  })
}

function gappedPath(vals, toX, toY) {
  const parts = []
  let run = []
  const flush = () => {
    if (run.length >= 2) parts.push(`M ${run.join(' L ')}`)
    run = []
  }
  ;(vals || []).forEach((v, f) => {
    if (v == null) flush()
    else run.push(`${toX(f)},${toY(v)}`)
  })
  flush()
  return parts.join(' ')
}

function gapEdgeDots(vals) {
  const dots = []
  const n = vals.length
  for (let f = 0; f < n; f++) {
    if (vals[f] == null) continue
    const leftGap = f > 0 && vals[f - 1] == null
    const rightGap = f < n - 1 && vals[f + 1] == null
    if (leftGap || rightGap) dots.push(f)
  }
  return dots
}

function GlrtExplainOverlay({ cylinder, engine, onClose }) {
  useEffect(() => {
    const onKey = e => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])

  const lines = cylinder.decision || []
  if (!lines.length) return null
  const sev =
    cylinder.severity !== 'nie_dotyczy' ? ` · ${SEVERITY_PL[cylinder.severity]}` : ''

  return (
    <div
      className="glrt-modal"
      role="dialog"
      aria-modal="true"
      aria-label={`Wyjaśnienie modelu — cylinder ${cylinder.cylinder}`}
    >
      <button type="button" className="factory-modal-backdrop" aria-label="Zamknij" onClick={onClose} />
      <div className="glrt-modal-panel">
        <header className="factory-modal-head">
          <div>
            <p className="glrt-kicker">Model widmowy (GLRT)</p>
            <h2 className="glrt-title">
              Cylinder {cylinder.cylinder}: {LABEL_PL[cylinder.label] || cylinder.label}
              {sev}
            </h2>
          </div>
          <button type="button" className="factory-modal-close" onClick={onClose}>
            ×
          </button>
        </header>
        <ul className="glrt-metrics">
          <li>
            <span>Istotność</span>
            <strong>
              {cylinder.istotnosc_sigma != null ? `${cylinder.istotnosc_sigma}σ` : '—'}
            </strong>
          </li>
          <li>
            <span>χ dopasowania</span>
            <strong>{cylinder.chi_dopasowania ?? '—'}</strong>
          </li>
          <li>
            <span>Amplituda</span>
            <strong>
              {cylinder.amplituda_mV != null ? `${cylinder.amplituda_mV} mV` : '—'}
            </strong>
          </li>
          <li>
            <span>Szablon</span>
            <strong>
              {cylinder.label === 'ok'
                ? '—'
                : LABEL_PL[cylinder.szablon] || cylinder.szablon || '—'}
            </strong>
          </li>
        </ul>
        <ol className="glrt-decision">
          {lines.map(line => (
            <li key={line}>{line}</li>
          ))}
        </ol>
        <div className="diagnosis-chart-block">
          <Spectrum cylinder={cylinder} engine={engine} height={160} />
        </div>
      </div>
    </div>
  )
}

const REPAIR_HINT = {
  ok: 'Brak działań — cylinder w normie względem reszty jednostki.',
  zakoksowany: {
    male: 'Zaplanuj czyszczenie wtryskiwacza (dekarbonizacja / dodatek). Przy najbliższym postoju sprawdź rozpylacz.',
    srednie: 'Wymontuj wtryskiwacz, wyczyść gniazdo i rozpylacz. Po czyszczeniu powtórz pomiar akustyczny.',
    duze: 'Wymień wtryskiwacz — silne zakoksowanie rozpylacza. Nie odkładaj: nierówny wtrysk i dymienie.',
  },
  lejacy: {
    male: 'Sprawdź dokręcenie i uszczelnienie wtryskiwacza. Obserwuj spadek ciśnienia na szynie.',
    srednie: 'Wymień uszczelki i o-ringi wtryskiwacza. Skontroluj przelot powrotu (leak-off).',
    duze: 'Wymień wtryskiwacz — przeciek paliwa do komory. Ryzyko mycia tulei i rozcieńczenia oleju.',
  },
  pompa: {
    male: 'Sprawdź zasilanie i filtr paliwa. Zmierz ciśnienie na pompie przy następnym przeglądzie.',
    srednie: 'Zdiagnozuj pompę wysokiego ciśnienia (wydatek, zawór regulacji). Wymień filtr paliwa.',
    duze: 'Naprawa lub wymiana pompy HP. Do tego czasu ogranicz obciążenie silnika.',
  },
  iglica: {
    male: 'Iglica wtryskiwacza zaczyna zacinać — zaplanuj weryfikację na stole próbnym.',
    srednie: 'Zregeneruj wtryskiwacz: iglica + korpus. Po regeneracji kalibracja dawki.',
    duze: 'Wymień wtryskiwacz — uszkodzona iglica. Nie zwlekaj: ryzyko nierównej pracy i spalania stukowego.',
  },
  unknown: 'Anomalia poza katalogiem usterek. Porównaj z sąsiednimi cylindrami, sprawdź okablowanie czujnika i powtórz pomiar. Jeśli wraca — oględziny wtrysku na stole.',
}

function repairHint(cylinder) {
  const hint = REPAIR_HINT[cylinder.label]
  if (!hint) return ''
  if (typeof hint === 'string') return hint
  return hint[cylinder.severity] || hint.srednie
}

function CylinderDiagnosis({ engine, cylinder, headerOffset = 72 }) {
  const [showPath, setShowPath] = useState(false)
  const hint = repairHint(cylinder)

  return (
    <div
      className="engine-rank-detail"
      id={`cyl-${engine.engine_id}-${cylinder.cylinder}`}
      style={{ borderLeftColor: SEVERITY_COLOR[cylinder.severity] }}
    >
      <div className="engine-rank-detail-head">
        <strong className="engine-rank-detail-cyl">Cylinder {cylinder.cylinder}</strong>
        <div className="engine-rank-detail-actions">
          <span
            className="badge"
            style={{
              background: SEVERITY_BG[cylinder.severity],
              color: SEVERITY_COLOR[cylinder.severity],
            }}
          >
            {LABEL_PL[cylinder.label] || cylinder.label}
            {cylinder.severity !== 'nie_dotyczy' && ` · ${SEVERITY_PL[cylinder.severity]}`}
          </span>
          <button
            type="button"
            className={`tree-path-toggle${showPath ? ' active' : ''}`}
            onClick={() => setShowPath(true)}
            aria-expanded={showPath}
            disabled={!cylinder.decision?.length}
          >
            Wyjaśnienie
          </button>
        </div>
      </div>
      {hint && <p className="explain">{hint}</p>}
      {showPath &&
        createPortal(
          <GlrtExplainOverlay
            cylinder={cylinder}
            engine={engine}
            onClose={() => setShowPath(false)}
          />,
          document.body,
        )}
      <div className="diagnosis-chart-block">
        <Spectrum cylinder={cylinder} engine={engine} height={110} />
      </div>
    </div>
  )
}

function MonitoringPanel({
  telemetry,
  loading,
  selectedEngineId,
  engineFromRect,
  engineClosing,
  onSelectEngine,
  onBackToEngines,
  fromRect,
  closing,
  onClose,
  headerOffset = 0,
  factoryImage,
}) {
  const [expanded, setExpanded] = useState(false)
  const [engineExpanded, setEngineExpanded] = useState(false)

  useEffect(() => {
    const id = requestAnimationFrame(() => {
      requestAnimationFrame(() => setExpanded(!closing))
    })
    return () => cancelAnimationFrame(id)
  }, [closing])

  useEffect(() => {
    if (!engineFromRect) {
      setEngineExpanded(false)
      return
    }
    const id = requestAnimationFrame(() => {
      requestAnimationFrame(() => setEngineExpanded(!engineClosing))
    })
    return () => cancelAnimationFrame(id)
  }, [engineFromRect, engineClosing])

  useEffect(() => {
    const onKey = e => {
      if (e.key !== 'Escape') return
      if (selectedEngineId) onBackToEngines()
      else onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selectedEngineId, onBackToEngines, onClose])

  if (!fromRect) return null

  const showExpanded = expanded && !closing
  const shellStyle = showExpanded
    ? {
        top: headerOffset,
        left: 0,
        width: '100vw',
        height: `calc(100vh - ${headerOffset}px)`,
        borderRadius: 0,
      }
    : {
        top: fromRect.top,
        left: fromRect.left,
        width: fromRect.width,
        height: fromRect.height,
        borderRadius: 12,
      }

  const showEngine = Boolean(engineFromRect)
  const showEngineExpanded = engineExpanded && !engineClosing
  const engineShellStyle = showEngine && engineFromRect
    ? (showEngineExpanded
      ? {
          top: headerOffset,
          left: 0,
          width: '100vw',
          height: `calc(100vh - ${headerOffset}px)`,
          borderRadius: 0,
        }
      : {
          top: engineFromRect.top,
          left: engineFromRect.left,
          width: engineFromRect.width,
          height: engineFromRect.height,
          borderRadius: 12,
        })
    : null

  const selectedEngine = telemetry?.engines?.find(e => e.engine_id === selectedEngineId)

  return (
    <div className={`monitor-panel${showExpanded ? ' open' : ''}`} role="dialog" aria-modal="true">
      <button
        type="button"
        className="monitor-panel-backdrop"
        aria-label="Zamknij"
        onClick={onClose}
        style={{ top: headerOffset }}
      />
      <div className="monitor-panel-shell" style={shellStyle}>
        {factoryImage ? (
          <img className="monitor-morph-img" src={factoryImage} alt="" />
        ) : null}
        <div className={`monitor-panel-inner${showExpanded ? ' visible' : ''}`}>
          <div className="monitor-toolbar">
            <button type="button" className="btn-back" onClick={onClose}>
              ← Wróć do listy
            </button>
          </div>

          <div className="monitor-layout monitor-layout--full">
            <div className="monitor-main">
              {loading && <p className="panel-loading monitor-main-loading">Pobieranie danych</p>}

              {!loading && telemetry?.engines?.length > 0 && (
                <div className="engines-menu">
                  {sortEnginesByHealth(telemetry.engines).map((eng, i) => {
                    const faults = eng.intervention_count || 0
                    return (
                      <button
                        key={eng.engine_id}
                        type="button"
                        className={`engine-menu-card${faults ? ' has-fault' : ''}`}
                        style={{ borderTopColor: eng.status_color, '--i': i }}
                        onClick={e => onSelectEngine(eng.engine_id, e.currentTarget.getBoundingClientRect())}
                      >
                        <div className="engine-menu-head">
                          <strong>{eng.engine_id}</strong>
                          <span className="engine-menu-layout">V{eng.n_cylinders}</span>
                        </div>
                        <div className="engine-menu-diagram">
                          <EngineDiagram engine={eng} interactive={false} />
                        </div>
                        <div className={`engine-menu-faults${faults ? ' is-bad' : ' is-ok'}`}>
                          {usterkiLabel(faults)}
                        </div>
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {showEngine && engineShellStyle && (
        <div className="monitor-panel-shell engine-detail-shell" style={engineShellStyle}>
          <div className={`monitor-panel-inner${showEngineExpanded ? ' visible' : ''}`}>
            <div className="monitor-toolbar">
              <button type="button" className="btn-back" onClick={onBackToEngines}>
                ← Wróć do silników
              </button>
            </div>
            <div className="monitor-layout monitor-layout--full">
              <div className="monitor-main">
                {selectedEngine && (
                  <div className="engines-ranking">
                    <EngineRankRow engine={selectedEngine} headerOffset={headerOffset} />
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function Spectrum({ cylinder, engine, width = '100%', height = 110 }) {
  const hatchId = `gap-hatch-${useId().replace(/:/g, '')}`
  const padL = 34
  const padR = 12
  const padTop = 14
  const padBottom = 18
  const plotW = typeof width === 'number' ? width - padL - padR : 400
  const plotH = height - padTop - padBottom
  const med = engine?.healthy_median
  const color = SEVERITY_COLOR[cylinder.severity] || '#2d6a4f'
  const highlights = highlightFreqs(cylinder)

  const cylVals = binValues(Array.from({ length: 21 }, (_, f) => cylinder[`mV_${f}`]))
  const missing = cylVals.flatMap((v, f) => (v == null ? [f] : []))
  const profileSrc = Array.isArray(cylinder.profile_mV) && cylinder.profile_mV.some(v => v != null)
    ? cylinder.profile_mV
    : med
      ? Array.from({ length: 21 }, (_, f) => med[`mV_${f}`])
      : []
  const medVals = binValues(profileSrc)
  const fitted = binValues(cylinder.fitted_fault_mV)
  const reconVals =
    cylinder.label !== 'ok' && Array.isArray(cylinder.fitted_fault_mV)
      ? medVals.map((p, i) => (p == null || fitted[i] == null ? null : p + fitted[i]))
      : []
  const all = [...cylVals, ...medVals, ...reconVals].filter(v => v != null)
  const rawMin = all.length ? Math.min(...all) : 0
  const rawMax = all.length ? Math.max(...all) : 1
  const span = Math.max(rawMax - rawMin, 0.5)
  const pad = span * 0.12
  let minVal = rawMin - pad
  let maxVal = rawMax + pad
  if (minVal > 0 && minVal < span * 0.15) minVal = 0

  const niceStep = (() => {
    const rough = (maxVal - minVal) / 3
    const pow = 10 ** Math.floor(Math.log10(rough || 1))
    const n = rough / pow
    const nice = n < 1.5 ? 1 : n < 3.5 ? 2 : n < 7.5 ? 5 : 10
    return nice * pow
  })()
  const tickStart = Math.ceil(minVal / niceStep) * niceStep
  const ticks = []
  for (let v = tickStart; v <= maxVal + niceStep * 0.01; v += niceStep) {
    ticks.push(Math.round(v * 1000) / 1000)
  }
  if (ticks.length < 2) ticks.push(minVal, maxVal)

  const toY = val => padTop + ((maxVal - val) / (maxVal - minVal || 1)) * plotH
  const toX = f => padL + (f / 20) * plotW
  const fmtTick = v => {
    const abs = Math.abs(v)
    if (abs >= 100) return v.toFixed(0)
    if (abs >= 10) return v.toFixed(1)
    return v.toFixed(2)
  }

  const measPath = gappedPath(cylVals, toX, toY)
  const medPath = gappedPath(medVals, toX, toY)
  const reconPath = gappedPath(reconVals, toX, toY)
  const edgeDots = gapEdgeDots(cylVals)
  const binW = Math.max(toX(1) - toX(0), 4)

  return (
    <>
    <svg
      viewBox={`0 0 ${padL + plotW + padR} ${height}`}
      className="chart"
      preserveAspectRatio="xMidYMid meet"
    >
      <defs>
        <pattern
          id={hatchId}
          width="4"
          height="4"
          patternUnits="userSpaceOnUse"
          patternTransform="rotate(45)"
        >
          <line x1="0" y1="0" x2="0" y2="4" stroke="rgba(28,27,25,0.18)" strokeWidth="1" />
        </pattern>
      </defs>
      {ticks.map(v => (
        <g key={v}>
          <line
            x1={padL}
            y1={toY(v)}
            x2={padL + plotW}
            y2={toY(v)}
            stroke={CHART_GRID}
            strokeWidth="1"
          />
          <text
            x={padL - 6}
            y={toY(v) + 3}
            textAnchor="end"
            fill={CHART_MEDIAN}
            fontSize="8"
            fontFamily="IBM Plex Mono, ui-monospace, monospace"
          >
            {fmtTick(v)}
          </text>
        </g>
      ))}
      {missing.map(f => (
        <g key={`gap-${f}`}>
          <rect
            x={toX(f) - binW / 2}
            y={padTop}
            width={binW}
            height={plotH}
            fill={`url(#${hatchId})`}
          />
          <text
            x={toX(f)}
            y={padTop + plotH + 12}
            textAnchor="middle"
            fill="#7a7670"
            fontSize="7"
            fontFamily="IBM Plex Mono, ui-monospace, monospace"
          >
            {f}
          </text>
        </g>
      ))}
      <HighlightBands
        freqs={highlights}
        toX={toX}
        padTop={padTop}
        plotH={plotH}
        color={color}
      />
      {medPath && (
        <path
          d={medPath}
          fill="none"
          stroke={CHART_MEDIAN}
          strokeWidth="1.5"
          strokeDasharray="4 3"
        />
      )}
      {reconPath && (
        <path
          d={reconPath}
          fill="none"
          stroke={CHART_RECON}
          strokeWidth="1.15"
          strokeDasharray="1.5 3.5"
          strokeLinejoin="round"
          opacity="0.7"
        />
      )}
      {measPath && (
        <path
          d={measPath}
          fill="none"
          stroke={color}
          strokeWidth="2"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      )}
      {edgeDots.map(f => (
        <circle
          key={`dot-${f}`}
          cx={toX(f)}
          cy={toY(cylVals[f])}
          r="2.2"
          fill={color}
        />
      ))}
    </svg>
    <ul className="spectrum-legend">
      <li>
        <span className="spectrum-legend-line is-solid" style={{ background: color }} />
        pomiar
      </li>
      {medPath && (
        <li>
          <span className="spectrum-legend-line is-profile" />
          profil silnika
        </li>
      )}
      {reconPath && (
        <li>
          <span className="spectrum-legend-line is-recon" />
          dopasowany szablon
        </li>
      )}
      {missing.length > 0 && (
        <li>
          <span className="spectrum-legend-line is-gap" />
          brak pomiaru ({missing.map(f => `${f} kHz`).join(', ')})
        </li>
      )}
    </ul>
    </>
  )
}

function layoutEngineDiagram(half) {
  const R = 15
  const padX = 18
  const padTop = 12
  const padBottom = 8
  const minCenterGap = 42
  const caseH = 22
  const caseGap = 14
  const minEdgeGap = half >= 8 ? 5 : half >= 6 ? 6 : 7

  const step = 2 * R + minEdgeGap
  const leftX = padX + R
  const rightX = leftX + 2 * R + minCenterGap
  const lastCylY = padTop + R + (half - 1) * step
  const caseTop = lastCylY + R + caseGap
  const w = rightX + R + padX
  const h = caseTop + caseH + padBottom
  const cx = (leftX + rightX) / 2

  return { R, step, leftX, rightX, w, h, padTop, caseTop, caseH, cx }
}

function EngineDiagram({ engine, selectedCylinder, onCylinderToggle, interactive = true }) {
  const uid = useId().replace(/:/g, '')
  const n = engine.n_cylinders
  const half = n / 2
  const byNum = Object.fromEntries(engine.cylinders.map(c => [c.cylinder, c]))
  const layout = layoutEngineDiagram(half)
  const { R, step, leftX, rightX, w, h, padTop, caseTop, caseH, cx } = layout
  const boreR = R * 0.42

  const positions = []
  for (let i = 0; i < half; i++) {
    const y = padTop + R + i * step
    positions.push({ num: i + 1, x: leftX, y, bank: 'L' })
    positions.push({ num: half + i + 1, x: rightX, y, bank: 'R' })
  }

  const firstY = padTop + R
  const crankY = caseTop + caseH * 0.42

  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      className={`engine-diagram${interactive ? '' : ' engine-diagram--preview'}`}
      style={interactive ? { width: w, height: h } : undefined}
      role="img"
      aria-label={`Schemat silnika ${engine.engine_id}, ${n} cylindrów`}
      preserveAspectRatio="xMidYMid meet"
    >
      <defs>
        <linearGradient id={`metal-${uid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#f8f6f2" />
          <stop offset="100%" stopColor="#e2ddd4" />
        </linearGradient>
        <linearGradient id={`block-${uid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#f4f2ee" />
          <stop offset="100%" stopColor="#ebe7e0" />
        </linearGradient>
        <radialGradient id={`bore-${uid}`} cx="38%" cy="34%" r="70%">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="65%" stopColor="#f4f1eb" />
          <stop offset="100%" stopColor="#dcd7ce" />
        </radialGradient>
        <filter id={`lift-${uid}`} x="-50%" y="-50%" width="200%" height="200%">
          <feDropShadow dx="0" dy="1.2" stdDeviation="1.4" floodColor="#1c1b19" floodOpacity="0.1" />
        </filter>
      </defs>

      <path
        className="engine-diagram-valley"
        d={`M ${leftX} ${firstY} L ${cx - 7} ${caseTop + 2} L ${cx + 7} ${caseTop + 2} L ${rightX} ${firstY} Z`}
        fill={`url(#block-${uid})`}
        stroke="#ddd8d0"
        strokeWidth="1"
      />

      {positions.map(({ num, x, y, bank }) => (
        <line
          key={`rod-${num}`}
          className="engine-diagram-rod"
          x1={x}
          y1={y + R * 0.85}
          x2={bank === 'L' ? cx - 5 : cx + 5}
          y2={crankY}
          stroke="#cfc9bf"
          strokeWidth="1.6"
          strokeLinecap="round"
        />
      ))}

      <g className="engine-diagram-case" aria-hidden="true">
        <rect
          x={leftX - R - 4}
          y={caseTop}
          width={(rightX + R + 4) - (leftX - R - 4)}
          height={caseH}
          rx="7"
          fill={`url(#metal-${uid})`}
          stroke="#d5d0c7"
          strokeWidth="1"
        />
        <circle cx={cx} cy={crankY} r="5.5" fill="#faf9f6" stroke="#c8c3ba" strokeWidth="1.2" />
        <circle cx={cx} cy={crankY} r="2" fill="#c8c3ba" />
      </g>

      {positions.map(({ num, x, y }) => {
        const c = byNum[num]
        if (!c) return null
        const fault = c.label !== 'ok'
        const active = Number(selectedCylinder) === num
        const color = SEVERITY_COLOR[c.severity] || '#2d6a4f'
        const label = LABEL_PL[c.label] || c.label
        const stroke = active ? '#2f4f66' : fault ? color : '#c4bfb6'
        const strokeW = active ? 2.4 : fault ? 2 : 1.4

        return (
          <g
            key={num}
            className={`engine-diagram-cyl${active ? ' active' : ''}${fault ? ' fault' : ' healthy'}`}
            transform={`translate(${x}, ${y})`}
            onClick={interactive ? e => {
              e.stopPropagation()
              onCylinderToggle(num)
            } : undefined}
            onKeyDown={interactive ? e => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                e.stopPropagation()
                onCylinderToggle(num)
              }
            } : undefined}
            role={interactive ? 'button' : undefined}
            tabIndex={interactive ? 0 : undefined}
            aria-label={interactive ? `Cylinder ${num}, ${label}` : undefined}
            aria-pressed={interactive ? active : undefined}
          >
            {active && (
              <circle className="cyl-ring" r={R + 4} fill="none" stroke="#2f4f66" strokeWidth="1.4" opacity="0.3" />
            )}
            <g filter={`url(#lift-${uid})`}>
              <circle
                className="cyl-body"
                r={R}
                fill={fault ? color : `url(#bore-${uid})`}
                fillOpacity={fault ? 0.16 : 1}
                stroke={stroke}
                strokeWidth={strokeW}
              />
            </g>
            <circle
              className="cyl-bore"
              r={boreR}
              fill={fault ? color : '#fff'}
              fillOpacity={fault ? 0.22 : 0.9}
              stroke={fault ? color : '#d8d3ca'}
              strokeWidth="1"
            />
            {fault && (
              <circle className="cyl-dot" r={2.4} fill={color} />
            )}
          </g>
        )
      })}
    </svg>
  )
}

function EngineRankRow({ engine, headerOffset = 72 }) {
  const orderedCylinders = [...engine.cylinders].sort((a, b) => {
    const aBad = a.label !== 'ok' ? 0 : 1
    const bBad = b.label !== 'ok' ? 0 : 1
    if (aBad !== bBad) return aBad - bBad
    const sev = (SEVERITY_RANK[a.severity] ?? 9) - (SEVERITY_RANK[b.severity] ?? 9)
    if (sev) return sev
    return a.cylinder - b.cylinder
  })

  return (
    <div className="engine-rank-details">
      {orderedCylinders.map(c => (
        <CylinderDiagnosis
          key={c.cylinder}
          engine={engine}
          cylinder={c}
          headerOffset={headerOffset}
        />
      ))}
    </div>
  )
}

function App() {
  const [factories, setFactories] = useState([])
  const [selectedFactoryId, setSelectedFactoryId] = useState(null)
  const [selectedEngineId, setSelectedEngineId] = useState(null)
  const [telemetry, setTelemetry] = useState(null)
  const [telemetryLoading, setTelemetryLoading] = useState(false)
  const [panel, setPanel] = useState(null)
  const [engineRect, setEngineRect] = useState(null)
  const [engineClosing, setEngineClosing] = useState(false)
  const [headerOffset, setHeaderOffset] = useState(72)
  const [addOpen, setAddOpen] = useState(false)
  const headerRef = useRef(null)
  const pendingOpenRef = useRef(null)

  useEffect(() => {
    const el = headerRef.current
    if (!el) return
    const update = () => setHeaderOffset(el.getBoundingClientRect().height)
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    fetchFactories().then(setFactories).catch(() => {})
  }, [])

  useEffect(() => {
    if (!selectedFactoryId) return
    let cancelled = false

    setTelemetry(null)
    setTelemetryLoading(true)
    const selectedFactory = factories.find(f => f.id === selectedFactoryId)
    fetchTelemetry(selectedFactory || selectedFactoryId)
      .then(d => {
        if (cancelled) return
        setTelemetry(d)
        const pending = pendingOpenRef.current
        pendingOpenRef.current = null
        if (pending?.engineId) {
          setSelectedEngineId(pending.engineId)
          setEngineRect(pending.rect || null)
          setEngineClosing(false)
        } else {
          setSelectedEngineId(null)
          setEngineRect(null)
          setEngineClosing(false)
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setTelemetryLoading(false)
      })

    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedFactoryId])

  const selectFactory = useCallback((id, rect, engineId = null) => {
    pendingOpenRef.current = engineId ? { engineId, rect } : null
    setSelectedFactoryId(id)
    setSelectedEngineId(null)
    setEngineRect(null)
    setEngineClosing(false)
    setPanel({ fromRect: rect, closing: false })
  }, [])

  const selectEngine = (id, rect) => {
    setSelectedEngineId(id)
    setEngineRect(rect)
    setEngineClosing(false)
  }

  const backToEngines = () => {
    setEngineClosing(true)
    setTimeout(() => {
      setSelectedEngineId(null)
      setEngineRect(null)
      setEngineClosing(false)
    }, 520)
  }

  const closePanel = () => {
    setPanel(p => (p ? { ...p, closing: true } : null))
    if (selectedEngineId) setEngineClosing(true)
    setTimeout(() => {
      setPanel(null)
      setSelectedFactoryId(null)
      setSelectedEngineId(null)
      setEngineRect(null)
      setEngineClosing(false)
    }, 520)
  }

  const selectedFactory = factories.find(f => f.id === selectedFactoryId)
  const factoryOpen = Boolean(panel && !panel.closing)
  const headerTitle = !factoryOpen
    ? ''
    : (selectedEngineId && !engineClosing)
      ? selectedEngineId
      : (selectedFactory?.name || telemetry?.factory_name || 'Ładowanie')

  return (
    <div className="app">
      <div className="app-header" ref={headerRef}>
        <MainHeader title={headerTitle} onAddClick={panel ? undefined : () => setAddOpen(true)} />
      </div>

      <main className="main main--grid-only">
        <section className="grid-pane">
          <FleetBar
            factories={factories}
            onOpenWorst={(worst, rect) => {
              selectFactory(worst.factory.id, rect, worst.engine.engine_id)
            }}
          />
          <FactoryGrid
            factories={factories}
            selectedId={selectedFactoryId}
            onSelect={selectFactory}
            onAddClick={() => setAddOpen(true)}
          />
        </section>
      </main>

      <AddFactoryModal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onCreated={created => {
          setFactories(prev => {
            if (prev.some(f => f.id === created.id)) {
              return prev.map(f => (f.id === created.id ? { ...f, ...created } : f))
            }
            return [...prev, created]
          })
        }}
      />

      {panel && (
        <MonitoringPanel
          telemetry={telemetry}
          loading={telemetryLoading}
          selectedEngineId={selectedEngineId}
          engineFromRect={engineRect}
          engineClosing={engineClosing}
          onSelectEngine={selectEngine}
          onBackToEngines={backToEngines}
          fromRect={panel.fromRect}
          closing={panel.closing}
          onClose={closePanel}
          headerOffset={headerOffset}
          factoryImage={selectedFactory?.image}
        />
      )}
    </div>
  )
}

export default App
