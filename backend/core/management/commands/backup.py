from django.core.management.base import BaseCommand
from django.conf import settings
import os
import subprocess
from datetime import datetime
import shutil


class Command(BaseCommand):
    help = 'Backup database and media files'

    def add_arguments(self, parser):
        parser.add_argument('--output', type=str, default='backups', help='Output directory')

    def handle(self, *args, **options):
        output_dir = options['output']
        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
        backup_dir = os.path.join(settings.BASE_DIR, output_dir, timestamp)
        os.makedirs(backup_dir, exist_ok=True)

        self.stdout.write(f"Creating backup in {backup_dir}...")

        # Backup database
        db_config = settings.DATABASES['default']
        if db_config['ENGINE'] == 'django.db.backends.postgresql':
            db_file = os.path.join(backup_dir, 'database.sql')
            cmd = [
                'pg_dump',
                '-h', db_config['HOST'],
                '-p', str(db_config['PORT']),
                '-U', db_config['USER'],
                '-d', db_config['NAME'],
                '-f', db_file,
            ]
            env = os.environ.copy()
            env['PGPASSWORD'] = db_config['PASSWORD']
            try:
                subprocess.run(cmd, env=env, check=True, capture_output=True)
                self.stdout.write(self.style.SUCCESS("✓ Database backed up"))
            except subprocess.CalledProcessError:
                self.stdout.write(self.style.WARNING("⚠ pg_dump not found - backup skipped"))

        # Backup media
        if os.path.exists(settings.MEDIA_ROOT):
            media_backup = os.path.join(backup_dir, 'media')
            try:
                shutil.copytree(settings.MEDIA_ROOT, media_backup)
                self.stdout.write(self.style.SUCCESS("✓ Media files backed up"))
            except Exception as e:
                self.stdout.write(self.style.ERROR(f"✗ Media backup failed: {e}"))

        # Info file
        with open(os.path.join(backup_dir, 'backup_info.txt'), 'w', encoding='utf-8') as f:
            f.write(f"Backup: {datetime.now()}\nDatabase: {db_config['NAME']}\n")

        self.stdout.write(self.style.SUCCESS(f"\n✓ Backup completed!\nLocation: {backup_dir}"))

