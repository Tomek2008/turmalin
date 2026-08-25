"""Import zakładu z CSV: widma + silniki z unikalnych engine_id."""

from __future__ import annotations

import csv
import io

from django.core.exceptions import ValidationError
from django.utils.text import slugify

from .models import DemoEngine, Factory
from .train_sampler import ALLOWED_N_CYLINDERS, FREQ_COLS

REQUIRED_COLS = ("engine_id", "cylinder", "n_cylinders", *FREQ_COLS)

CSV_FORMAT_HELP = (
    "Nagłówek: engine_id, cylinder, n_cylinders, mV_0 … mV_20. "
    "Każdy unikalny engine_id → osobny silnik (V8/V12/V16)."
)


def _decode_upload(uploaded) -> str:
    raw = uploaded.read()
    if isinstance(raw, str):
        return raw
    for enc in ("utf-8-sig", "utf-8", "cp1250"):
        try:
            return raw.decode(enc)
        except UnicodeDecodeError:
            continue
    raise ValidationError("Nie udało się odczytać CSV (UTF-8 / Windows-1250).")


def _dialect(sample: str) -> csv.Dialect:
    try:
        return csv.Sniffer().sniff(sample, delimiters=",;\t")
    except csv.Error:
        class _Comma(csv.Dialect):
            delimiter = ","
            quotechar = '"'
            doublequote = True
            skipinitialspace = True
            lineterminator = "\n"
            quoting = csv.QUOTE_MINIMAL

        return _Comma()


def parse_factory_csv(uploaded) -> list[dict]:
    if hasattr(uploaded, "seek"):
        uploaded.seek(0)
    text = _decode_upload(uploaded).strip()
    if not text:
        raise ValidationError("Plik CSV jest pusty.")

    sample = text[:4096]
    reader = csv.DictReader(io.StringIO(text), dialect=_dialect(sample))
    if not reader.fieldnames:
        raise ValidationError("Brak nagłówka w CSV.")

    fields = {name.strip() for name in reader.fieldnames if name}
    missing = [c for c in REQUIRED_COLS if c not in fields]
    if missing:
        raise ValidationError(
            "Brakuje kolumn: " + ", ".join(missing) + ". " + CSV_FORMAT_HELP
        )

    rows: list[dict] = []
    for i, row in enumerate(reader, start=2):
        eid = (row.get("engine_id") or "").strip()
        if not eid:
            continue
        try:
            cyl = int(float(row.get("cylinder") or ""))
            n_cyl = int(float(row.get("n_cylinders") or ""))
        except ValueError:
            raise ValidationError(f"Wiersz {i}: cylinder / n_cylinders muszą być liczbami.")
        if n_cyl not in ALLOWED_N_CYLINDERS:
            raise ValidationError(
                f"Wiersz {i} ({eid}): n_cylinders={n_cyl}, dozwolone {sorted(ALLOWED_N_CYLINDERS)}."
            )
        cleaned = {k: (v.strip() if isinstance(v, str) else v) for k, v in row.items() if k}
        cleaned["engine_id"] = eid
        cleaned["cylinder"] = str(cyl)
        cleaned["n_cylinders"] = str(n_cyl)
        rows.append(cleaned)

    if not rows:
        raise ValidationError("CSV nie zawiera żadnego wiersza z engine_id.")
    engines_from_rows(rows)
    return rows


def engines_from_rows(rows: list[dict]) -> list[tuple[str, int]]:
    by_id: dict[str, int] = {}
    order: list[str] = []
    for row in rows:
        eid = row["engine_id"]
        n = int(row["n_cylinders"])
        if eid not in by_id:
            by_id[eid] = n
            order.append(eid)
        elif by_id[eid] != n:
            raise ValidationError(
                f"Silnik {eid} ma niespójne n_cylinders ({by_id[eid]} i {n})."
            )
    return [(eid, by_id[eid]) for eid in order]


def unique_factory_slug(name: str, *, exclude_pk=None) -> str:
    base = slugify(name)[:56] or "zaklad"
    slug = base
    n = 2
    qs = Factory.objects.all()
    if exclude_pk:
        qs = qs.exclude(pk=exclude_pk)
    while qs.filter(slug=slug).exists():
        slug = f"{base}-{n}"
        n += 1
    return slug


def sync_engines_from_csv(factory: Factory, rows: list[dict] | None = None) -> int:
    """Tworzy/aktualizuje DemoEngine z unikalnych engine_id w CSV."""
    if rows is None:
        if not factory.csv_file:
            return 0
        factory.csv_file.open("rb")
        try:
            rows = parse_factory_csv(factory.csv_file)
        finally:
            factory.csv_file.close()

    specs = engines_from_rows(rows)
    keep_ids = {eid for eid, _ in specs}
    factory.demo_engines.exclude(engine_id__in=keep_ids).delete()

    for i, (eid, n_cyl) in enumerate(specs):
        DemoEngine.objects.update_or_create(
            factory=factory,
            engine_id=eid,
            defaults={"n_cylinders": n_cyl, "sort_order": i},
        )
    return len(specs)


def create_factory_from_csv(
    *,
    name: str,
    uploaded,
    slug: str = "",
    address: str = "",
    description: str = "",
) -> tuple[Factory, int]:
    rows = parse_factory_csv(uploaded)
    slug = (slug or "").strip() or unique_factory_slug(name)
    if Factory.objects.filter(slug=slug).exists():
        raise ValidationError(f"Slug „{slug}” jest już zajęty.")

    max_sort = (
        Factory.objects.order_by("-sort_order").values_list("sort_order", flat=True).first()
    )
    factory = Factory(
        name=name.strip(),
        slug=slug,
        address=(address or "").strip(),
        description=(description or "").strip(),
        is_active=True,
        sort_order=(max_sort or 0) + 1,
    )
    if hasattr(uploaded, "seek"):
        uploaded.seek(0)
    factory.csv_file = uploaded
    factory.save()
    n_engines = sync_engines_from_csv(factory, rows)
    return factory, n_engines
