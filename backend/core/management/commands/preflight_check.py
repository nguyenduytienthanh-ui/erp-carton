import json
import os
import shutil
from io import BytesIO
from pathlib import Path
from urllib.parse import urlparse

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.db import connection
from openpyxl import load_workbook

from paper_optimizer.regression_corpus import build_regression_guardrail_report
from paper_optimizer.services import load_canonical_workbook_bytes


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

    @staticmethod
    def _tool_available(tool_name):
        candidate = str(tool_name or '').strip()
        if not candidate:
            return False
        if Path(candidate).is_file():
            return True
        return shutil.which(candidate) is not None

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
        required_tools = ['pg_dump', 'psql']
        deployment_mode = str(getattr(settings, 'DEPLOYMENT_MODE', 'colocated') or 'colocated').strip().lower()
        tunnel_provider = str(getattr(settings, 'TUNNEL_PROVIDER', '') or '').strip().lower()
        backup_cloud_enabled = bool(
            getattr(settings, 'BACKUP_CLOUD_SYNC_ENABLED', False)
            or str(getattr(settings, 'BACKUP_RCLONE_DESTINATION', '') or '').strip()
            or str(getattr(settings, 'BACKUP_CLOUD_PROVIDER', '') or '').strip()
        )
        if backup_cloud_enabled:
            required_tools.append(str(getattr(settings, 'BACKUP_RCLONE_BINARY', 'rclone') or 'rclone'))
        if deployment_mode == 'hybrid' and tunnel_provider == 'cloudflared':
            required_tools.append('cloudflared')
        missing = [tool for tool in required_tools if not self._tool_available(tool)]
        if missing:
            return {'status': 'warning', 'message': f'Missing backup/restore tools in PATH: {", ".join(missing)}'}
        return {'status': 'ok', 'message': f'Backup/restore tools are available ({", ".join(required_tools)})'}

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

    def _check_domains_and_cors(self):
        app_env = getattr(settings, 'APP_ENV', 'development')
        allowed_hosts = [host for host in getattr(settings, 'ALLOWED_HOSTS', []) if str(host).strip()]
        cors_origins = [origin for origin in getattr(settings, 'CORS_ALLOWED_ORIGINS', []) if str(origin).strip()]
        csrf_origins = [origin for origin in getattr(settings, 'CSRF_TRUSTED_ORIGINS', []) if str(origin).strip()]
        local_tokens = ('localhost', '127.0.0.1', '0.0.0.0')

        issues = []
        status = 'ok'
        if app_env == 'production' and not allowed_hosts:
            status = 'error'
            issues.append('ALLOWED_HOSTS is empty')
        if app_env == 'production' and not cors_origins:
            status = 'warning'
            issues.append('CORS_ALLOWED_ORIGINS is empty')
        if app_env == 'production' and getattr(settings, 'CORS_ALLOW_CREDENTIALS', False) and not csrf_origins:
            status = 'warning'
            issues.append('CSRF_TRUSTED_ORIGINS is empty while credentials are enabled')
        if app_env == 'production' and any(any(token in item for token in local_tokens) for item in allowed_hosts + cors_origins + csrf_origins):
            status = 'warning'
            issues.append('Localhost/loopback values are still present in host/CORS settings')

        if not issues:
            return {
                'status': 'ok',
                'message': (
                    f'Hosts/CORS look acceptable '
                    f'(hosts={len(allowed_hosts)}, cors={len(cors_origins)}, csrf={len(csrf_origins)})'
                ),
            }
        return {'status': status, 'message': '; '.join(issues)}

    def _check_email(self):
        backend = str(getattr(settings, 'EMAIL_BACKEND', '') or '')
        default_from = str(getattr(settings, 'DEFAULT_FROM_EMAIL', '') or '').strip()
        frontend_url = str(getattr(settings, 'FRONTEND_URL', '') or '').strip()
        app_env = getattr(settings, 'APP_ENV', 'development')
        issues = []
        status = 'ok'

        if not default_from:
            issues.append('DEFAULT_FROM_EMAIL is empty')
            status = 'warning'
        if not frontend_url:
            issues.append('FRONTEND_URL is empty')
            status = 'warning'

        if backend == 'django.core.mail.backends.filebased.EmailBackend':
            email_dir = Path(getattr(settings, 'EMAIL_FILE_PATH', Path(settings.BASE_DIR) / 'sent_emails'))
            if app_env == 'production':
                status = 'warning'
                issues.append('Production is still using filebased email backend')
            if not email_dir.exists():
                status = 'warning'
                issues.append(f'Email output directory does not exist yet: {email_dir}')
            elif not os.access(email_dir, os.W_OK):
                status = 'error'
                issues.append(f'Email output directory is not writable: {email_dir}')
        elif 'smtp' in backend.lower():
            if not getattr(settings, 'EMAIL_HOST', ''):
                status = 'warning'
                issues.append('EMAIL_HOST is empty for SMTP backend')
            if int(getattr(settings, 'EMAIL_PORT', 0) or 0) <= 0:
                status = 'warning'
                issues.append('EMAIL_PORT is not configured for SMTP backend')
        elif not backend:
            status = 'warning'
            issues.append('EMAIL_BACKEND is empty')

        if not issues:
            return {'status': 'ok', 'message': f'Email backend is configured: {backend}'}
        return {'status': status, 'message': '; '.join(issues)}

    def _check_jwt_and_sessions(self):
        auth_classes = list(settings.REST_FRAMEWORK.get('DEFAULT_AUTHENTICATION_CLASSES', []))
        issues = []
        status = 'ok'

        if 'core.authentication.SessionAwareJWTAuthentication' not in auth_classes:
            status = 'error'
            issues.append('SessionAwareJWTAuthentication is missing from REST_FRAMEWORK defaults')
        if 'rest_framework_simplejwt.token_blacklist' not in settings.INSTALLED_APPS:
            status = 'warning'
            issues.append('SimpleJWT token blacklist app is not installed')

        jwt_settings = getattr(settings, 'SIMPLE_JWT', {})
        access_lifetime = jwt_settings.get('ACCESS_TOKEN_LIFETIME')
        refresh_lifetime = jwt_settings.get('REFRESH_TOKEN_LIFETIME')
        if access_lifetime is None or int(access_lifetime.total_seconds()) <= 0:
            status = 'error'
            issues.append('ACCESS_TOKEN_LIFETIME is invalid')
        if refresh_lifetime is None or int(refresh_lifetime.total_seconds()) <= 0:
            status = 'error'
            issues.append('REFRESH_TOKEN_LIFETIME is invalid')
        if not issues:
            return {
                'status': 'ok',
                'message': (
                    'JWT/session settings look acceptable '
                    f'(access={access_lifetime}, refresh={refresh_lifetime})'
                ),
            }
        return {'status': status, 'message': '; '.join(issues)}

    def _check_backup_and_logging(self):
        backup_root = Path(getattr(settings, 'BACKUP_ROOT', Path(settings.BASE_DIR) / 'backups'))
        retention_days = int(getattr(settings, 'BACKUP_RETENTION_DAYS', 0) or 0)
        cloud_sync_enabled = bool(getattr(settings, 'BACKUP_CLOUD_SYNC_ENABLED', False))
        cloud_provider = str(getattr(settings, 'BACKUP_CLOUD_PROVIDER', '') or '').strip().lower()
        cloud_destination = str(getattr(settings, 'BACKUP_RCLONE_DESTINATION', '') or '').strip()
        log_to_file = bool(getattr(settings, 'LOG_TO_FILE', False))
        log_backup_count = int(getattr(settings, 'LOG_FILE_BACKUP_COUNT', 0) or 0)

        issues = []
        status = 'ok'
        if not backup_root.parent.exists():
            status = 'warning'
            issues.append(f'Backup parent directory does not exist yet: {backup_root.parent}')
        elif not os.access(backup_root.parent, os.W_OK):
            status = 'error'
            issues.append(f'Backup parent directory is not writable: {backup_root.parent}')
        if retention_days <= 0:
            status = 'warning'
            issues.append('BACKUP_RETENTION_DAYS should be greater than 0')
        if cloud_sync_enabled and not cloud_provider:
            status = 'warning'
            issues.append('BACKUP_CLOUD_PROVIDER is empty while BACKUP_CLOUD_SYNC_ENABLED is on')
        if cloud_sync_enabled and not cloud_destination:
            status = 'warning'
            issues.append('BACKUP_RCLONE_DESTINATION is empty while BACKUP_CLOUD_SYNC_ENABLED is on')
        if log_to_file and log_backup_count <= 0:
            status = 'warning'
            issues.append('LOG_FILE_BACKUP_COUNT should be greater than 0 when LOG_TO_FILE is enabled')

        if not issues:
            return {
                'status': 'ok',
                'message': (
                    f'Backup/logging settings look acceptable '
                    f'(backup_root={backup_root}, retention_days={retention_days}, '
                    f'cloud_sync={cloud_sync_enabled}, log_to_file={log_to_file})'
                ),
            }
        return {'status': status, 'message': '; '.join(issues)}

    def _check_frontend_env_template(self):
        env_example = Path(settings.BASE_DIR).parent / 'frontend' / '.env.example'
        public_env_example = Path(settings.BASE_DIR).parent / 'frontend' / '.env.public.example'
        backend_hybrid_env = Path(settings.BASE_DIR) / '.env.hybrid.example'
        missing = []
        if not env_example.exists():
            missing.append('frontend/.env.example')
        if not public_env_example.exists():
            missing.append('frontend/.env.public.example')
        if not backend_hybrid_env.exists():
            missing.append('backend/.env.hybrid.example')
        if missing:
            return {'status': 'warning', 'message': f'Missing env templates: {", ".join(missing)}'}
        return {'status': 'ok', 'message': 'Frontend/backend env templates for local and hybrid deploy exist'}

    def _check_paper_optimizer_assets(self):
        backend_snapshot = Path(settings.BASE_DIR) / 'paper_optimizer' / 'reference_data' / 'baseline_guardrail_canonical_v1.json'
        backend_workbook = Path(settings.BASE_DIR) / 'paper_optimizer' / 'reference_data' / 'paper_optimizer_canonical_guardrail_v1.xlsx'
        frontend_snapshot = Path(settings.BASE_DIR).parent / 'frontend' / 'public' / 'paper-optimizer' / 'baseline_guardrail_canonical_v1.json'
        frontend_workbook = Path(settings.BASE_DIR).parent / 'frontend' / 'public' / 'paper-optimizer' / 'paper_optimizer_canonical_guardrail_v1.xlsx'

        missing = [
            str(path.relative_to(Path(settings.BASE_DIR).parent))
            for path in [backend_snapshot, backend_workbook, frontend_snapshot, frontend_workbook]
            if not path.exists()
        ]
        if missing:
            return {
                'status': 'warning',
                'message': f'Paper optimizer canonical assets are missing: {", ".join(missing)}',
            }

        try:
            backend_payload = json.loads(backend_snapshot.read_text(encoding='utf-8'))
            frontend_payload = json.loads(frontend_snapshot.read_text(encoding='utf-8'))
        except Exception as exc:
            return {
                'status': 'warning',
                'message': f'Paper optimizer canonical assets exist but snapshot JSON could not be parsed: {exc}',
            }

        mismatches = []
        if backend_payload.get('config_fingerprint') != frontend_payload.get('config_fingerprint'):
            mismatches.append('config_fingerprint')
        if backend_payload.get('selected_plan_code') != frontend_payload.get('selected_plan_code'):
            mismatches.append('selected_plan_code')
        if backend_payload.get('selected_scenario_code') != frontend_payload.get('selected_scenario_code'):
            mismatches.append('selected_scenario_code')
        if backend_payload.get('selected_source_internal_plan_code') != frontend_payload.get('selected_source_internal_plan_code'):
            mismatches.append('selected_source_internal_plan_code')

        if mismatches:
            return {
                'status': 'warning',
                'message': (
                    'Paper optimizer canonical assets exist but frontend/backend baseline references diverge on: '
                    + ', '.join(mismatches)
                ),
            }

        return {
            'status': 'ok',
            'message': (
                'Paper optimizer canonical assets are present and aligned '
                f"(fingerprint={backend_payload.get('config_fingerprint')})"
            ),
        }

    def _check_paper_optimizer_guardrail(self):
        required_sheet_prefix = [
            'Du_lieu_goc',
            'To_hop_de_xuat',
            'Phuong_an_mua_cuoi',
            'Chi_tiet_phan_bo',
            'Kiem_tra_phan_bo_nguoc',
            'Con_lai_chua_phan_bo',
            'So_sanh_phuong_an_cuoi',
            'Thong_ke_kho_giay',
            'Debug_engine',
        ]
        try:
            report = build_regression_guardrail_report()
        except Exception as exc:
            return {
                'status': 'warning',
                'message': f'Paper optimizer benchmark guardrail could not run: {exc}',
            }

        if not report['passed']:
            failing_cases = ', '.join(
                f"{item['case']}:{item['decision_metric']}"
                for item in report['failing_cases']
            )
            return {
                'status': 'warning',
                'message': f'Paper optimizer benchmark guardrail failed: {failing_cases}',
            }

        try:
            workbook = load_workbook(BytesIO(load_canonical_workbook_bytes()), read_only=True, data_only=True)
            if workbook.sheetnames[:len(required_sheet_prefix)] != required_sheet_prefix:
                return {
                    'status': 'warning',
                    'message': 'Paper optimizer workbook guardrail failed: canonical sheet order does not match required prefix.',
                }
            sheet = workbook['Phuong_an_mua_cuoi']
            headers = [cell.value for cell in next(sheet.iter_rows(min_row=1, max_row=1))]
            required_headers = [
                'Dài mua (cm)',
                'Tổng số bộ mua thật',
                'Tổng chiều dài (cm)',
                'Min chiều dài NCC yêu cầu (cm)',
                'Chiều dài thực tế (cm)',
                'Đạt NCC',
            ]
            missing_headers = [header for header in required_headers if header not in headers]
            if missing_headers:
                return {
                    'status': 'warning',
                    'message': (
                        'Paper optimizer workbook guardrail failed: missing Phuong_an_mua_cuoi headers '
                        + ', '.join(missing_headers)
                    ),
                }

            idx_dai = headers.index('Dài mua (cm)')
            idx_sets = headers.index('Tổng số bộ mua thật')
            idx_total = headers.index('Tổng chiều dài (cm)')
            idx_required = headers.index('Min chiều dài NCC yêu cầu (cm)')
            idx_actual = headers.index('Chiều dài thực tế (cm)')
            idx_ncc = headers.index('Đạt NCC')
            checked_rows = 0
            for row in sheet.iter_rows(min_row=2, values_only=True):
                if row[idx_dai] is None:
                    break
                checked_rows += 1
                expected_total = round(float(row[idx_dai] or 0) * int(row[idx_sets] or 0), 2)
                actual_total = round(float(row[idx_total] or 0), 2)
                ncc_required = round(float(row[idx_required] or 0), 2)
                ncc_actual = round(float(row[idx_actual] or 0), 2)
                ncc_label = str(row[idx_ncc] or '').strip()
                if expected_total != actual_total or actual_total != ncc_actual:
                    return {
                        'status': 'warning',
                        'message': 'Paper optimizer workbook guardrail failed: total length formula drift detected.',
                    }
                expected_ncc = 'Đạt' if ncc_actual >= ncc_required else 'Chưa đạt'
                if ncc_label != expected_ncc:
                    return {
                        'status': 'warning',
                        'message': 'Paper optimizer workbook guardrail failed: NCC label does not match actual per-spec length.',
                    }
            if checked_rows == 0:
                return {
                    'status': 'warning',
                    'message': 'Paper optimizer workbook guardrail failed: canonical workbook has no purchase-spec rows.',
                }
        except Exception as exc:
            return {
                'status': 'warning',
                'message': f'Paper optimizer workbook guardrail could not be verified: {exc}',
            }

        canonical_case = next(
            (item for item in report['results'] if item['case'] == 'canonical_locked'),
            None,
        )
        return {
            'status': 'ok',
            'message': (
                'Paper optimizer benchmark and workbook guardrails passed '
                f"(canonical cost={canonical_case.get('total_converted_cost') if canonical_case else '-'}, "
                f"widths={canonical_case.get('unique_raw_width_count') if canonical_case else '-'})"
            ),
        }

    def _check_hybrid_deploy(self):
        app_env = str(getattr(settings, 'APP_ENV', 'development') or 'development').strip().lower()
        deployment_mode = str(getattr(settings, 'DEPLOYMENT_MODE', 'colocated') or 'colocated').strip().lower()
        frontend_public_url = str(getattr(settings, 'FRONTEND_PUBLIC_URL', '') or '').strip()
        frontend_url = str(getattr(settings, 'FRONTEND_URL', '') or '').strip()
        api_public_url = str(getattr(settings, 'API_PUBLIC_URL', '') or '').strip()
        tunnel_provider = str(getattr(settings, 'TUNNEL_PROVIDER', '') or '').strip().lower()
        cloudflare_tunnel_id = str(getattr(settings, 'CLOUDFLARED_TUNNEL_ID', '') or '').strip()
        cloudflare_config_path = str(getattr(settings, 'CLOUDFLARED_CONFIG_PATH', '') or '').strip()
        backup_cloud_enabled = bool(getattr(settings, 'BACKUP_CLOUD_SYNC_ENABLED', False))
        backup_cloud_provider = str(getattr(settings, 'BACKUP_CLOUD_PROVIDER', '') or '').strip().lower()
        backup_cloud_destination = str(getattr(settings, 'BACKUP_RCLONE_DESTINATION', '') or '').strip()
        proxy_enabled = bool(getattr(settings, 'SECURE_PROXY_SSL_HEADER', None))

        issues = []
        status = 'ok'
        if deployment_mode not in {'colocated', 'hybrid'}:
            status = 'warning'
            issues.append(f'DEPLOYMENT_MODE is not recognized: {deployment_mode}')
        if deployment_mode != 'hybrid':
            return {'status': 'ok', 'message': f'Deployment mode is {deployment_mode}; hybrid checks are informational only'}

        if not frontend_public_url:
            status = 'warning'
            issues.append('FRONTEND_PUBLIC_URL is empty')
        if not api_public_url:
            status = 'warning'
            issues.append('API_PUBLIC_URL is empty')

        parsed_frontend = urlparse(frontend_public_url) if frontend_public_url else None
        parsed_api = urlparse(api_public_url) if api_public_url else None
        if frontend_public_url and frontend_url and frontend_public_url.rstrip('/') != frontend_url.rstrip('/'):
            status = 'warning'
            issues.append('FRONTEND_URL and FRONTEND_PUBLIC_URL should match in hybrid mode')
        if app_env == 'production' and frontend_public_url and parsed_frontend and parsed_frontend.scheme != 'https':
            status = 'warning'
            issues.append('FRONTEND_PUBLIC_URL should use https in production hybrid mode')
        if app_env == 'production' and api_public_url and parsed_api and parsed_api.scheme != 'https':
            status = 'warning'
            issues.append('API_PUBLIC_URL should use https in production hybrid mode')
        normalized_api_public_url = api_public_url.rstrip('/')
        api_path = parsed_api.path.rstrip('/') if parsed_api else normalized_api_public_url
        if api_public_url and api_path != '/api':
            status = 'warning'
            issues.append('API_PUBLIC_URL should end with /api')
        if not proxy_enabled:
            status = 'warning'
            issues.append('USE_X_FORWARDED_PROTO should be enabled for hybrid https/public traffic')
        if tunnel_provider != 'cloudflared':
            status = 'warning'
            issues.append('TUNNEL_PROVIDER should be cloudflared for the default hybrid setup')
        if tunnel_provider == 'cloudflared' and not cloudflare_tunnel_id:
            status = 'warning'
            issues.append('CLOUDFLARED_TUNNEL_ID is empty')
        if tunnel_provider == 'cloudflared' and not cloudflare_config_path:
            status = 'warning'
            issues.append('CLOUDFLARED_CONFIG_PATH is empty')
        if not backup_cloud_enabled:
            status = 'warning'
            issues.append('BACKUP_CLOUD_SYNC_ENABLED should be on for hybrid mode')
        if backup_cloud_enabled and backup_cloud_provider != 'rclone':
            status = 'warning'
            issues.append('BACKUP_CLOUD_PROVIDER should be rclone for the default Google Drive sync setup')
        if backup_cloud_enabled and not backup_cloud_destination:
            status = 'warning'
            issues.append('BACKUP_RCLONE_DESTINATION is empty')

        if not issues:
            frontend_host = parsed_frontend.netloc if parsed_frontend else frontend_public_url
            api_host = parsed_api.netloc if parsed_api else api_public_url
            return {
                'status': 'ok',
                'message': (
                    f'Hybrid deploy looks ready '
                    f'(frontend={frontend_host}, api={api_host}, tunnel={tunnel_provider}, backup_sync={backup_cloud_provider})'
                ),
            }
        return {'status': status, 'message': '; '.join(issues)}

    def _check_monitoring(self):
        app_env = getattr(settings, 'APP_ENV', 'development')
        sentry_dsn = getattr(settings, 'SENTRY_DSN', '')
        log_to_file = getattr(settings, 'LOG_TO_FILE', False)
        log_dir = Path(getattr(settings, 'LOG_DIR', settings.BASE_DIR / 'logs'))
        alert_email_recipients = list(getattr(settings, 'ALERT_EMAIL_RECIPIENTS', []) or [])
        slack_webhook = str(getattr(settings, 'ALERT_SLACK_WEBHOOK_URL', '') or '').strip()
        telegram_token = str(getattr(settings, 'ALERT_TELEGRAM_BOT_TOKEN', '') or '').strip()
        telegram_chat_id = str(getattr(settings, 'ALERT_TELEGRAM_CHAT_ID', '') or '').strip()
        required_channel_count = max(0, int(getattr(settings, 'ALERT_REQUIRED_CHANNEL_COUNT', 0) or 0))
        required_channels = [
            str(item).strip().lower()
            for item in (getattr(settings, 'ALERT_REQUIRED_CHANNELS', []) or [])
            if str(item).strip().lower() in {'email', 'slack', 'telegram', 'sentry'}
        ]
        default_from_email = str(getattr(settings, 'DEFAULT_FROM_EMAIL', '') or '').strip()
        server_email = str(getattr(settings, 'SERVER_EMAIL', '') or '').strip()
        incident_runbook = str(getattr(settings, 'INCIDENT_RUNBOOK_URL', '') or '').strip()
        incident_contacts = list(getattr(settings, 'INCIDENT_CONTACT_EMAILS', []) or [])
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
        configured_alert_channels = 0
        configured_alert_channels += 1 if sentry_dsn else 0
        configured_alert_channels += 1 if alert_email_recipients else 0
        configured_alert_channels += 1 if slack_webhook else 0
        configured_alert_channels += 1 if (telegram_token and telegram_chat_id) else 0
        if app_env == 'production' and configured_alert_channels == 0:
            status = 'warning'
            messages.append('No production alert channel is configured (email/slack/telegram/sentry)')
        if required_channel_count > 0 and configured_alert_channels < required_channel_count:
            status = 'warning'
            messages.append(
                f'Configured alert channels ({configured_alert_channels}) are below ALERT_REQUIRED_CHANNEL_COUNT ({required_channel_count})'
            )
        if app_env == 'production' and not alert_email_recipients:
            status = 'warning'
            messages.append('ALERT_EMAIL_RECIPIENTS is empty')
        if 'email' in required_channels and not alert_email_recipients:
            status = 'warning'
            messages.append('Email is listed in ALERT_REQUIRED_CHANNELS but ALERT_EMAIL_RECIPIENTS is empty')
        if 'slack' in required_channels and not slack_webhook:
            status = 'warning'
            messages.append('Slack is listed in ALERT_REQUIRED_CHANNELS but ALERT_SLACK_WEBHOOK_URL is empty')
        if 'telegram' in required_channels and not (telegram_token and telegram_chat_id):
            status = 'warning'
            messages.append('Telegram is listed in ALERT_REQUIRED_CHANNELS but token/chat id is incomplete')
        if 'sentry' in required_channels and not sentry_dsn:
            status = 'warning'
            messages.append('Sentry is listed in ALERT_REQUIRED_CHANNELS but SENTRY_DSN is empty')
        if alert_email_recipients and not default_from_email:
            status = 'warning'
            messages.append('DEFAULT_FROM_EMAIL is empty while email alerts are configured')
        if alert_email_recipients and not server_email:
            status = 'warning'
            messages.append('SERVER_EMAIL is empty while email alerts are configured')
        if app_env == 'production' and not incident_runbook:
            status = 'warning'
            messages.append('INCIDENT_RUNBOOK_URL is empty')
        if app_env == 'production' and not incident_contacts:
            status = 'warning'
            messages.append('INCIDENT_CONTACT_EMAILS is empty')
        if not messages:
            messages.append('Monitoring hooks look acceptable')
        return {'status': status, 'message': '; '.join(messages)}

    def _check_audit_controls(self):
        retention_days = int(getattr(settings, 'AUDIT_LOG_RETENTION_DAYS', 0) or 0)
        export_max_rows = int(getattr(settings, 'AUDIT_EXPORT_MAX_ROWS', 0) or 0)
        incident_runbook = str(getattr(settings, 'INCIDENT_RUNBOOK_URL', '') or '').strip()
        status = 'ok'
        issues = []
        if retention_days <= 0:
            status = 'warning'
            issues.append('AUDIT_LOG_RETENTION_DAYS should be greater than 0')
        if export_max_rows <= 0:
            status = 'warning'
            issues.append('AUDIT_EXPORT_MAX_ROWS should be greater than 0')
        if getattr(settings, 'APP_ENV', 'development') == 'production' and not incident_runbook:
            status = 'warning'
            issues.append('INCIDENT_RUNBOOK_URL is empty')
        if not issues:
            return {
                'status': 'ok',
                'message': (
                    f'Audit controls look acceptable '
                    f'(retention_days={retention_days}, export_max_rows={export_max_rows})'
                ),
            }
        return {'status': status, 'message': '; '.join(issues)}

    def handle(self, *args, **options):
        checks = {
            'env_vars': self._check_env_vars(),
            'database': self._check_database(),
            'media': self._check_media(),
            'backup_tools': self._check_backup_tools(),
            'q_cluster': self._check_q_cluster(),
            'security_flags': self._check_security_flags(),
            'domains_cors': self._check_domains_and_cors(),
            'email': self._check_email(),
            'jwt_sessions': self._check_jwt_and_sessions(),
            'backup_logging': self._check_backup_and_logging(),
            'frontend_env': self._check_frontend_env_template(),
            'paper_optimizer_assets': self._check_paper_optimizer_assets(),
            'paper_optimizer_guardrail': self._check_paper_optimizer_guardrail(),
            'hybrid_deploy': self._check_hybrid_deploy(),
            'monitoring': self._check_monitoring(),
            'audit_controls': self._check_audit_controls(),
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
