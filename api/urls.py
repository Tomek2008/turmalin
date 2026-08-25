from django.urls import path
from . import views

app_name = "api"

urlpatterns = [
    path("factories/", views.get_factories, name="factory-list"),
    path("factories/<str:factory_id>/", views.get_factory_detail, name="factory-detail"),
    path("predict/", views.predict_label, name="predict"),
]
