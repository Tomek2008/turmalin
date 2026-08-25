from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0003_local_factory_images"),
    ]

    operations = [
        migrations.AlterField(
            model_name="factory",
            name="image_url",
            field=models.CharField(
                blank=True,
                help_text="Ścieżka do zdjęcia, np. /factories/slug.jpg (serwowane przez frontend)",
                max_length=500,
            ),
        ),
    ]
