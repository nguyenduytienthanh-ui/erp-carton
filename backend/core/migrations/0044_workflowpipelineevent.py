from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0043_workflowtasktemplate_depends_on_previous'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name='WorkflowPipelineEvent',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('entity_type', models.CharField(db_index=True, max_length=50, verbose_name='Loại đối tượng')),
                ('entity_id', models.PositiveIntegerField(db_index=True, verbose_name='ID đối tượng')),
                ('entity_code', models.CharField(blank=True, max_length=100, verbose_name='Mã đối tượng')),
                ('trigger', models.CharField(blank=True, max_length=50, verbose_name='Trigger')),
                ('action', models.CharField(choices=[('ADVANCE', 'Chuyển bước'), ('MOVE', 'Di chuyển cột'), ('FAIL', 'Thất bại'), ('GENERATE', 'Sinh task')], max_length=20, verbose_name='Hành động')),
                ('from_step', models.CharField(blank=True, max_length=200, verbose_name='Từ bước')),
                ('to_step', models.CharField(blank=True, max_length=200, verbose_name='Đến bước')),
                ('note', models.TextField(blank=True, verbose_name='Ghi chú')),
                ('created_at', models.DateTimeField(auto_now_add=True, db_index=True)),
                ('actor', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='workflow_pipeline_events', to=settings.AUTH_USER_MODEL, verbose_name='Người thao tác')),
                ('task', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='pipeline_events', to='core.task', verbose_name='Task liên quan')),
            ],
            options={
                'verbose_name': 'Sự kiện pipeline workflow',
                'verbose_name_plural': 'Sự kiện pipeline workflow',
                'db_table': 'workflow_pipeline_events',
                'ordering': ['-created_at', '-id'],
            },
        ),
        migrations.AddIndex(
            model_name='workflowpipelineevent',
            index=models.Index(fields=['entity_type', 'entity_id', 'created_at'], name='wpe_entity_idx'),
        ),
    ]
