"""Debug: resolve path và in view được match. Chạy: python manage.py resolve_path api/export-products-excel/"""
from django.core.management.base import BaseCommand
from django.urls import resolve, Resolver404


class Command(BaseCommand):
    help = "Resolve path và in view (debug 404)"

    def add_arguments(self, parser):
        parser.add_argument('path', nargs='?', default='api/export-products-excel/')

    def handle(self, *args, **options):
        path = options['path']
        self.stdout.write(f"Resolving: {repr(path)}")
        try:
            match = resolve(path)
            self.stdout.write(self.style.SUCCESS(f"  View: {match.func.__name__}"))
            self.stdout.write(f"  URL name: {match.url_name}")
        except Resolver404 as e:
            self.stdout.write(self.style.ERROR(f"  404: {e}"))
