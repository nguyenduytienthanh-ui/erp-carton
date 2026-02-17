"""
Seed toàn bộ Master Data: Danh mục, ĐVT, Sóng, Kiểu thùng.
Chạy trên máy nhà (hoặc máy mới) khi DB chưa có dữ liệu: python manage.py seed_master_data
"""
from django.core.management import call_command
from django.core.management.base import BaseCommand


class Command(BaseCommand):
    help = 'Seed all master data (categories, units, waves, box types)'

    def handle(self, *args, **options):
        self.stdout.write(self.style.HTTP_INFO('=== SEED MASTER DATA ===\n'))

        call_command('seed_categories')
        self.stdout.write('')
        call_command('seed_units')
        self.stdout.write('')
        call_command('seed_waves_boxtypes')

        self.stdout.write(self.style.SUCCESS('\n=== HOÀN THÀNH ==='))
        self.stdout.write('Danh mục, ĐVT, Sóng, Kiểu thùng đã sẵn sàng. Có thể thêm sản phẩm.')
