from django.core.management.base import BaseCommand
from products.models import ProductWave, ProductBoxType


class Command(BaseCommand):
    help = 'Seed initial waves and box types data'

    def handle(self, *args, **options):
        self.stdout.write('Seeding ProductWave...')

        # Waves data
        waves = [
            {'code': 'A', 'name': 'Sóng A', 'description': 'Sóng A - 1 lớp'},
            {'code': 'B', 'name': 'Sóng B', 'description': 'Sóng B - 1 lớp'},
            {'code': 'C', 'name': 'Sóng C', 'description': 'Sóng C - 1 lớp'},
            {'code': 'E', 'name': 'Sóng E', 'description': 'Sóng E - 1 lớp mỏng'},
            {'code': 'BC', 'name': 'Sóng BC', 'description': 'Sóng BC - 3 lớp (B+C)'},
            {'code': 'BE', 'name': 'Sóng BE', 'description': 'Sóng BE - 3 lớp (B+E)'},
            {'code': 'EB', 'name': 'Sóng EB', 'description': 'Sóng EB - 3 lớp (E+B)'},
            {'code': 'AA', 'name': 'Sóng AA', 'description': 'Sóng AA - 3 lớp (A+A)'},
        ]

        created_waves = 0
        for wave_data in waves:
            wave, created = ProductWave.objects.get_or_create(
                code=wave_data['code'],
                defaults={
                    'name': wave_data['name'],
                    'description': wave_data['description']
                }
            )
            if created:
                created_waves += 1
                self.stdout.write(self.style.SUCCESS(f'  + Created wave: {wave.code}'))
            else:
                self.stdout.write(f'  - Wave already exists: {wave.code}')

        self.stdout.write(self.style.SUCCESS(f'\n[OK] Total waves created: {created_waves}/{len(waves)}'))

        # Box Types data
        self.stdout.write('\nSeeding ProductBoxType...')

        box_types = [
            {'code': 'A1', 'name': 'Kiểu A1', 'description': 'Thùng 1 chi tiết - nắp liền'},
            {'code': 'A2', 'name': 'Kiểu A2', 'description': 'Thùng 1 chi tiết - nắp rời'},
            {'code': 'A3', 'name': 'Kiểu A3', 'description': 'Thùng 1 chi tiết - nắp kéo'},
            {'code': 'A5', 'name': 'Kiểu A5', 'description': 'Thùng 1 chi tiết - dán 4 góc'},
            {'code': 'B1', 'name': 'Kiểu B1', 'description': 'Thùng 2 chi tiết - nắp + thân'},
            {'code': 'B2', 'name': 'Kiểu B2', 'description': 'Thùng 2 chi tiết - nắp chụp'},
            {'code': 'C1', 'name': 'Kiểu C1', 'description': 'Thùng 3 chi tiết - nắp + thân + đáy'},
            {'code': 'D1', 'name': 'Kiểu D1', 'description': 'Hộp giấy - 1 chi tiết'},
        ]

        created_types = 0
        for bt_data in box_types:
            box_type, created = ProductBoxType.objects.get_or_create(
                code=bt_data['code'],
                defaults={
                    'name': bt_data['name'],
                    'description': bt_data['description']
                }
            )
            if created:
                created_types += 1
                self.stdout.write(self.style.SUCCESS(f'  + Created box type: {box_type.code}'))
            else:
                self.stdout.write(f'  - Box type already exists: {box_type.code}')

        self.stdout.write(self.style.SUCCESS(f'\n[OK] Total box types created: {created_types}/{len(box_types)}'))
        self.stdout.write(self.style.SUCCESS('\n========================================'))
        self.stdout.write(self.style.SUCCESS('[OK] SEED COMPLETED SUCCESSFULLY!'))
        self.stdout.write(self.style.SUCCESS('========================================'))
