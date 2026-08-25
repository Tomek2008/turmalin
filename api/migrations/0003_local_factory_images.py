from django.db import migrations

LOCAL_IMAGES = {
    "cmc-zawiercie": "/factories/cmc-zawiercie.jpg",
    "orlen-plock": "/factories/orlen-plock.jpg",
    "celsa-ostrowiec": "/factories/celsa-ostrowiec.jpg",
    "pge-belchatow": "/factories/pge-belchatow.jpg",
}


def set_local_images(apps, schema_editor):
    Factory = apps.get_model("api", "Factory")
    for slug, image_url in LOCAL_IMAGES.items():
        Factory.objects.filter(slug=slug).update(image_url=image_url)


def restore_wiki_urls(apps, schema_editor):
    Factory = apps.get_model("api", "Factory")
    wiki = {
        "cmc-zawiercie": "https://upload.wikimedia.org/wikipedia/commons/thumb/2/29/Electric_arc_furnace.jpg/640px-Electric_arc_furnace.jpg",
        "orlen-plock": "https://upload.wikimedia.org/wikipedia/commons/thumb/a/a7/Rafineria_w_P%C5%82ocku.jpg/640px-Rafineria_w_P%C5%82ocku.jpg",
        "celsa-ostrowiec": "https://upload.wikimedia.org/wikipedia/commons/thumb/7/7a/Steel_mill.jpg/640px-Steel_mill.jpg",
        "pge-belchatow": "https://upload.wikimedia.org/wikipedia/commons/thumb/3/38/Belchatow-elektrownia.jpg/640px-Belchatow-elektrownia.jpg",
    }
    for slug, image_url in wiki.items():
        Factory.objects.filter(slug=slug).update(image_url=image_url)


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0002_seed_factories"),
    ]

    operations = [
        migrations.RunPython(set_local_images, restore_wiki_urls),
    ]
