import json
import os
import shutil
from pathlib import Path

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.db import connection


class Command(BaseCommand):
    help = 'Validate environment readiness before staging/production deploy'

    def add_arguments(self, parser):
        parser.add_argument('--json', action='store_true', help='Print result as JSON')
        parser.add_argument(
            '--strict',
            action='store_true',
            help='Exit non-zero on warnings as well as errors',
        )

    def _status_rank(self, value):
        return {'ok': 0, 'warning': 1, 'error': 2}.get(value, 2)

    def _check_env_vars(self):
        db_config = settings.DATABASES.get('default', {})
        missing = []
        if not getattr(settings, 'SECRET_KEY', ''):
            missing.append('SECRET_KEY')
        for key in ('NAME', 'USER', 'PASSWORD', 'HOST', 'PORT'):
            if not db_config.get(key):
                missing.append(f'DB_{key}')
        if missing:
            return {'status': 'error', 'message': f'Missing required runtime config: {", ".join(missing)}'}
        return {'status': 'ok', 'message': 'Required runtime config is present'}

    def _check_database(self):
        with connection.cursor() as cursor:
            cursor.execute('SELECT 1')
        return {'status': 'ok', 'message': 'Database connection is healthy'}

    def _check_media(self):
        media_root = Path(settings.MEDIA_ROOT)
        if not media_root.exists():
            return {'status': 'warning', 'message': f'Media directory does not exist yet: {media_root}'}
        if not os.access(media_root, os.W_OK):
            return {'status': 'error', 'message': f'Media directory is not writable: {media_root}'}
        return {'status': 'ok', 'message': f'Media directory is writable: {media_root}'}

    def _check_backup_tools(self):
        missing = [tool for tool in ('pg_dump', 'psql') if shutil.which(tool) is None]
        if missing:
            return {'status': 'warning', 'message': f'Missing backup/restore tools in PATH: {", ".join(missing)}'}
        return {'status': 'ok', 'message': 'Backup/restore tools are available'}

    def _check_q_cluster(self):
        workers = int(settings.Q_CLUSTER.get('workers') or 0)
        timeout = int(settings.Q_CLUSTER.get('timeout') or 0)
        if workers <= 0 or timeout <= 0:
            return {'status': 'error', 'message': 'Q_CLUSTER workers/timeout must be positive'}
        return {
            'status': 'ok',
            'message': f'Q_CLUSTER configured with workers={workers}, timeout={timeout}',
        }

    def _check_security_flags(self):
        if getattr(settings, 'DEBUG', False):
            return {'status': 'warning', 'message': 'DEBUG is enabled'}
        if getattr(settings, 'APP_ENV', 'development') == 'production':
            insecure = []
            if not getattr(settings, 'SESSION_COOKIE_SECURE', False):
                insecure.append('SESSION_COOKIE_SECURE')
            if not getattr(settings, 'CSRF_COOKIE_SECURE', False):
                insecure.append('CSRF_COOKIE_SECURE')
            if not getattr(settings, 'SECURE_CONTENT_TYPE_NOSNIFF', False):
                insecure.append('SECURE_CONTENT_TYPE_NOSNIFF')
            if int(getattr(settings, 'SECURE_HSTS_SECONDS', 0) or 0) <= 0:
                insecure.append('SECURE_HSTS_SECONDS')
            if insecure:
                return {'status': 'warning', 'message': f'Production mode with insecure flags: {", ".join(insecure)}'}
        return {'status': 'ok', 'message': 'Security flags look acceptable'}

    def _check_frontend_env_template(self):
        env_example = Path(settings.BASE_DIR).parent / 'frontend' / '.env.example'
        if not env_example.exists():
            return {'status': 'warning', 'message': 'frontend/.env.example is missing'}
        return {'status': 'ok', 'message': 'frontend/.env.example exists'}

    def _check_monitoring(self):
        app_env = getattr(settings, 'APP_ENV', 'development')
        sentry_dsn = getattr(settings, 'SENTRY_DSN', '')
        log_to_file = getattr(settings, 'LOG_TO_FILE', False)
        log_dir = Path(getattr(settings, 'LOG_DIR', settings.BASE_DIR / 'logs'))
        messages = []
        status = 'ok'
        if app_env == 'production' and not sentry_dsn:
            status = 'warning'
            messages.append('SENTRY_DSN is not configured for production')
        if log_to_file:
            if not log_dir.exists():
                status = 'warning'
                messages.append(f'LOG_DIR does not exist yet: {log_dir}')
            elif not os.access(log_dir, os.W_OK):
                status = 'error'
                messages.append(f'LOG_DIR is not writable: {log_dir}')
        if not messages:
            messages.append('Monitoring hooks look acceptable')
        return {'status': status, 'message': '; '.join(messages)}

    def handle(self, *args, **options):
        checks = {
            'env_vars': self._check_env_vars(),
            'database': self._check_database(),
            'media': self._check_media(),
            'backup_tools': self._check_backup_tools(),
            'q_cluster': self._check_q_cluster(),
            'security_flags': self._check_security_flags(),
            'frontend_env': self._check_frontend_env_template(),
            'monitoring': self._check_monitoring(),
        }

        worst = max(self._status_rank(item['status']) for item in checks.values())
        overall_status = 'ok' if worst == 0 else 'warning' if worst == 1 else 'error'
        result = {'overall_status': overall_status, 'checks': checks}

        if options['json']:
            self.stdout.write(json.dumps(result, ensure_ascii=False, indent=2))
        else:
            self.stdout.write(f'Preflight status: {overall_status.upper()}')
            for key, item in checks.items():
                self.stdout.write(f"- {key}: {item['status'].upper()} - {item['message']}")

        if options['strict'] and overall_status in {'warning', 'error'}:
            raise CommandError(f'Preflight failed with status {overall_status}')
