from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    initial = True

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name='PaperOptimizerSupplierTemplate',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('name', models.CharField(max_length=120)),
                ('note', models.TextField(blank=True, default='')),
                ('supplier_config', models.JSONField(default=dict)),
                ('optimization_config', models.JSONField(default=dict)),
                ('is_system_default', models.BooleanField(default=False)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('created_by', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='paper_optimizer_templates_created', to=settings.AUTH_USER_MODEL)),
            ],
            options={
                'db_table': 'paper_optimizer_recovery_supplier_templates',
                'ordering': ['-is_system_default', 'name', '-created_at'],
            },
        ),
        migrations.CreateModel(
            name='PaperOptimizerRun',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('code', models.CharField(max_length=64, unique=True)),
                ('status', models.CharField(choices=[('SUCCESS', 'Success'), ('FAILED', 'Failed')], default='SUCCESS', max_length=16)),
                ('source_filename', models.CharField(blank=True, default='', max_length=255)),
                ('note', models.TextField(blank=True, default='')),
                ('input_lines', models.JSONField(default=list)),
                ('supplier_config', models.JSONField(default=dict)),
                ('optimization_config', models.JSONField(default=dict)),
                ('preview_rows', models.JSONField(blank=True, default=list)),
                ('result_payload', models.JSONField(blank=True, default=dict)),
                ('recovery_mode', models.BooleanField(default=False)),
                ('canonical_match', models.BooleanField(default=False)),
                ('failed_reason', models.TextField(blank=True, default='')),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('created_by', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='paper_optimizer_runs_created', to=settings.AUTH_USER_MODEL)),
            ],
            options={
                'db_table': 'paper_optimizer_recovery_runs',
                'ordering': ['-created_at'],
            },
        ),
    ]
