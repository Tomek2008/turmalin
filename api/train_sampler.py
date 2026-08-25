"""Statyczny snapshot telemetrii z train.csv (bez okresowego przelosowywania)."""

from __future__ import annotations

import csv
import random
import threading
from datetime import datetime, timezone
from pathlib import Path

from .engine_ranking import rank_engines
from .models import Factory
DATA_DIR = Path(__file__).resolve().parent / "data"
TRAIN_CSV = DATA_DIR / "train.csv"
ALLOWED_N_CYLINDERS = frozenset({8, 12, 16})

FREQ_COLS = [f"mV_{i}" for i in range(21)]
TRAIN_ROW_FIELDS = ("engine_id", "cylinder", "n_cylinders", *FREQ_COLS)

LABEL_OK = "ok"
SEVERITY_ORDER = {"duze": 0, "srednie": 1, "male": 2, "nie_dotyczy": 3}

_lock = threading.Lock()
_snapshot: dict | None = None
_train_by_ncyl: dict[int, dict[str, list[dict]]] | None = None


def normalize_n_cylinders(n: int) -> int:
    n = int(n)
    if n not in ALLOWED_N_CYLINDERS:
        raise ValueError(
            f"n_cylinders must be one of {sorted(ALLOWED_N_CYLINDERS)}, got {n}"
        )
    return n


def _parse_float(raw: str) -> float | None:
    raw = (raw or "").strip()
    if not raw:
        return None
    try:
        return float(raw)
    except ValueError:
        return None


def _interpolate(values: list[float | None]) -> list[float]:
    out: list[float | None] = list(values)
    n = len(out)
    i = 0
    while i < n:
        if out[i] is not None:
            i += 1
            continue
        start = i - 1
        j = i
        while j < n and out[j] is None:
            j += 1
        end = j
        left = out[start] if start >= 0 else None
        right = out[end] if end < n else None
        gap = end - start - 1
        if gap <= 0:
            i += 1
            continue
        if left is not None and right is not None:
            for k, idx in enumerate(range(start + 1, end), start=1):
                out[idx] = left + (right - left) * k / (gap + 1)
        elif left is not None:
            for idx in range(start + 1, end):
                out[idx] = left
        elif right is not None:
            for idx in range(start + 1, end):
                out[idx] = right
        else:
            for idx in range(start + 1, end):
                out[idx] = 10.0
        i = end

    return [v if v is not None else 10.0 for v in out]


def _row_spectrum(row: dict) -> list[float]:
    return _interpolate([_parse_float(row.get(col, "")) for col in FREQ_COLS])


def _row_spectrum_raw(row: dict | None) -> list[float | None]:
    """Widmo bez interpolacji — GLRT maskuje luki."""
    if not row:
        return [None] * 21
    return [_parse_float(row.get(col, "")) for col in FREQ_COLS]


def _load_csv_rows(path: Path) -> list[dict]:
    for enc in ("utf-8-sig", "utf-8", "cp1250"):
        try:
            with path.open(newline="", encoding=enc) as fh:
                return list(csv.DictReader(fh))
        except UnicodeDecodeError:
            continue
    raise UnicodeDecodeError("utf-8", b"", 0, 1, str(path))


def _load_factory_csv_engines(factory) -> dict[str, list[dict]] | None:
    csv_file = getattr(factory, "csv_file", None)
    if not csv_file:
        return None
    try:
        path = Path(csv_file.path)
    except (ValueError, OSError):
        return None
    if not path.exists():
        return None
    by_eid: dict[str, list[dict]] = {}
    for row in _load_csv_rows(path):
        eid = (row.get("engine_id") or "").strip()
        if not eid:
            continue
        by_eid.setdefault(eid, []).append(row)
    return by_eid or None


