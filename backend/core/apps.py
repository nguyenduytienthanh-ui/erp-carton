from django.apps import AppConfig


class CoreConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'core'
    verbose_name = 'Cốt lõi'
    
    def ready(self):
        import core.signals  # Load signals

        