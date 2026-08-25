from django.db import migrations, models


SHIP = {
    "slug": "ms-turmalin",
    "name": "MS Turmalin - silniki okrętowe",
    "facility_type": "Ship",
    "address": "Bałtyk / baza Gdańsk",
    "description": "Scenariusz demo - diagnostyka AT głównych silników Diesla na jednostce pływającej",
    "ae_focus": "Silniki napędu głównego V8/V12/V16, wał śrubowy, układy paliwowe",
    "lat": 54.3722,
    "lng": 18.6383,
    "image_url": "/factories/ms-turmalin.jpg",
    "sort_order": 5,
    "engines": [
        ("SHIP_V16_01", 16, "multi", 1),
        ("SHIP_V12_02", 12, "zakoksowany", 2),
        ("SHIP_V8_03", 8, "clean", 3),
    ],
}

NOTES = (
    "Obiekt przykładowy - scenariusz demo; brak publicznego potwierdzenia kontraktu AE Steel."
)


def seed_ship(apps, schema_editor):
    Factory = apps.get_model("api", "Factory")
    DemoEngine = apps.get_model("api", "DemoEngine")

    engines = SHIP["engines"]
    data = {k: v for k, v in SHIP.items() if k != "engines"}
    factory, _ = Factory.objects.update_or_create(
        slug=data["slug"],
        defaults={**data, "notes": NOTES, "is_active": True},
    )
    for engine_id, n_cylinders, scenario, sort_order in engines:
        DemoEngine.objects.update_or_create(
            factory=factory,
            engine_id=engine_id,
            defaults={
                "n_cylinders": n_cylinders,
                "scenario": scenario,
                "sort_order": sort_order,
            },
        )


def unseed_ship(apps, schema_editor):
    Factory = apps.get_model("api", "Factory")
    Factory.objects.filter(slug=SHIP["slug"]).delete()


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0004_alter_factory_image_url"),
    ]

    operations = [
        migrations.AlterField(
            model_name="factory",
            name="facility_type",
            field=models.CharField(
                choices=[
                    ("Steelworks", "Stalownia"),
                    ("Refinery", "Rafineria"),
                    ("Power Plant", "Elektrownia"),
                    ("Ship", "Statek"),
                ],
                max_length=32,
            ),
        ),
        migrations.RunPython(seed_ship, unseed_ship),
    ]
