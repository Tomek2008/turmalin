"""
Drzewo decyzyjne (label) — featury względem baseline silnika = mean po cylindrach.

Cechy:
  residual_k     = mV_k − baseline_k
  l2             = ‖spectrum − baseline‖₂
  sim_<fault>    = cosine(spectrum, wzorzec_klasy)  — wzorce = mean z val.csv
  dip_18         = ((mV_17 + mV_19) / 2) − mV_18
"""

from __future__ import annotations

import csv
import math
from pathlib import Path
from typing import Sequence

FREQ_BINS = 21
FAULT_PATTERNS = ("zakoksowany", "lejacy", "pompa", "iglica")
VAL_CSV = Path(__file__).resolve().parent / "data" / "val.csv"

_templates: dict[str, list[float]] | None = None


def _mean_vec(rows: list[list[float]]) -> list[float]:
    n = len(rows)
    if n == 0:
        return [10.0] * FREQ_BINS
    return [sum(r[i] for r in rows) / n for i in range(FREQ_BINS)]


def _parse_spectrum(row: dict) -> list[float] | None:
    vals: list[float] = []
    for i in range(FREQ_BINS):
        raw = (row.get(f"mV_{i}") or "").strip()
        if not raw:
            return None
        try:
            vals.append(float(raw))
        except ValueError:
            return None
    return vals


def _load_templates() -> dict[str, list[float]]:
    """Wzorce wad = średnie widma klas z val.csv (frozen na inferencji)."""
    global _templates
    if _templates is not None:
        return _templates

    by_label: dict[str, list[list[float]]] = {k: [] for k in FAULT_PATTERNS}
    if VAL_CSV.exists():
        with VAL_CSV.open(newline="", encoding="utf-8") as fh:
            for row in csv.DictReader(fh):
                label = (row.get("label") or "").strip()
                if label not in by_label:
                    continue
                spec = _parse_spectrum(row)
                if spec:
                    by_label[label].append(spec)

    _templates = {k: _mean_vec(v) for k, v in by_label.items()}
    # Fallback gdy brak val — płaskie wzorce (sim ≈ 0 względem typowego widma)
    for k in FAULT_PATTERNS:
        if not any(abs(x - 10.0) > 1e-9 for x in _templates[k]):
            # lekko zróżnicowany kształt, żeby cosine nie był NaN
            _templates[k] = [10.0 + (i - 10) * 0.5 for i in range(FREQ_BINS)]
    return _templates


def engine_baseline(spectra: Sequence[Sequence[float]]) -> list[float]:
    """Baseline silnika = mean po cylindrach (per bin)."""
    return _mean_vec([list(s) for s in spectra])


def _l2(a: Sequence[float], b: Sequence[float]) -> float:
    return math.sqrt(sum((float(x) - float(y)) ** 2 for x, y in zip(a, b)))


def _cosine(a: Sequence[float], b: Sequence[float]) -> float:
    dot = sum(float(x) * float(y) for x, y in zip(a, b))
    na = math.sqrt(sum(float(x) ** 2 for x in a))
    nb = math.sqrt(sum(float(y) ** 2 for y in b))
    if na < 1e-12 or nb < 1e-12:
        return 0.0
    return dot / (na * nb)


def _dip_18(spectrum: Sequence[float]) -> float:
    """Dołek przy 18 kHz: średnia sąsiadów minus mV_18."""
    return (float(spectrum[17]) + float(spectrum[19])) / 2.0 - float(spectrum[18])


def build_features(spectrum: Sequence[float], baseline: Sequence[float]) -> dict[str, float]:
    templates = _load_templates()
    residual = [float(spectrum[i]) - float(baseline[i]) for i in range(FREQ_BINS)]
    feats: dict[str, float] = {
        f"residual_{i}": residual[i] for i in range(FREQ_BINS)
    }
    feats["l2"] = _l2(spectrum, baseline)
    feats["dip_18"] = _dip_18(spectrum)
    for name in FAULT_PATTERNS:
        feats[f"sim_{name}"] = _cosine(spectrum, templates[name])
    return feats


