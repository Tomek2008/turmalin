from django.utils import timezone
from rest_framework.response import Response
from rest_framework.decorators import api_view, authentication_classes, permission_classes
from rest_framework.permissions import AllowAny

from .engine_ranking import rank_engines
from .models import Factory
from .train_sampler import (
    get_all_factories_snapshot,
    get_factory_snapshot,
    normalize_n_cylinders,
)

LABEL_OK = "ok"
SEVERITY_ORDER = {"duze": 0, "srednie": 1, "male": 2, "nie_dotyczy": 3}

STATUS_MAP = {"ok": "Sprawny", "uwaga": "Uwaga", "alarm": "Alarm"}


def _engines_for_factory(factory):
    snap = get_factory_snapshot(factory.slug)
    if snap and snap.get("engines"):
        return snap["engines"]
    engines = [_build_engine(e.to_spec()) for e in factory.demo_engines.all()]
    engines = rank_engines(engines)
    for eng in engines:
        eng["cylinders"] = eng.pop("_train_cylinders")
    return engines


def _get_factory_or_none(slug):
    return (
        Factory.objects.filter(slug=slug, is_active=True)
        .prefetch_related("demo_engines")
        .first()
    )


def _seeded_noise(engine_id, cyl, freq, lo=7.0, hi=13.5):
    """Deterministyczny szum - fallback gdy brak train.csv."""
    h = hash((engine_id, cyl, freq, 0xAE57)) & 0xFFFFFFFF
    t = (h % 10000) / 10000.0
    return lo + t * (hi - lo)


def _spectrum_ok(engine_id, cyl):
    return [_seeded_noise(engine_id, cyl, f) for f in range(21)]


def _explain(label, severity, cyl, spectrum, healthy_median, band):
    b0, b1 = band
    band_vals = spectrum[b0 : b1 + 1]
    med_vals = healthy_median[b0 : b1 + 1]
    amp = sum(band_vals) / max(len(band_vals), 1)
    med = sum(med_vals) / max(len(med_vals), 1)
    ratio = round(amp / med, 1) if med > 0.1 else 1.0

    reasons = {
        "zakoksowany": f"podwyższona energia w niskim paśmie {b0}-{b1} kHz",
        "lejacy": f"płaskie podwyższenie widma w paśmie {b0}-{b1} kHz",
        "pompa": f"lokalny spike w paśmie środkowym {b0}-{b1} kHz",
        "iglica": f"ostry pik w paśmie {b0}-{b1} kHz",
        "unknown": f"nietypowy kształt widma w paśmie {b0}-{b1} kHz",
        "ok": "widmo zgodne z medianą zdrowych cylindrów jednostki",
    }
    reason = reasons.get(label, reasons["unknown"])
    sev_pl = {"male": "małe", "srednie": "średnie", "duze": "duże", "nie_dotyczy": "nie dotyczy"}
    sev_txt = sev_pl.get(severity, severity)

    if label == LABEL_OK:
        text = f"Cylinder {cyl}: ok - {reason}."
    else:
        text = (
            f"Cylinder {cyl}: {label} / {sev_txt} - {reason}; "
            f"amplituda w {b0}-{b1} kHz ok. {ratio}× wyższa niż mediana OK w jednostce."
        )

    return {
        "anomaly_band": [b0, b1],
        "ratio_vs_median": ratio,
        "text": text,
        "rule": reason,
    }


def _anomaly_band(spectrum, healthy_median):
    ratios = []
    for f, val in enumerate(spectrum):
        med = healthy_median[f]
        ratios.append((f, val / med if med > 0.5 else 1.0))
    ratios.sort(key=lambda x: x[1], reverse=True)
    peak = ratios[0][0]
    return max(0, peak - 2), min(20, peak + 3)


