"""Liệt kê URL có chứa 'export' hoặc 'api' để debug 404."""
from django.core.management.base import BaseCommand
from django.urls import get_resolver


class Command(BaseCommand):
    help = "In các URL pattern có chứa 'export' hoặc 'api'"

    def handle(self, *args, **options):
        resolver = get_resolver()
        patterns = []

        def collect(res, prefix=""):
            for pattern in res.url_patterns:
                if hasattr(pattern, 'url_patterns'):
                    collect(pattern, prefix + str(pattern.pattern))
                else:
                    p = prefix + str(pattern.pattern)
                    if 'export' in p or (prefix and 'api' in prefix):
                        patterns.append(p)

        collect(resolver)
        self.stdout.write("Các URL có 'export' hoặc dưới 'api/':")
        for p in sorted(set(patterns)):
            self.stdout.write("  " + p)
        if not any('export' in p for p in patterns):
            self.stdout.write(self.style.WARNING("  (Không thấy URL chứa 'export')"))