FEATURE_LABELS_PL = {
    "residual_0": "residual 0 kHz vs baseline",
    "residual_2": "residual 2 kHz vs baseline",
    "residual_9": "residual 9 kHz vs baseline",
    "residual_11": "residual 11 kHz vs baseline",
    "residual_13": "residual 13 kHz vs baseline",
    "residual_16": "residual 16 kHz vs baseline",
    "l2": "odchyłka L2 od profilu silnika",
    "dip_18": "dołek przy 18 kHz",
    "sim_zakoksowany": "podobieństwo do wzorca: zakoksowany",
    "sim_lejacy": "podobieństwo do wzorca: lejący",
    "sim_pompa": "podobieństwo do wzorca: pompa",
    "sim_iglica": "podobieństwo do wzorca: iglica",
}


def _step(feats: dict[str, float], feature: str, op: str, threshold: float) -> dict:
    value = float(feats[feature])
    if op == "<=":
        taken = value <= threshold
        branch = "<=" if taken else ">"
    else:
        taken = value > threshold
        branch = ">" if taken else "<="
    return {
        "feature": feature,
        "feature_label": FEATURE_LABELS_PL.get(feature, feature),
        "op": op,
        "threshold": threshold,
        "value": round(value, 4),
        "taken": taken,
        "branch": branch,
    }


def trace_label_tree(spectrum: Sequence[float], baseline: Sequence[float]) -> tuple[str, list[dict]]:
    """
    Przechodzi drzewo jak predict_label_tree, zwraca (label, ścieżka decyzji).
    Każdy krok: cecha, próg, wartość, wybraną gałąź.
    """
    f = build_features(spectrum, baseline)
    path: list[dict] = []

    path.append(_step(f, "residual_9", "<=", -8.43))
    if f["residual_9"] <= -8.43:
        path.append(_step(f, "sim_zakoksowany", "<=", 0.81))
        if f["sim_zakoksowany"] <= 0.81:
            path.append(_step(f, "sim_lejacy", "<=", 0.98))
            if f["sim_lejacy"] <= 0.98:
                path.append(_step(f, "sim_iglica", "<=", 0.93))
                if f["sim_iglica"] <= 0.93:
                    path.append(_step(f, "sim_pompa", "<=", 0.88))
                    if f["sim_pompa"] <= 0.88:
                        path.append(_step(f, "l2", "<=", 41.81))
                        if f["l2"] <= 41.81:
                            return "ok", path
                        return "unknown", path
                    return "pompa", path
                return "iglica", path
            return "lejacy", path
        return "zakoksowany", path

    path.append(_step(f, "l2", "<=", 34.02))
    if f["l2"] <= 34.02:
        path.append(_step(f, "residual_13", "<=", -7.34))
        if f["residual_13"] <= -7.34:
            path.append(_step(f, "residual_0", "<=", -2.46))
            if f["residual_0"] <= -2.46:
                return "ok", path
            return "pompa", path
        # residual_13 > -7.34 — w oryginalnym CatBoost dalsze splity
        # (residual_16 / residual_11 / residual_2) miały wszystkie liście = ok
        return "ok", path

    return "unknown", path


def predict_label_tree(spectrum: Sequence[float], baseline: Sequence[float]) -> str:
    """
    Drzewo z ekspozycji CatBoost / print_tree — tylko class (label).
    """
    label, _ = trace_label_tree(spectrum, baseline)
    return label


def severity_from_l2(label: str, l2: float) -> str | None:
    """Prosta severity z L2 (drzewo nie przewiduje severity)."""
    if label in ("ok", "unknown"):
        return "nie_dotyczy"
    if l2 <= 25:
        return "male"
    if l2 <= 40:
        return "srednie"
    return "duze"