def _pick_csv_rows_for_demo(
    demo_engine_id: str,
    n_cyl: int,
    own_csv: dict[str, list[dict]],
    used_csv_ids: set[str],
) -> list[dict] | None:
    """Dobierz widma z CSV zakładu: najpierw po engine_id, potem wolny silnik o tym samym n_cylinders."""
    exact = own_csv.get(demo_engine_id)
    if exact and demo_engine_id not in used_csv_ids:
        used_csv_ids.add(demo_engine_id)
        return sorted(exact, key=lambda r: int(r["cylinder"]))

    for eid, rows in own_csv.items():
        if eid in used_csv_ids or not rows:
            continue
        try:
            row_n = int(float(rows[0].get("n_cylinders") or 0))
        except ValueError:
            continue
        if row_n != n_cyl:
            continue
        used_csv_ids.add(eid)
        return sorted(rows, key=lambda r: int(r["cylinder"]))
    return None


def _ensure_datasets():
    global _train_by_ncyl
    if _train_by_ncyl is not None:
        return

    if not TRAIN_CSV.exists():
        raise FileNotFoundError(
            f"Brak {TRAIN_CSV}. Pobierz train.csv z hackathon-engin."
        )

    by_ncyl: dict[int, dict[str, list[dict]]] = {8: {}, 12: {}, 16: {}}
    for row in _load_csv_rows(TRAIN_CSV):
        n = int(row["n_cylinders"])
        eid = row["engine_id"]
        by_ncyl.setdefault(n, {}).setdefault(eid, []).append(row)
    _train_by_ncyl = by_ncyl


def _engine_status(cylinders: list[dict]) -> tuple[str, str, int]:
    from .views import _engine_status as views_engine_status

    return views_engine_status(cylinders)


