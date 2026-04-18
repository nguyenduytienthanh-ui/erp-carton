import json
from io import StringIO

from django.core.management import call_command
from django.core.management.base import BaseCommand, CommandError
from django.utils import timezone

from core.management.commands.preflight_check import Command as PreflightCommand
from core.release_readiness import (
    get_alert_delivery_health_payload,
    get_alert_channel_status_payload,
    get_backup_inventory_payload,
    get_critical_data_snapshot,
    get_email_delivery_health_payload,
    get_pending_migration_summary,
    get_performance_readiness_payload,
    get_release_hygiene_payload,
    get_uat_user_matrix_snapshot,
)


class Command(BaseCommand):
    help = 'Build a release readiness report for staging/UAT/production promotion checks'

    def add_arguments(self, parser):
        parser.add_argument('--json', action='store_true', help='Print result as JSON')
        parser.add_argument('--strict', action='store_true', help='Exit non-zero on warnings and errors')
        parser.add_argument('--hours', type=int, default=24, help='Hours window for email delivery checks')

    @staticmethod
    def _status_rank(value):
        return {'ok': 0, 'warning': 1, 'error': 2}.get(str(value or '').lower(), 2)

    def _build_preflight_checks(self):
        preflight = PreflightCommand()
        return {
            'env_vars': preflight._check_env_vars(),
            'database': preflight._check_database(),
            'media': preflight._check_media(),
            'backup_tools': preflight._check_backup_tools(),
            'q_cluster': preflight._check_q_cluster(),
            'security_flags': preflight._check_security_flags(),
            'domains_cors': preflight._check_domains_and_cors(),
            'email': preflight._check_email(),
            'jwt_sessions': preflight._check_jwt_and_sessions(),
            'backup_logging': preflight._check_backup_and_logging(),
            'frontend_env': preflight._check_frontend_env_template(),
            'paper_optimizer_assets': preflight._check_paper_optimizer_assets(),
            'paper_optimizer_guardrail': preflight._check_paper_optimizer_guardrail(),
            'hybrid_deploy': preflight._check_hybrid_deploy(),
            'monitoring': preflight._check_monitoring(),
            'audit_controls': preflight._check_audit_controls(),
        }

    def _build_performance_drilldown(self):
        stdout = StringIO()
        call_command('performance_drilldown', '--json', stdout=stdout)
        return json.loads(stdout.getvalue())

    def _build_recommendations(self, payload):
        recommendations = []
        if int(payload['migrations']['pending_count']) > 0:
            recommendations.append('Apply pending migrations on staging before UAT or production cutover.')
        if payload['backups']['status'] != 'ok':
            recommendations.append('Run a fresh backup and verify restore drill before go-live.')
        if payload['backups'].get('restore_drill_status') != 'ok':
            recommendations.append('Run a restore dry-run against the latest backup bundle and capture the verification result.')
        if payload['backups'].get('cloud_sync_status') != 'ok':
            recommendations.append('Sync the latest backup bundle to Google Drive via rclone and confirm cloud_sync.json reports success.')
        if payload['alerts']['status'] != 'ok':
            recommendations.append('Run alert channel readiness, then configure the missing monitored channels and escalation metadata.')
        if payload['alert_delivery']['status'] != 'ok':
            recommendations.append('Send a test alert through configured channels and confirm receipt in the monitoring bridge.')
        if payload['uat_personas']['missing_count'] > 0:
            recommendations.append('Bootstrap or repair missing UAT persona accounts before role-based testing.')
        if payload['email_delivery']['status_counts']['FAILED'] > 0:
            recommendations.append('Investigate recent mail delivery failures and confirm notification paths.')
        if payload['release_hygiene']['status'] != 'ok':
            recommendations.append('Clean the release branch, lock the migration list, and remove generated artifacts before tagging.')
        if payload['preflight']['checks']['paper_optimizer_guardrail']['status'] != 'ok':
            recommendations.append('Regenerate or repair paper optimizer benchmark/workbook guardrails before promotion.')
        if payload['performance_drilldown']['status'] != 'ok':
            recommendations.append('Run large-data rehearsal on the flagged command centers and review query/index behavior.')
        elif payload['performance']['status'] != 'ok':
            recommendations.append('Capture current performance drilldown output in the release packet for the flagged command centers.')
        return recommendations

    def handle(self, *args, **options):
        preflight_checks = self._build_preflight_checks()
        preflight_worst = max(self._status_rank(item['status']) for item in preflight_checks.values())
        preflight_status = 'ok' if preflight_worst == 0 else 'warning' if preflight_worst == 1 else 'error'

        hours = max(1, min(int(options.get('hours') or 24), 168))
        payload = {
            'generated_at': timezone.now(),
            'preflight': {
                'overall_status': preflight_status,
                'checks': preflight_checks,
            },
            'migrations': get_pending_migration_summary(),
            'data_snapshot': get_critical_data_snapshot(),
            'backups': get_backup_inventory_payload(),
            'alerts': get_alert_channel_status_payload(),
            'alert_delivery': get_alert_delivery_health_payload(hours=max(hours, 24)),
            'email_delivery': get_email_delivery_health_payload(hours=hours),
            'uat_personas': get_uat_user_matrix_snapshot(),
            'release_hygiene': get_release_hygiene_payload(),
            'performance': get_performance_readiness_payload(),
            'performance_drilldown': self._build_performance_drilldown(),
        }
        payload['recommendations'] = self._build_recommendations(payload)

        worst = max(
            [
                self._status_rank(preflight_status),
                1 if int(payload['migrations']['pending_count']) > 0 else 0,
                self._status_rank(payload['backups']['status']),
                self._status_rank(payload['backups'].get('restore_drill_status')),
                self._status_rank(payload['backups'].get('cloud_sync_status')),
                self._status_rank(payload['alerts']['status']),
                self._status_rank(payload['alert_delivery']['status']),
                self._status_rank(payload['email_delivery']['status']),
                self._status_rank(payload['release_hygiene']['status']),
                self._status_rank(payload['performance_drilldown']['status']),
            ]
        )
        payload['overall_status'] = 'ok' if worst == 0 else 'warning' if worst == 1 else 'error'

        if options['json']:
            self.stdout.write(json.dumps(payload, ensure_ascii=False, indent=2, default=str))
        else:
            self.stdout.write(f"Release readiness: {payload['overall_status'].upper()}")
            self.stdout.write(f"- preflight: {preflight_status.upper()}")
            self.stdout.write(f"- pending migrations: {payload['migrations']['pending_count']}")
            self.stdout.write(f"- latest backup status: {payload['backups']['status'].upper()}")
            self.stdout.write(f"- restore drill: {str(payload['backups'].get('restore_drill_status', 'warning')).upper()}")
            self.stdout.write(f"- cloud sync: {str(payload['backups'].get('cloud_sync_status', 'warning')).upper()}")
            self.stdout.write(f"- alert channels: {payload['alerts']['configured_count']} configured")
            self.stdout.write(f"- alert delivery: {payload['alert_delivery']['status'].upper()}")
            self.stdout.write(f"- email failures ({hours}h): {payload['email_delivery']['status_counts']['FAILED']}")
            self.stdout.write(f"- missing UAT personas: {payload['uat_personas']['missing_count']}")
            self.stdout.write(f"- release hygiene: {payload['release_hygiene']['status'].upper()}")
            self.stdout.write(f"- performance rehearsal: {payload['performance']['status'].upper()}")
            self.stdout.write(f"- performance drilldown: {payload['performance_drilldown']['status'].upper()}")
            if payload['recommendations']:
                self.stdout.write('Recommendations:')
                for item in payload['recommendations']:
                    self.stdout.write(f'  - {item}')

        if options['strict'] and payload['overall_status'] in {'warning', 'error'}:
            raise CommandError(f"Release readiness failed with status {payload['overall_status']}")
