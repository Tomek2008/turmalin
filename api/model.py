"""
Warstwa modelu diagnostycznego.

Label: drzewo względem baseline silnika (mean po cylindrach).
Severity: z L2 odchyłki (drzewo nie przewiduje severity).
"""

from __future__ import annotations

from collections import defaultdict
from typing import Any, Sequence

from .tree_model import (
    FREQ_BINS,
    build_features,
    engine_baseline,
    severity_from_l2,
    trace_label_tree,
)

# --- kontrakt hackathonu -------------------------------------------------

LABELS = ("ok", "zakoksowany", "lejacy", "pompa", "iglica", "unknown")
FAULT_LABELS = ("zakoksowany", "lejacy", "pompa", "iglica")
SEVERITIES_FAULT = ("male", "srednie", "duze")
SEVERITY_NA = "nie_dotyczy"

MODEL_NAME = "tree_baseline_v1"


def _coerce_spectrum(data: Sequence[float] | dict[str, Any]) -> list[float]:
    """Przyjmuje listę 21 wartości albo dict z kluczami mV_0…mV_20."""
    if isinstance(data, dict):
        spectrum = []
        for i in range(FREQ_BINS):
            key = f"mV_{i}"
            if key not in data:
                raise ValueError(f"Brak pola {key} w widmie")
            val = data[key]
            if val is None or val == "":
                raise ValueError(f"Puste {key} w widmie")
            spectrum.append(float(val))
        return spectrum

    spectrum = [float(x) for x in data]
    if len(spectrum) != FREQ_BINS:
        raise ValueError(
            f"Widmo musi mieć {FREQ_BINS} wartości (0–20 kHz), dostano {len(spectrum)}"
        )
    return spectrum


def _normalize_severity(label: str, severity: str | None) -> str:
    """Reguły hackathonu: ok/unknown → nie_dotyczy; usterki → male|srednie|duze."""
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


def _predict_with_baseline(
    spectrum: list[float],
    baseline: list[float],
    *,
    n_cylinders: int | None = None,
    engine_id: str | None = None,
    cylinder: int | None = None,
) -> dict[str, Any]:
    label, decision_path = trace_label_tree(spectrum, baseline)
    if label not in LABELS:
        raise ValueError(f"Model zwrócił nieznany label: {label!r}")
    feats = build_features(spectrum, baseline)
    severity = _normalize_severity(label, severity_from_l2(label, feats["l2"]))

    return {
        "engine_id": engine_id,
        "cylinder": cylinder,
        "n_cylinders": n_cylinders,
        **{f"mV_{i}": round(spectrum[i], 2) for i in range(FREQ_BINS)},
        "label": label,
        "severity": severity,
        "model": MODEL_NAME,
        "baseline": {f"mV_{i}": round(baseline[i], 2) for i in range(FREQ_BINS)},
        "features": {
            "l2": round(feats["l2"], 3),
            "dip_18": round(feats["dip_18"], 3),
            "sim_zakoksowany": round(feats["sim_zakoksowany"], 4),
            "sim_lejacy": round(feats["sim_lejacy"], 4),
            "sim_pompa": round(feats["sim_pompa"], 4),
            "sim_iglica": round(feats["sim_iglica"], 4),
        },
        "decision_path": decision_path,
    }


def predict(
    spectrum: Sequence[float] | dict[str, Any],
    *,
    n_cylinders: int | None = None,
    engine_id: str | None = None,
    cylinder: int | None = None,
    baseline: Sequence[float] | dict[str, Any] | None = None,
) -> dict[str, Any]:
    """
    Predykcja jednego cylindra.

    Bez `baseline` przyjmuje baseline = samo widmo (residual=0, L2=0) —
    pełny sens ma `predict_batch` po silniku.
    """
    values = _coerce_spectrum(spectrum)
    if baseline is None:
        base = list(values)
    else:
        base = _coerce_spectrum(baseline)
    return _predict_with_baseline(
        values,
        base,
        n_cylinders=n_cylinders,
        engine_id=engine_id,
        cylinder=cylinder,
    )


def predict_batch(
    rows: Sequence[dict[str, Any]],
) -> list[dict[str, Any]]:
    """
    Batch: grupuje po engine_id, baseline = mean widm silnika, potem drzewo.
    Wiersze bez engine_id liczone osobno (baseline = własne widmo).
    """
    indexed: list[tuple[int, dict[str, Any], list[float]]] = []
    for i, row in enumerate(rows):
        indexed.append((i, row, _row_spectrum(row)))

    by_engine: dict[Any, list[tuple[int, dict[str, Any], list[float]]]] = defaultdict(list)
    singles: list[tuple[int, dict[str, Any], list[float]]] = []
    for item in indexed:
        eid = item[1].get("engine_id")
        if eid is None or eid == "":
            singles.append(item)
        else:
            by_engine[eid].append(item)

    results: list[dict[str, Any] | None] = [None] * len(rows)

    for eid, group in by_engine.items():
        spectra = [spec for _, _, spec in group]
        baseline = engine_baseline(spectra)
        for idx, row, spec in group:
            results[idx] = _predict_with_baseline(
                spec,
                baseline,
                n_cylinders=row.get("n_cylinders"),
                engine_id=row.get("engine_id"),
                cylinder=row.get("cylinder"),
            )

    for idx, row, spec in singles:
        results[idx] = _predict_with_baseline(
            spec,
            list(spec),
            n_cylinders=row.get("n_cylinders"),
            engine_id=row.get("engine_id"),
            cylinder=row.get("cylinder"),
        )

    return [r for r in results if r is not None]