def _median_spectrum(cylinders: list[dict]) -> list[float]:
    med = []
    for f in range(21):
        vals = sorted(
            c[f"mV_{f}"]
            for c in cylinders
            if c.get(f"mV_{f}") is not None
        )
        n = len(vals)
        med.append(vals[n // 2] if n else 10.0)
    return med


def _healthy_median_dict(labeled: list[dict]) -> dict:
    """Mediana widma zdrowych cylindrów — per silnik."""
    healthy = [c for c in labeled if c.get("label") == LABEL_OK]
    median = _median_spectrum(healthy if healthy else labeled)
    return {f"mV_{f}": round(median[f], 2) for f in range(21)}


def _train_row_from_csv(
    csv_row: dict | None,
    *,
    engine_id: str,
    cylinder: int,
    n_cylinders: int,
) -> dict:
    """Dokładnie kolumny train.csv — puste mV → null."""
    out: dict = {
        "engine_id": engine_id,
        "cylinder": int(cylinder),
        "n_cylinders": int(n_cylinders),
    }
    for col in FREQ_COLS:
        raw = csv_row.get(col, "") if csv_row else ""
        val = _parse_float(raw)
        out[col] = round(val, 2) if val is not None else None
    return out


def _cylinder_row(
    *,
    engine_id: str,
    cylinder: int,
    n_cylinders: int,
    spectrum: list[float],
    label: str,
    severity: str,
) -> dict:
    """Wiersz wewnętrzny (train + label/severity do rankingu statusu)."""
    return {
        "engine_id": engine_id,
        "cylinder": cylinder,
        "n_cylinders": n_cylinders,
        **{f"mV_{f}": round(spectrum[f], 2) for f in range(21)},
        "label": label,
        "severity": severity,
    }


def _build_engine_from_train(engine_id: str, rows: list[dict], n_cylinders: int) -> dict:
    """
    Silnik ze snapshotu train.csv.
    cylinders w odpowiedzi = tylko kolumny train.csv.
    label/severity liczone wewnątrz (status zakładu), nie trafiają do API.
    """
    from .model import predict_batch

    n = normalize_n_cylinders(n_cylinders)
    by_cyl = {int(r["cylinder"]): r for r in rows}

    train_cylinders = []
    batch_items = []
    for cyl in range(1, n + 1):
        csv_row = by_cyl.get(cyl)
        train_row = _train_row_from_csv(
            csv_row, engine_id=engine_id, cylinder=cyl, n_cylinders=n
        )
        train_cylinders.append(train_row)

        spectrum = _row_spectrum_raw(csv_row)
        batch_items.append(
            {
                "spectrum": spectrum,
                "engine_id": engine_id,
                "cylinder": cyl,
                "n_cylinders": n,
            }
        )

    preds = predict_batch(batch_items)
    labeled = []
    for item, pred in zip(batch_items, preds):
        labeled.append(
            _cylinder_row(
                engine_id=engine_id,
                cylinder=item["cylinder"],
                n_cylinders=n,
                spectrum=_interpolate(item["spectrum"]),
                label=pred["label"],
                severity=pred["severity"],
            )
        )

    status, color, intervention = _engine_status(labeled)
    from .views import _cylinder_severity_counts

    return {
        "engine_id": engine_id,
        "n_cylinders": n,
        "layout": f"V{n}",
        "status": status,
        "status_color": color,
        "intervention_count": intervention,
        "healthy_median": _healthy_median_dict(labeled),
        "severity_counts": _cylinder_severity_counts(labeled),
        "cylinders": labeled,
        "_train_cylinders": train_cylinders,
    }


def _factory_worst_status(engines: list[dict]) -> tuple[str, int]:
    if not engines:
        return "ok", 0
    counts = sum(e["intervention_count"] for e in engines)
    colors = [e["status_color"] for e in engines]
    if "#b42318" in colors:
        return "alarm", counts
    if "#9a6700" in colors or "#7a6520" in colors:
        return "uwaga", counts
    return "ok", counts


def _refresh_snapshot():
    global _snapshot
    _ensure_datasets()

    generated_at = datetime.now(timezone.utc)
    factories_payload: dict[str, dict] = {}

    for factory in Factory.objects.filter(is_active=True).prefetch_related("demo_engines"):
        engines_out = []
        used_train_ids: set[str] = set()
        own_csv = _load_factory_csv_engines(factory)
        used_csv_ids: set[str] = set()
        rng = random.Random(f"turmalin:{factory.slug}")

        for demo in factory.demo_engines.all():
            n_cyl = normalize_n_cylinders(demo.n_cylinders)
            if own_csv is not None:
                rows = _pick_csv_rows_for_demo(
                    demo.engine_id, n_cyl, own_csv, used_csv_ids
                )
                if not rows:
                    continue
                engines_out.append(
                    _build_engine_from_train(demo.engine_id, rows, n_cyl)
                )
                continue

            pool = _train_by_ncyl.get(n_cyl, {})
            if not pool:
                continue
            candidates = [eid for eid in pool if eid not in used_train_ids] or list(pool)
            train_id = rng.choice(sorted(candidates))
            used_train_ids.add(train_id)
            rows = sorted(pool[train_id], key=lambda r: int(r["cylinder"]))
            engines_out.append(_build_engine_from_train(demo.engine_id, rows, n_cyl))

        engines_out = rank_engines(engines_out)
        for eng in engines_out:
            eng["cylinders"] = eng.pop("_train_cylinders")

        status_key, anomaly_count = _factory_worst_status(engines_out)
        factories_payload[factory.slug] = {
            "engines": engines_out,
            "status_key": status_key,
            "anomaly_count": anomaly_count,
            "engine_count": len(engines_out),
        }

    _snapshot = {
        "generated_at": generated_at,
        "factories": factories_payload,
    }


def get_factory_snapshot(factory_slug: str) -> dict | None:
    """Zwraca wpis snapshotu dla zakładu (budowany raz, stały)."""
    global _snapshot
    with _lock:
        if _snapshot is None:
            _refresh_snapshot()
        return _snapshot["factories"].get(factory_slug)


def get_all_factories_snapshot() -> tuple[dict[str, dict], datetime]:
    with _lock:
        if _snapshot is None:
            _refresh_snapshot()
        assert _snapshot is not None
        return _snapshot["factories"], _snapshot["generated_at"]


def get_snapshot_generated_at() -> datetime:
    _, generated_at = get_all_factories_snapshot()
    return generated_at


def invalidate_snapshot():
    """Wyczyść cache (np. po dodaniu zakładu w adminie)."""
    global _snapshot
    with _lock:
        _snapshot = None
