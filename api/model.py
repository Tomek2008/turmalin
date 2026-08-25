"""
Warstwa modelu diagnostycznego: widmowy GLRT (backend/glrt_serve.py).

Label + severity + łańcuch decyzji (detekcja → kształt → unknown → nasilenie)
z dopasowania szablonu usterki do residuum względem profilu silnika.
Luki w widmie zostają NaN — model je maskuje, nie interpoluje.
"""

from __future__ import annotations

import sys
import threading
from pathlib import Path
from typing import Any, Sequence

import numpy as np
import pandas as pd

_BACKEND_DIR = Path(__file__).resolve().parent.parent / "backend"
if str(_BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(_BACKEND_DIR))

from glrt_serve import load as load_glrt  # noqa: E402
from glrt_serve import predict as glrt_predict  # noqa: E402

FREQ_BINS = 21

LABELS = ("ok", "zakoksowany", "lejacy", "pompa", "iglica", "unknown")
SEVERITIES_FAULT = ("male", "srednie", "duze")
SEVERITY_NA = "nie_dotyczy"

MODEL_NAME = "spectral_glrt"

_lock = threading.Lock()
_model = None


def _get_model():
    global _model
    if _model is None:
        with _lock:
            if _model is None:
                _model = load_glrt()
    return _model


def _to_bin(val: Any) -> float:
    if val is None or val == "":
        return float("nan")
    try:
        v = float(val)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"Niepoprawna wartość w widmie: {val!r}") from exc
    return v if np.isfinite(v) else float("nan")


def _coerce_spectrum(data: Sequence[Any] | dict[str, Any]) -> list[float]:
    """Lista 21 wartości albo dict mV_0…mV_20. Braki → NaN."""
    if isinstance(data, dict):
        spectrum = []
        for i in range(FREQ_BINS):
            key = f"mV_{i}"
            if key not in data:
                spectrum.append(float("nan"))
            else:
                spectrum.append(_to_bin(data[key]))
        return spectrum

    spectrum = [_to_bin(x) for x in data]
    if len(spectrum) < FREQ_BINS:
        spectrum.extend([float("nan")] * (FREQ_BINS - len(spectrum)))
    return spectrum[:FREQ_BINS]


def _normalize_severity(label: str, severity: str | None) -> str:
    if label in ("ok", "unknown"):
        return SEVERITY_NA
    if severity in SEVERITIES_FAULT:
        return severity
    return "srednie"


def _row_spectrum(row: dict[str, Any]) -> list[float]:
    spectrum = row.get("spectrum")
    if spectrum is None:
        spectrum = {k: row[k] for k in row if str(k).startswith("mV_")}
    return _coerce_spectrum(spectrum)


def _rows_to_frame(rows: Sequence[dict[str, Any]]) -> pd.DataFrame:
    records = []
    for i, row in enumerate(rows):
        eid = row.get("engine_id")
        rec = {
            "engine_id": str(eid) if eid not in (None, "") else f"_single_{i}",
            "cylinder": int(row.get("cylinder") or 1),
        }
        for j, val in enumerate(_row_spectrum(row)):
            rec[f"mV_{j}"] = val
        records.append(rec)
    return pd.DataFrame.from_records(records)


def _api_row(src: dict[str, Any], row: dict[str, Any]) -> dict[str, Any]:
    label = src["label"]
    if label not in LABELS:
        raise ValueError(f"Model zwrócił nieznany label: {label!r}")
    severity = _normalize_severity(label, src.get("severity"))
    spectrum = src.get("spectrum_mV") or [None] * FREQ_BINS
    out = {
        "engine_id": row.get("engine_id"),
        "cylinder": row.get("cylinder"),
        "n_cylinders": row.get("n_cylinders"),
        "label": label,
        "severity": severity,
        "model": MODEL_NAME,
        "amplituda_mV": src.get("amplituda_mV"),
        "istotnosc_sigma": src.get("istotnosc_sigma"),
        "chi_dopasowania": src.get("chi_dopasowania"),
        "szablon": src.get("szablon"),
        "decision": src.get("decision") or [],
        "highlight_khz": src.get("highlight_khz") or [],
        "profile_mV": src.get("profile_mV"),
        "residual_mV": src.get("residual_mV"),
        "fitted_fault_mV": src.get("fitted_fault_mV"),
    }
    for i, val in enumerate(spectrum):
        out[f"mV_{i}"] = None if val is None else round(float(val), 2)
    return out


def predict(
    spectrum: Sequence[Any] | dict[str, Any],
    *,
    n_cylinders: int | None = None,
    engine_id: str | None = None,
    cylinder: int | None = None,
    baseline: Sequence[Any] | dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Predykcja jednego cylindra. Bez reszty silnika baseline = własne widmo."""
    del baseline  # profil liczy GLRT z cylindrów tej samej jednostki
    return predict_batch(
        [
            {
                "spectrum": spectrum,
                "n_cylinders": n_cylinders,
                "engine_id": engine_id,
                "cylinder": cylinder,
            }
        ]
    )[0]


def predict_batch(rows: Sequence[dict[str, Any]]) -> list[dict[str, Any]]:
    """Batch: GLRT liczy profil per engine_id, potem szablon usterki."""
    if not rows:
        return []
    df = _rows_to_frame(rows)
    payload = glrt_predict(df, model=_get_model())
    cylinders = payload.get("cylinders") or []
    if len(cylinders) != len(rows):
        raise ValueError("GLRT zwrócił inną liczbę cylindrów niż wejście")
    return [_api_row(src, row) for src, row in zip(cylinders, rows)]
