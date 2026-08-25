from django.db import models
from django.urls import reverse
from pathlib import Path


def factory_csv_upload_to(instance, filename: str) -> str:
    ext = Path(filename).suffix.lower() or ".csv"
    if ext not in {".csv", ".txt"}:
        ext = ".csv"
    slug = instance.slug or "factory"
    return f"factory_csvs/{slug}{ext}"


class Factory(models.Model):
    """Zakład przemysłowy - obiekt demo w profilu branżowym AE Steel (AT)."""

    class FacilityType(models.TextChoices):
        STEELWORKS = "Steelworks", "Stalownia"
        REFINERY = "Refinery", "Rafineria"
        POWER_PLANT = "Power Plant", "Elektrownia"
        SHIP = "Ship", "Statek"

    slug = models.SlugField(max_length=64, unique=True)
    name = models.CharField(max_length=200)
    facility_type = models.CharField(
        max_length=32,
        choices=FacilityType.choices,
        default=FacilityType.STEELWORKS,
        blank=True,
    )
    address = models.CharField(max_length=300, blank=True)
    description = models.TextField(blank=True)
    ae_focus = models.CharField(max_length=300, blank=True)
    lat = models.FloatField(null=True, blank=True)
    lng = models.FloatField(null=True, blank=True)
    image_url = models.CharField(
        max_length=500,
        blank=True,
        help_text="Ścieżka do zdjęcia, np. /factories/slug.jpg (serwowane przez frontend)",
    )
    csv_file = models.FileField(
        upload_to=factory_csv_upload_to,
        blank=True,
        help_text="CSV z widmami: engine_id, cylinder, n_cylinders, mV_0…mV_20. Puste = losowanie z train.csv.",
    )
    contact = models.EmailField(blank=True)
    notes = models.TextField(blank=True)
    is_active = models.BooleanField(default=True)
    sort_order = models.PositiveSmallIntegerField(default=0)

    class Meta:
        ordering = ["sort_order", "name"]
        verbose_name = "Zakład"
        verbose_name_plural = "Zakłady"

    def __str__(self):
        return self.name

    @property
    def detail_api_path(self) -> str:
        return reverse("api:factory-detail", kwargs={"factory_id": self.slug})

    @property
    def predict_api_path(self) -> str:
        return reverse("api:predict")

    def api_links(self) -> dict:
        return {
            "self": self.detail_api_path,
            "list": reverse("api:factory-list"),
            "predict": self.predict_api_path,
        }

    def to_api_dict(self, *, status="", status_key="", anomaly_count=0, engine_count=0, engines=None):
        return {
            "id": self.slug,
            "name": self.name,
            "address": self.address,
            "description": self.description,
            "ae_focus": self.ae_focus,
            "contact": self.contact or None,
            "image": self.image_url,
            "notes": self.notes,
            "status": status,
            "status_key": status_key,
            "anomaly_count": anomaly_count,
            "engine_count": engine_count,
            "engines": engines or [],
            "api": self.api_links(),
        }


class DemoEngine(models.Model):
    """Silnik demo przypisany do zakładu - telemetria z API (widma + predict)."""

    factory = models.ForeignKey(
        Factory,
        on_delete=models.CASCADE,
        related_name="demo_engines",
    )
    engine_id = models.CharField(max_length=64)
    n_cylinders = models.PositiveSmallIntegerField()
    sort_order = models.PositiveSmallIntegerField(default=0)

    class Meta:
        ordering = ["sort_order", "engine_id"]
        unique_together = [("factory", "engine_id")]
        verbose_name = "Silnik demo"
        verbose_name_plural = "Silniki demo"

    def __str__(self):
        return f"{self.engine_id} ({self.factory.slug})"

    def to_spec(self):
        from .train_sampler import normalize_n_cylinders

        return {
            "engine_id": self.engine_id,
            "n_cylinders": normalize_n_cylinders(self.n_cylinders),
        }
