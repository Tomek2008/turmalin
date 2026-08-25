from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0005_ship_factory"),
    ]

    operations = [
        migrations.RemoveField(
            model_name="demoengine",
            name="scenario",
        ),
    ]
