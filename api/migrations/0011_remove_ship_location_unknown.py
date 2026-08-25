from django.db import migrations, models

KNOWN = {
    "cmc-zawiercie": (50.4875, 19.4568),
    "orlen-plock": (52.5539, 19.6800),
    "celsa-ostrowiec": (50.9473, 21.4488),
    "pge-belchatow": (51.2662, 19.3300),
}


def remove_ship_and_fix_coords(apps, schema_editor):
    Factory = apps.get_model("api", "Factory")
    Factory.objects.filter(slug="ms-turmalin").delete()
    Factory.objects.filter(facility_type="Ship").delete()
    for slug, (lat, lng) in KNOWN.items():
        Factory.objects.filter(slug=slug).update(lat=lat, lng=lng)
    Factory.objects.exclude(slug__in=KNOWN).update(lat=None, lng=None)


def noop(apps, schema_editor):
    pass


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0010_factory_csv_file"),
    ]

    operations = [
        migrations.RunPython(remove_ship_and_fix_coords, noop),
        migrations.AlterField(
            model_name="factory",
            name="facility_type",
            field=models.CharField(
                blank=True,
                choices=[
                    ("Steelworks", "Stalownia"),
                    ("Refinery", "Rafineria"),
                    ("Power Plant", "Elektrownia"),
                ],
                default="Steelworks",
                max_length=32,
            ),
        ),
        migrations.AlterField(
            model_name="factory",
            name="lat",
            field=models.FloatField(
                blank=True,
                help_text="Szerokość geograficzna. Puste = lokalizacja unknown.",
                null=True,
            ),
        ),
        migrations.AlterField(
            model_name="factory",
            name="lng",
            field=models.FloatField(
                blank=True,
                help_text="Długość geograficzna. Puste = odległość unknown.",
                null=True,
            ),
        ),
    ]
