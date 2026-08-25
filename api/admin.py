from django import forms
from django.contrib import admin, messages
from django.contrib.auth.models import Group, User
from django.core.exceptions import ValidationError
from django.db import transaction
from django.shortcuts import redirect, render
from django.urls import path
from django.utils.html import format_html
from django.utils.safestring import mark_safe

from .csv_import import CSV_FORMAT_HELP
from .models import DemoEngine, Factory


def _media_src(path: str) -> str:
    """Ścieżki /factories/... serwuje Django (backend/urls) i Vite."""
    if not path:
        return ""
    return path


_EMPTY_THUMB = mark_safe('<span class="turmalin-thumb-empty">brak</span>')


admin.site.site_header = "Turmalin"
admin.site.site_title = "Turmalin Admin"
admin.site.index_title = "Monitoring AT"
admin.site.site_url = None

_original_each_context = admin.site.each_context


def _turmalin_each_context(request):
    ctx = _original_each_context(request)
    ctx["turmalin_factory_count"] = Factory.objects.count()
    ctx["turmalin_engine_count"] = DemoEngine.objects.count()
    ctx["turmalin_active_count"] = Factory.objects.filter(is_active=True).count()
    ctx["turmalin_csv_count"] = Factory.objects.exclude(csv_file="").exclude(csv_file__isnull=True).count()
    return ctx


admin.site.each_context = _turmalin_each_context

admin.site.unregister(Group)
admin.site.unregister(User)


class DemoEngineInline(admin.TabularInline):
    model = DemoEngine
    extra = 1
    fields = ("engine_id", "n_cylinders")
    show_change_link = True


class FactoryCsvImportForm(forms.Form):
    name = forms.CharField(label="Nazwa zakładu", max_length=200)
    slug = forms.SlugField(
        label="Slug",
        required=False,
        help_text="Puste = wygenerowany z nazwy.",
    )
    address = forms.CharField(label="Adres", max_length=300, required=False)
    csv_file = forms.FileField(
        label="Plik CSV",
        help_text=CSV_FORMAT_HELP,
    )


@admin.register(Factory)
class FactoryAdmin(admin.ModelAdmin):
    actions = None
    change_list_template = "admin/turmalin_change_list.html"
    list_display = (
        "thumb",
        "name",
        "engine_count",
    )
    list_display_links = ("name",)
    search_fields = ("name", "slug", "address")
    list_per_page = 25
    ordering = ("sort_order", "name")
    prepopulated_fields = {"slug": ("name",)}
    inlines = [DemoEngineInline]
    readonly_fields = ("image_preview",)
    fieldsets = (
        (
            "Zakład",
            {
                "fields": (
                    "name",
                    "slug",
                    "address",
                    "description",
                )
            },
        ),
        (
            "Media",
            {"fields": ("image_url", "image_preview")},
        ),
        (
            "Dane CSV",
            {
                "fields": ("csv_file",),
                "description": (
                    "Upload tworzy/aktualizuje silniki z unikalnych engine_id w pliku. "
                    "Puste = widma z domyślnego train.csv."
                ),
            },
        ),
    )

    def get_urls(self):
        extra = [
            path(
                "import-csv/",
                self.admin_site.admin_view(self.import_csv_view),
                name="api_factory_import_csv",
            ),
        ]
        return extra + super().get_urls()

    def import_csv_view(self, request):
        if not self.has_add_permission(request):
            from django.core.exceptions import PermissionDenied

            raise PermissionDenied

        form = FactoryCsvImportForm(request.POST or None, request.FILES or None)
        if request.method == "POST" and form.is_valid():
            from .csv_import import create_factory_from_csv
            from .train_sampler import invalidate_snapshot

            try:
                with transaction.atomic():
                    factory, n_engines = create_factory_from_csv(
                        name=form.cleaned_data["name"],
                        uploaded=form.cleaned_data["csv_file"],
                        slug=form.cleaned_data.get("slug") or "",
                        address=form.cleaned_data.get("address") or "",
                    )
                invalidate_snapshot()
                self.message_user(
                    request,
                    f"Utworzono zakład „{factory.name}” z {n_engines} silnikami z CSV.",
                    messages.SUCCESS,
                )
                return redirect("admin:api_factory_change", factory.pk)
            except ValidationError as exc:
                form.add_error("csv_file", exc)

        context = {
            **self.admin_site.each_context(request),
            "opts": self.model._meta,
            "form": form,
            "title": "Nowy zakład z CSV",
            "has_view_permission": self.has_view_permission(request),
        }
        return render(request, "admin/api/factory_import_csv.html", context)

    def save_model(self, request, obj, form, change):
        old_csv = ""
        if change:
            old_csv = (
                Factory.objects.filter(pk=obj.pk)
                .values_list("csv_file", flat=True)
                .first()
                or ""
            )
        super().save_model(request, obj, form, change)
        new_csv = obj.csv_file.name if obj.csv_file else ""
        request._turmalin_csv_changed = bool(new_csv and new_csv != old_csv)

    def save_related(self, request, form, formsets, change):
        super().save_related(request, form, formsets, change)
        from .train_sampler import invalidate_snapshot

        if getattr(request, "_turmalin_csv_changed", False):
            from .csv_import import sync_engines_from_csv

            n_engines = sync_engines_from_csv(form.instance)
            self.message_user(
                request,
                f"Z CSV wczytano {n_engines} silników.",
                messages.INFO,
            )
        invalidate_snapshot()

    def delete_model(self, request, obj):
        super().delete_model(request, obj)
        from .train_sampler import invalidate_snapshot

        invalidate_snapshot()

    def delete_queryset(self, request, queryset):
        super().delete_queryset(request, queryset)
        from .train_sampler import invalidate_snapshot

        invalidate_snapshot()

    @admin.display(description="")
    def thumb(self, obj):
        src = _media_src(obj.image_url)
        if src:
            return format_html(
                '<img class="turmalin-thumb" src="{}" alt="" />',
                src,
            )
        return _EMPTY_THUMB

    @admin.display(description="Silniki")
    def engine_count(self, obj):
        return format_html(
            '<span class="turmalin-mono">{}</span>',
            obj.demo_engines.count(),
        )

    @admin.display(description="Podgląd zdjęcia")
    def image_preview(self, obj):
        src = _media_src(obj.image_url) if obj else ""
        if not src:
            return _EMPTY_THUMB
        return format_html(
            '<img src="{}" alt="" style="max-width:320px;max-height:180px;'
            'border-radius:8px;border:1px solid #ddd9d2;object-fit:cover;" />',
            src,
        )


@admin.register(DemoEngine)
class DemoEngineAdmin(admin.ModelAdmin):
    actions = None
    change_list_template = "admin/turmalin_change_list.html"
    list_display = (
        "engine_id",
        "factory",
        "layout_badge",
    )
    search_fields = ("engine_id", "factory__name", "factory__slug")
    list_per_page = 50
    ordering = ("factory__sort_order", "sort_order", "engine_id")
    autocomplete_fields = ("factory",)
    fields = ("factory", "engine_id", "n_cylinders")

    def save_model(self, request, obj, form, change):
        super().save_model(request, obj, form, change)
        from .train_sampler import invalidate_snapshot

        invalidate_snapshot()

    def delete_model(self, request, obj):
        super().delete_model(request, obj)
        from .train_sampler import invalidate_snapshot

        invalidate_snapshot()

    @admin.display(description="Układ")
    def layout_badge(self, obj):
        return format_html(
            '<span class="turmalin-pill turmalin-pill--type">V{}</span>',
            obj.n_cylinders,
        )
