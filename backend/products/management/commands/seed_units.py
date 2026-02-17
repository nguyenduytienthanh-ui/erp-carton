"""
Seed dữ liệu ĐVT (Đơn vị tính) ban đầu.
Chạy trên máy nhà (hoặc máy mới) khi DB chưa có ĐVT: python manage.py seed_units
"""
from django.core.management.base import BaseCommand
from products.models import ProductUnit


class Command(BaseCommand):
    help = 'Seed initial ProductUnit (ĐVT) data'

    def handle(self, *args, **options):
        self.stdout.write('Seeding ProductUnit (ĐVT)...')

        units = [
            {'code': 'CAI', 'name': 'Cái', 'sort_order': 1},
            {'code': 'HOP', 'name': 'Hộp', 'sort_order': 2},
            {'code': 'KIEN', 'name': 'Kiện', 'sort_order': 3},
            {'code': 'THUNG', 'name': 'Thùng', 'sort_order': 4},
            {'code': 'BO', 'name': 'Bộ', 'sort_order': 5},
            {'code': 'KG', 'name': 'Kg', 'sort_order': 6},
            {'code': 'M', 'name': 'Mét', 'sort_order': 7},
            {'code': 'M2', 'name': 'M²', 'sort_order': 8},
            {'code': 'ROLL', 'name': 'Cuộn', 'sort_order': 9},
        ]

        created_count = 0
        for u in units:
            # Chỉ tạo nếu chưa có (theo code, bỏ qua deleted)
            existing = ProductUnit.objects.filter(code=u['code'], deleted_at__isnull=True).first()
            if not existing:
                ProductUnit.objects.create(
                    code=u['code'],
                    name=u['name'],
                    sort_order=u['sort_order'],
                    is_active=True,
                )
                created_count += 1
                self.stdout.write(self.style.SUCCESS(f'  + Created: {u["code"]} - {u["name"]}'))
            else:
                self.stdout.write(f'  - Đã có: {u["code"]}')

        self.stdout.write(self.style.SUCCESS(f'\n[OK] Đã tạo {created_count}/{len(units)} ĐVT.'))
        self.stdout.write(self.style.SUCCESS('Chạy xong. Bạn có thể thêm sản phẩm và chọn ĐVT.'))
