from django.core.management.base import BaseCommand
from django.conf import settings
import os
import subprocess
import shutil


class Command(BaseCommand):
    help = 'Restore database and media files from backup'

    def add_arguments(self, parser):
        parser.add_argument('backup_dir', type=str, help='Backup directory path')
        parser.add_argument('--confirm', action='store_true', help='Confirm restoration (WILL OVERWRITE DATA)')

    def handle(self, *args, **options):
        backup_dir = options['backup_dir']

        if not os.path.exists(backup_dir):
            self.stdout.write(self.style.ERROR(f"✗ Backup directory not found: {backup_dir}"))
            return

        if not options['confirm']:
            self.stdout.write(self.style.WARNING("⚠️  DANGER: This will OVERWRITE current data!"))
            self.stdout.write("Run with --confirm to proceed:")
            self.stdout.write(f"  python manage.py restore {backup_dir} --confirm")
            return

        self.stdout.write(f"Restoring from {backup_dir}...")

        # Restore database
        db_file = os.path.join(backup_dir, 'database.sql')
        if os.path.exists(db_file):
            self.stdout.write("Restoring database...")
            db_config = settings.DATABASES['default']

            if db_config['ENGINE'] == 'django.db.backends.postgresql':
                cmd = [
                    'psql',
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
                    self.stdout.write(self.style.SUCCESS("✓ Database restored"))
                except subprocess.CalledProcessError:
                    self.stdout.write(self.style.WARNING("⚠ psql not found - restore skipped"))

        # Restore media
        media_backup = os.path.join(backup_dir, 'media')
        if os.path.exists(media_backup):
            self.stdout.write("Restoring media files...")
            try:
                if os.path.exists(settings.MEDIA_ROOT):
                    shutil.rmtree(settings.MEDIA_ROOT)
                shutil.copytree(media_backup, settings.MEDIA_ROOT)
                self.stdout.write(self.style.SUCCESS("✓ Media files restored"))
            except Exception as e:
                self.stdout.write(self.style.ERROR(f"✗ Media restore failed: {e}"))

        self.stdout.write(self.style.SUCCESS("\n✓ Restore completed!"))