def _median_spectrum(cylinders):
    med = []
    for f in range(21):
        vals = sorted(c[f"mV_{f}"] for c in cylinders)
        n = len(vals)
        med.append(vals[n // 2] if n else 10.0)
    return med


def _engine_status(cylinders):
    bad = [c for c in cylinders if c["label"] != LABEL_OK]
    n = len(bad)
    worst = min((SEVERITY_ORDER.get(c["severity"], 9) for c in bad), default=9)
    if n == 0:
        return "Sprawny", "#2d6a4f", 0
    if worst == 0:
        return f"{n}/{len(cylinders)} cylindrów - interwencja", "#b42318", n
    if worst == 1:
        return f"{n}/{len(cylinders)} cylindrów - uwagi", "#9a6700", n
    return f"{n}/{len(cylinders)} cylindrów - monitoring", "#7a6520", n


def _cylinder_row(*, engine_id, cylinder, n_cylinders, spectrum, label, severity):
    """Wiersz wewnętrzny (widmo + label) — do rankingu; API dostaje train-only."""
    return {
        "engine_id": engine_id,
        "cylinder": cylinder,
        "n_cylinders": n_cylinders,
        **{f"mV_{f}": round(spectrum[f], 2) for f in range(21)},
        "label": label,
        "severity": severity,
    }


def _build_engine(spec):
    """Fallback: szum + predict_batch (baseline = mean) → status; cylinders = train."""
    from .model import predict_batch

    engine_id = spec["engine_id"]
    n = normalize_n_cylinders(spec["n_cylinders"])

    train_cylinders = []
    batch_items = []
    for cyl in range(1, n + 1):
        spectrum = _spectrum_ok(engine_id, cyl)
        train_cylinders.append(
            {
                "engine_id": engine_id,
                "cylinder": cyl,
                "n_cylinders": n,
                **{f"mV_{f}": round(spectrum[f], 2) for f in range(21)},
            }
        )
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
                spectrum=item["spectrum"],
                label=pred["label"],
                severity=pred["severity"],
            )
        )

    status, color, intervention = _engine_status(labeled)
    healthy = [c for c in labeled if c["label"] == LABEL_OK]
    median_src = healthy if healthy else labeled
    median = []
    for f in range(21):
        vals = sorted(c[f"mV_{f}"] for c in median_src)
        median.append(vals[len(vals) // 2] if vals else 10.0)

    return {
        "engine_id": engine_id,
        "n_cylinders": n,
        "layout": f"V{n}",
        "status": status,
        "status_color": color,
        "intervention_count": intervention,
        "healthy_median": {f"mV_{f}": round(median[f], 2) for f in range(21)},
        "severity_counts": _cylinder_severity_counts(labeled),
        "cylinders": labeled,
        "_train_cylinders": train_cylinders,
    }


def _factory_worst_status(engines):
    if not engines:
        return "ok", 0
    counts = sum(e["intervention_count"] for e in engines)
    colors = [e["status_color"] for e in engines]
    if "#b42318" in colors:
        return "alarm", counts
    if "#9a6700" in colors or "#7a6520" in colors:
        return "uwaga", counts
    return "ok", counts


def _cylinder_severity_counts(cylinders):
    """Liczniki usterek po severity (tylko male/srednie/duze — bez OK)."""
    counts = {"duze": 0, "srednie": 0, "male": 0}
    for c in cylinders or []:
        if c.get("label") == LABEL_OK:
            continue
        sev = c.get("severity")
        if sev in counts:
            counts[sev] += 1
    return counts


def _engines_preview(engines):
    """Lekki podgląd silników na kartę zakładu (bez widm)."""
    preview = []
    for e in engines:
        sev_counts = e.get("severity_counts")
        if not sev_counts:
            sev_counts = _cylinder_severity_counts(e.get("cylinders"))
        preview.append(
            {
                "engine_id": e["engine_id"],
                "n_cylinders": e["n_cylinders"],
                "layout": e.get("layout") or f"V{e['n_cylinders']}",
                "status": e.get("status") or "Sprawny",
                "status_color": e.get("status_color") or "#2d6a4f",
                "intervention_count": e.get("intervention_count") or 0,
                "health_rank": e.get("health_rank"),
                "severity_counts": {
                    "duze": int(sev_counts.get("duze") or 0),
                    "srednie": int(sev_counts.get("srednie") or 0),
                    "male": int(sev_counts.get("male") or 0),
                },
            }
        )
    return preview


@api_view(["GET", "POST"])
@authentication_classes([])
@permission_classes([AllowAny])
def get_factories(request):
    if request.method == "POST":
        return _create_factory_from_upload(request)

    snapshots, _ = get_all_factories_snapshot()
    response_data = []
    for factory in Factory.objects.filter(is_active=True).prefetch_related("demo_engines"):
        snap = snapshots.get(factory.slug)
        if snap:
            status_key = snap["status_key"]
            anomaly_count = snap["anomaly_count"]
            engine_count = snap["engine_count"]
            engines = _engines_preview(snap.get("engines") or [])
        else:
            engines_full = _engines_for_factory(factory)
            status_key, anomaly_count = _factory_worst_status(engines_full)
            engine_count = len(engines_full)
            engines = _engines_preview(engines_full)
        response_data.append(
            factory.to_api_dict(
                status=STATUS_MAP[status_key],
                status_key=status_key,
                anomaly_count=anomaly_count,
                engine_count=engine_count,
                engines=engines,
            )
        )
    return Response(response_data)


def _create_factory_from_upload(request):
    """POST multipart: name, csv_file (+ opcjonalnie address, description, slug, image)."""
    from django.core.exceptions import ValidationError

    from .csv_import import CSV_FORMAT_HELP, create_factory_from_csv
    from .train_sampler import invalidate_snapshot

    name = (request.data.get("name") or "").strip()
    csv_file = request.FILES.get("csv_file") or request.FILES.get("csv")
    image_file = request.FILES.get("image") or request.FILES.get("image_file")
    if not name:
        return Response({"error": "Podaj nazwę zakładu."}, status=400)
    if not csv_file:
        return Response(
            {"error": "Dołącz plik CSV. " + CSV_FORMAT_HELP},
            status=400,
        )

    try:
        factory, n_engines = create_factory_from_csv(
            name=name,
            uploaded=csv_file,
            slug=(request.data.get("slug") or "").strip(),
            address=(request.data.get("address") or "").strip(),
            description=(request.data.get("description") or "").strip(),
            image=image_file,
        )
    except ValidationError as exc:
        msg = exc.messages[0] if getattr(exc, "messages", None) else str(exc)
        return Response({"error": msg}, status=400)
    except Exception as exc:
        return Response({"error": str(exc)}, status=400)

    invalidate_snapshot()
    snapshots, _ = get_all_factories_snapshot()
    snap = snapshots.get(factory.slug) or {}
    engines = _engines_preview(snap.get("engines") or [])
    payload = factory.to_api_dict(
        status=STATUS_MAP.get(snap.get("status_key"), STATUS_MAP["ok"]),
        status_key=snap.get("status_key") or "ok",
        anomaly_count=snap.get("anomaly_count") or 0,
        engine_count=snap.get("engine_count") or n_engines,
        engines=engines,
    )
    payload["engine_count_created"] = n_engines
    return Response(payload, status=201)


@api_view(["GET"])
def get_factory_detail(request, factory_id):
    """Szczegóły zakładu + silniki z widmami train (bez osobnego /telemetry/)."""
    from .train_sampler import get_snapshot_generated_at

    factory = _get_factory_or_none(factory_id)
    if not factory:
        return Response({"error": "Nie znaleziono zakładu"}, status=404)

    engines = _engines_for_factory(factory)
    snap = get_factory_snapshot(factory.slug)
    if snap:
        status_key = snap["status_key"]
        anomaly_count = snap["anomaly_count"]
        engine_count = snap["engine_count"]
        generated_at = get_snapshot_generated_at().isoformat()
    else:
        status_key, anomaly_count = _factory_worst_status(engines)
        engine_count = len(engines)
        generated_at = timezone.now().isoformat()

    payload = factory.to_api_dict(
        status=STATUS_MAP[status_key],
        status_key=status_key,
        anomaly_count=anomaly_count,
        engine_count=engine_count,
        engines=engines,
    )
    payload.update(
        {
            "factory_id": factory.slug,
            "factory_name": factory.name,
            "info": factory.description,
            "generated_at": generated_at,
            "source": "train",
        }
    )
    return Response(payload)


@api_view(["POST"])
@authentication_classes([])
@permission_classes([AllowAny])
def predict_label(request):
    """
    Predykcja etykiety GLRT dla widma cylindra.

    Body (JSON), jedna z form:
      { "spectrum": [mV_0, …, mV_20], "n_cylinders"?, "engine_id"?, "cylinder"? }
      { "mV_0": …, "mV_20": …, ... }

    Batch (preferowany — profil silnika z wszystkich cylindrów jednostki):
      { "items": [ {…}, {…} ] }

    Luki (null) zostaw puste — model je maskuje.
    """
    from .model import predict, predict_batch

    body = request.data
    if not isinstance(body, dict):
        return Response({"error": "Oczekiwano JSON object"}, status=400)

    try:
        if "items" in body:
            if not isinstance(body["items"], list):
                return Response({"error": "items musi być listą"}, status=400)
            return Response({"predictions": predict_batch(body["items"])})

        spectrum = body.get("spectrum")
        if spectrum is None:
            spectrum = {k: body[k] for k in body if str(k).startswith("mV_")}
        if not spectrum:
            return Response(
                {"error": "Podaj spectrum (lista 21) albo pola mV_0…mV_20"},
                status=400,
            )

        pred = predict(
            spectrum,
            n_cylinders=body.get("n_cylinders"),
            engine_id=body.get("engine_id"),
            cylinder=body.get("cylinder"),
        )
        return Response(pred)
    except (ValueError, TypeError, KeyError) as exc:
        return Response({"error": str(exc)}, status=400)
