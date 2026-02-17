"""
Seed dữ liệu Danh mục sản phẩm ban đầu.
Chạy trên máy nhà khi DB chưa có danh mục: python manage.py seed_categories
"""
from django.core.management.base import BaseCommand
from products.models import ProductCategory


class Command(BaseCommand):
    help = 'Seed initial ProductCategory data'

    def handle(self, *args, **options):
        self.stdout.write('Seeding ProductCategory...')

        categories = [
            {'code': 'THUNG', 'name': 'Thùng carton', 'sort_order': 1},
            {'code': 'HOP', 'name': 'Hộp giấy', 'sort_order': 2},
            {'code': 'LOT', 'name': 'Lót, Khay', 'sort_order': 3},
            {'code': 'KHAC', 'name': 'Khác', 'sort_order': 10},
        ]

        created_count = 0
        for c in categories:
            existing = ProductCategory.objects.filter(code=c['code'], deleted_at__isnull=True).first()
            if not existing:
                ProductCategory.objects.create(
                    code=c['code'],
                    name=c['name'],
                    sort_order=c['sort_order'],
                    is_active=True,
                )
                created_count += 1
                self.stdout.write(self.style.SUCCESS(f'  + Created: {c["code"]}'))
            else:
                self.stdout.write(f'  - Exists: {c["code"]}')

        self.stdout.write(self.style.SUCCESS(f'\n[OK] Created {created_count}/{len(categories)} categories.'))
