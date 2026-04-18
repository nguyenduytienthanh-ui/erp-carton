from django.apps import AppConfig


class WorkforceConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'workforce'

    def ready(self):
        from . import signals  # noqa: F401
