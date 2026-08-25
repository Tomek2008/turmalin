from django.db import migrations


FACTORIES = [
    {
        "slug": "cmc-zawiercie",
        "name": "CMC Poland - Huta Zawiercie",
        "facility_type": "Steelworks",
        "address": "ul. Piłsudskiego 82, 42-400 Zawiercie",
        "description": "Stalownia EAF - scenariusz demo AT infrastruktury hutniczej",
        "ae_focus": "Piece łukowe, kadzie, rurociągi technologiczne",
        "lat": 50.4875,
        "lng": 19.4568,
        "image_url": "/factories/cmc-zawiercie.jpg",
        "sort_order": 1,
        "engines": [
            ("ZAW_V12_01", 12, "zakoksowany", 1),
            ("ZAW_V8_02", 8, "clean", 2),
            ("ZAW_V16_03", 16, "multi", 3),
        ],
    },
    {
        "slug": "orlen-plock",
        "name": "Orlen - Rafineria Płock",
        "facility_type": "Refinery",
        "address": "Kompleks rafineryjny, Płock",
        "description": "Scenariusz demo - emisja akustyczna zbiorników i rurociągów",
        "ae_focus": "Dna zbiorników pionowych, wycieki, korozja aktywna",
        "lat": 52.5539,
        "lng": 19.6800,
        "image_url": "/factories/orlen-plock.jpg",
        "sort_order": 2,
        "engines": [
            ("PLC_V12_01", 12, "multi", 1),
            ("PLC_V8_02", 8, "clean", 2),
        ],
    },
    {
        "slug": "celsa-ostrowiec",
        "name": "CELSA Huta Ostrowiec",
        "facility_type": "Steelworks",
        "address": "ul. Samsonowicza 2, 27-400 Ostrowiec Świętokrzyski",
        "description": "Scenariusz demo - monitoring AT instalacji hutniczych",
        "ae_focus": "Konstrukcje stalowe, sprężarki, urządzenia ciśnieniowe",
        "lat": 50.9473,
        "lng": 21.4488,
        "image_url": "/factories/celsa-ostrowiec.jpg",
        "sort_order": 3,
        "engines": [
            ("OST_V16_01", 16, "clean", 1),
            ("OST_V12_02", 12, "zakoksowany", 2),
        ],
    },
    {
        "slug": "pge-belchatow",
        "name": "PGE - Elektrownia Bełchatów",
        "facility_type": "Power Plant",
        "address": "Rogowiec / Bełchatów",
        "description": "Scenariusz demo - diagnostyka turbogeneratorów metodą AT",
        "ae_focus": "Transformatory mocy, obiekty ciśnieniowe, SHM",
        "lat": 51.2662,
        "lng": 19.3300,
        "image_url": "/factories/pge-belchatow.jpg",
        "sort_order": 4,
        "engines": [
            ("BEL_V8_01", 8, "clean", 1),
            ("BEL_V12_02", 12, "clean", 2),
        ],
    },
]

NOTES = (
    "Obiekt przykładowy - scenariusz demo; brak publicznego potwierdzenia kontraktu AE Steel."
)


def seed_factories(apps, schema_editor):
    Factory = apps.get_model("api", "Factory")
    DemoEngine = apps.get_model("api", "DemoEngine")

    for row in FACTORIES:
        engines = row["engines"]
        data = {k: v for k, v in row.items() if k != "engines"}
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


def unseed_factories(apps, schema_editor):
    Factory = apps.get_model("api", "Factory")
    slugs = [f["slug"] for f in FACTORIES]
    Factory.objects.filter(slug__in=slugs).delete()


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0001_initial"),
    ]

    operations = [
        migrations.RunPython(seed_factories, unseed_factories),
    ]
