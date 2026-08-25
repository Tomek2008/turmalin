"""Ranking jednostek od najgorszej do najlepszej (wynik modelu diagnostycznego)."""

LABEL_OK = "ok"
SEVERITY_ORDER = {"duze": 0, "srednie": 1, "male": 2, "nie_dotyczy": 3}


def engine_health_score(engine: dict) -> int:
    """Niższy wynik = gorszy stan silnika."""
    cylinders = engine.get("cylinders") or []
    bad = [c for c in cylinders if c.get("label") != LABEL_OK]
    if not bad:
        return 10_000
    worst = min(SEVERITY_ORDER.get(c["severity"], 9) for c in bad)
    return worst * 1000 + (len(cylinders) - len(bad))


def rank_engines(engines: list[dict]) -> list[dict]:
    """Sortuje od najgorszego i dodaje health_rank (1 = najgorszy)."""
    ranked = sorted(engines, key=engine_health_score)
    for i, eng in enumerate(ranked):
        eng["health_rank"] = i + 1
        eng["health_score"] = engine_health_score(eng)
    return ranked
