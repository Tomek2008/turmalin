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

const FactoryCard = memo(function FactoryCard({ factory: f, selected, onSelect }) {
  const engines = f.engines || []

  return (
    <button
      type="button"
      className={`factory-card${selected ? ' active' : ''}`}
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
    setBusy(true)
    setError('')
    try {
      const created = await createFactory({
        name: name.trim(),
        address: address.trim(),
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

function formatPathValue(v) {
  if (typeof v !== 'number' || Number.isNaN(v)) return '—'
  const abs = Math.abs(v)
  if (abs >= 100) return v.toFixed(1)
  if (abs >= 10) return v.toFixed(2)
  return v.toFixed(3)
}

const TREE_LEAF_COLOR = {
  ok: '#2d6a4f',
  zakoksowany: '#9a6700',
  lejacy: '#9a6700',
  pompa: '#b42318',
  iglica: '#b42318',
  unknown: '#6b6560',
}

/** Pełne drzewo label (zgodne z api/tree_model.py). left = ≤, right = > */
const LABEL_DECISION_TREE = {
  id: 'n0',
  feature: 'residual_9',
  title: 'Odchyłka od profilu',
  subtitle: 'pasmo 9 kHz',
  threshold: -8.43,
  left: {
    id: 'n1',
    feature: 'sim_zakoksowany',
    title: 'Podobieństwo',
    subtitle: 'wzorzec: zakoksowany',
    threshold: 0.81,
    left: {
      id: 'n2',
      feature: 'sim_lejacy',
      title: 'Podobieństwo',
      subtitle: 'wzorzec: lejący',
      threshold: 0.98,
      left: {
        id: 'n3',
        feature: 'sim_iglica',
        title: 'Podobieństwo',
        subtitle: 'wzorzec: iglica',
        threshold: 0.93,
        left: {
          id: 'n4',
          feature: 'sim_pompa',
          title: 'Podobieństwo',
          subtitle: 'wzorzec: pompa',
          threshold: 0.88,
          left: {
            id: 'n5',
            feature: 'l2',
            title: 'Odległość od profilu',
            subtitle: 'całe widmo (L2)',
            threshold: 41.81,
            left: { id: 'l_ok_a', leaf: 'ok' },
            right: { id: 'l_unk_a', leaf: 'unknown' },
          },
          right: { id: 'l_pompa_a', leaf: 'pompa' },
        },
        right: { id: 'l_iglica', leaf: 'iglica' },
      },
      right: { id: 'l_lejacy', leaf: 'lejacy' },
    },
    right: { id: 'l_zakoks', leaf: 'zakoksowany' },
  },
  right: {
    id: 'n6',
    feature: 'l2',
    title: 'Odległość od profilu',
    subtitle: 'całe widmo (L2)',
    threshold: 34.02,
    left: {
      id: 'n7',
      feature: 'residual_13',
      title: 'Odchyłka od profilu',
      subtitle: 'pasmo 13 kHz',
      threshold: -7.34,
      left: {
        id: 'n8',
        feature: 'residual_0',
        title: 'Odchyłka od profilu',
        subtitle: 'pasmo 0 kHz',
        threshold: -2.46,
        left: { id: 'l_ok_b', leaf: 'ok' },
        right: { id: 'l_pompa_b', leaf: 'pompa' },
      },
      right: { id: 'l_ok_c', leaf: 'ok' },
    },
    right: { id: 'l_unk_b', leaf: 'unknown' },
  },
}

function getDecisionTrail(path) {
  const ids = ['n0']
  const steps = []
  let node = LABEL_DECISION_TREE
  for (const step of path || []) {
    if (!node || node.leaf) break
    const goLeft = step.branch === '<='
    const child = goLeft ? node.left : node.right
    steps.push({
      fromId: node.id,
      toId: child?.id,
      side: goLeft ? '≤' : '>',
      feature: step.feature,
      title: node.title,
      subtitle: node.subtitle,
      threshold: node.threshold,
      value: step.value,
      branch: step.branch,
    })
    node = child
    if (node) ids.push(node.id)
  }
  return { ids, steps, leafId: ids[ids.length - 1] }
}

function layoutDecisionTree(root, { xGap = 22, yGap = 118, nodeW = 176, leafW = 112 } = {}) {
  const positions = new Map()

  function subtreeWidth(node) {
    if (node.leaf) return leafW
    return subtreeWidth(node.left) + xGap + subtreeWidth(node.right)
  }

  function place(node, left, depth) {
    const w = subtreeWidth(node)
    const cx = left + w / 2
    const y = 28 + depth * yGap
    if (node.leaf) {
      positions.set(node.id, { x: cx, y, node, w: leafW })
      return
    }
    positions.set(node.id, { x: cx, y, node, w: nodeW })
    const lw = subtreeWidth(node.left)
    place(node.left, left, depth + 1)
    place(node.right, left + lw + xGap, depth + 1)
  }

  const totalW = subtreeWidth(root)
  place(root, 0, 0)

  let maxY = 0
  for (const p of positions.values()) maxY = Math.max(maxY, p.y)
  return {
    positions,
    width: totalW,
    height: maxY + 40,
    nodeW,
    leafW,
  }
}

function DecisionTreeSvg({ path, label }) {
  const uid = useId().replace(/:/g, '')
  const glowId = `tree-glow-${uid}`
  const trail = useMemo(() => getDecisionTrail(path), [path])
  const layout = useMemo(() => layoutDecisionTree(LABEL_DECISION_TREE), [])
  const { positions, width, height } = layout
  const padX = 28
  const padY = 24
  const vbW = width + padX * 2
  const vbH = height + padY * 2

  // revealedNodeCount: ile węzłów ze ścieżki już widać (min 1 = root)
  // revealedEdgeCount: ile krawędzi ścieżki już narysowano
  // decidingId: węzeł właśnie oceniany
  const [revealedNodeCount, setRevealedNodeCount] = useState(1)
  const [revealedEdgeCount, setRevealedEdgeCount] = useState(0)
  const [decidingId, setDecidingId] = useState(trail.ids[0] || null)
  const [done, setDone] = useState(false)

  useEffect(() => {
    setRevealedNodeCount(1)
    setRevealedEdgeCount(0)
    setDecidingId(trail.ids[0] || null)
    setDone(false)

    const timers = []
    const NODE_MS = 220
    const EDGE_MS = 200
    let t = 80

    trail.steps.forEach((step, i) => {
      timers.push(
        setTimeout(() => {
          setDecidingId(step.fromId)
        }, t),
      )
      t += NODE_MS
      timers.push(
        setTimeout(() => {
          setRevealedEdgeCount(i + 1)
          setDecidingId(null)
        }, t),
      )
      t += EDGE_MS
      timers.push(
        setTimeout(() => {
          setRevealedNodeCount(i + 2)
          setDecidingId(step.toId)
        }, t),
      )
      t += 60
    })

    timers.push(
      setTimeout(() => {
        setDecidingId(trail.leafId)
        setDone(true)
      }, t + 80),
    )

    return () => timers.forEach(clearTimeout)
  }, [trail])

  const revealedNodes = useMemo(
    () => new Set(trail.ids.slice(0, revealedNodeCount)),
    [trail.ids, revealedNodeCount],
  )
  const revealedEdges = useMemo(() => {
    const set = new Set()
    for (let i = 0; i < revealedEdgeCount; i++) {
      const s = trail.steps[i]
      if (s) set.add(`${s.fromId}-${s.toId}`)
    }
    return set
  }, [trail.steps, revealedEdgeCount])

  const edges = []
  const walk = node => {
    if (node.leaf) return
    const p = positions.get(node.id)
    for (const [child, side] of [
      [node.left, '≤'],
      [node.right, '>'],
    ]) {
      const c = positions.get(child.id)
      const edgeKey = `${node.id}-${child.id}`
      edges.push({
        key: edgeKey,
        x1: p.x,
        y1: p.y + 36,
        x2: c.x,
        y2: c.y - (child.leaf ? 20 : 36),
        onPath: revealedEdges.has(edgeKey),
        side,
        mx: (p.x + c.x) / 2,
        my: (p.y + 36 + c.y - 20) / 2,
      })
      walk(child)
    }
  }
  walk(LABEL_DECISION_TREE)

  const valueByFeature = Object.fromEntries(
    (path || []).map(s => [s.feature, s.value]),
  )

  return (
    <svg
      className="tree-svg"
      viewBox={`0 0 ${vbW} ${vbH}`}
      role="img"
      aria-label={`Ścieżka drzewa → ${LABEL_PL[label] || label}`}
      preserveAspectRatio="xMidYMid meet"
    >
      <defs>
        <filter id={glowId} x="-30%" y="-30%" width="160%" height="160%">
          <feDropShadow dx="0" dy="1" stdDeviation="1.6" floodOpacity="0.22" />
        </filter>
      </defs>

      {edges.map(e => {
        const d = `M ${padX + e.x1} ${padY + e.y1} C ${padX + e.x1} ${padY + e.y1 + 28}, ${padX + e.x2} ${padY + e.y2 - 28}, ${padX + e.x2} ${padY + e.y2}`
        return (
          <g key={e.key}>
            <path d={d} className="tree-edge" fill="none" />
            {e.onPath && (
              <path
                d={d}
                className="tree-edge on draw"
                fill="none"
                pathLength="1"
              />
            )}
            <text
              x={padX + e.mx}
              y={padY + e.my}
              textAnchor="middle"
              className={`tree-edge-label${e.onPath ? ' on' : ''}`}
            >
              {e.side}
            </text>
          </g>
        )
      })}

      {[...positions.values()].map(({ x, y, node, w }) => {
        const on = revealedNodes.has(node.id)
        const deciding = decidingId === node.id
        const px = padX + x
        const py = padY + y
        if (node.leaf) {
          const fill = TREE_LEAF_COLOR[node.leaf] || '#6b6560'
          return (
            <g
              key={node.id}
              className={`tree-node leaf${on ? ' on' : ''}${deciding ? ' deciding' : ''}${done && on ? ' final' : ''}`}
              filter={on ? `url(#${glowId})` : undefined}
            >
              <rect
                x={px - w / 2}
                y={py - 20}
                width={w}
                height={40}
                rx="10"
                fill={on ? fill : '#faf9f7'}
                stroke={on ? fill : '#d4d0ca'}
                strokeWidth={on ? 1.5 : 1}
              />
              <text
                x={px}
                y={py + 1}
                textAnchor="middle"
                dominantBaseline="central"
                fill={on ? '#fff' : '#8a847c'}
                className="tree-leaf-text"
              >
                {LABEL_PL[node.leaf] || node.leaf}
              </text>
            </g>
          )
        }

        const val = valueByFeature[node.feature]
        const showVal = on && val != null
        const thrText = showVal
          ? `próg ≤ ${formatPathValue(node.threshold)}  ·  jest ${formatPathValue(val)}`
          : `próg ≤ ${formatPathValue(node.threshold)}`
        return (
          <g
            key={node.id}
            className={`tree-node split${on ? ' on' : ''}${deciding ? ' deciding' : ''}`}
            filter={on ? `url(#${glowId})` : undefined}
          >
            <rect
              x={px - w / 2}
              y={py - 38}
              width={w}
              height={76}
              rx="12"
              fill={on ? '#1f1c19' : '#faf9f7'}
              stroke={on ? '#1f1c19' : '#d4d0ca'}
              strokeWidth={on ? 1.5 : 1}
            />
            <text
              x={px}
              y={py - 16}
              textAnchor="middle"
              fill={on ? '#f7f6f3' : '#2a2622'}
              className="tree-split-feat"
            >
              {node.title}
            </text>
            <text
              x={px}
              y={py + 2}
              textAnchor="middle"
              fill={on ? '#d4cfc8' : '#6b6560'}
              className="tree-split-sub"
            >
              {node.subtitle}
            </text>
            <text
              x={px}
              y={py + 22}
              textAnchor="middle"
              fill={on ? '#c8c4be' : '#8a847c'}
              className="tree-split-thr"
            >
              {thrText}
            </text>
          </g>
        )
      })}
    </svg>
  )
}

function TreePathOverlay({ path, label, cylinder, headerOffset, onClose }) {
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

  if (!path?.length) return null

  return (
    <div
      className="tree-overlay"
      style={{ top: headerOffset }}
      role="dialog"
      aria-modal="true"
      aria-label={`Drzewo decyzji — cylinder ${cylinder}`}
    >
      <div className="tree-overlay-bar">
        <button type="button" className="btn-back" onClick={onClose}>
          ← Zamknij
        </button>
      </div>
      <div className="tree-overlay-canvas">
        <DecisionTreeSvg path={path} label={label} />
      </div>
    </div>
  )
}

function CylinderDiagnosis({ engine, cylinder, headerOffset = 72 }) {
  const [showPath, setShowPath] = useState(false)
  const explainText = (cylinder.explanation?.text || '').replace(
    /^Cylinder\s+\d+\s*:\s*/i,
    '',
  )

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
          >
            Zobacz
          </button>
        </div>
      </div>
      {explainText && <p className="explain">{explainText}</p>}
      {showPath &&
        createPortal(
          <TreePathOverlay
            path={cylinder.decision_path}
            label={cylinder.label}
            cylinder={cylinder.cylinder}
            headerOffset={headerOffset}
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
  const padL = 34
  const padR = 12
  const padTop = 14
  const padBottom = 18
  const plotW = typeof width === 'number' ? width - padL - padR : 400
  const plotH = height - padTop - padBottom
  const med = engine?.healthy_median
  const color = SEVERITY_COLOR[cylinder.severity] || '#2d6a4f'
  const band = cylinder.explanation?.anomaly_band

  const cylVals = Array.from({ length: 21 }, (_, f) => Number(cylinder[`mV_${f}`]) || 0)
  const medVals = med
    ? Array.from({ length: 21 }, (_, f) => Number(med[`mV_${f}`]) || 0)
    : []
  const all = [...cylVals, ...medVals]
  const rawMin = Math.min(...all)
  const rawMax = Math.max(...all)
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

  const pts = cylVals.map((v, f) => `${toX(f)},${toY(v)}`)
  const medPts = medVals.length
    ? medVals.map((v, f) => `${toX(f)},${toY(v)}`).join(' L ')
    : null

  return (
    <svg
      viewBox={`0 0 ${padL + plotW + padR} ${height}`}
      className="chart"
      preserveAspectRatio="xMidYMid meet"
    >
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
      {band && cylinder.label !== 'ok' && band[1] >= band[0] && (
        <rect
          x={toX(band[0]) - 2}
          y={padTop}
          width={Math.max(toX(band[1]) - toX(band[0]) + 4, 6)}
          height={plotH}
          fill={`${color}22`}
        />
      )}
      {medPts && (
        <path
          d={`M ${medPts}`}
          fill="none"
          stroke={CHART_MEDIAN}
          strokeWidth="1.5"
          strokeDasharray="4 3"
        />
      )}
      <path
        d={`M ${pts.join(' L ')}`}
        fill="none"
        stroke={color}
        strokeWidth="2"
        strokeLinejoin="round"
      />
    </svg>
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
  const orderedCylinders = [...engine.cylinders].sort((a, b) => a.cylinder - b.cylinder)

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
        setSelectedEngineId(null)
        setEngineRect(null)
        setEngineClosing(false)
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

  const selectFactory = useCallback((id, rect) => {
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
        <MainHeader title={headerTitle} onAddClick={() => setAddOpen(true)} />
      </div>

      <main className="main main--grid-only">
        <section className="grid-pane">
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
        />
      )}
    </div>
  )
}

export default App
