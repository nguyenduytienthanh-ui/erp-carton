from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0045_rename_wpe_entity_idx_workflow_pi_entity__eae923_idx_and_more'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name='TaskWatcher',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('task', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='watchers', to='core.task', verbose_name='Nhiệm vụ')),
                ('user', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='watched_tasks', to=settings.AUTH_USER_MODEL, verbose_name='Người theo dõi')),
            ],
            options={
                'verbose_name': 'Theo dõi nhiệm vụ',
                'verbose_name_plural': 'Theo dõi nhiệm vụ',
                'db_table': 'task_watchers',
                'unique_together': {('task', 'user')},
            },
        ),
        migrations.AddIndex(
            model_name='taskwatcher',
            index=models.Index(fields=['user', 'created_at'], name='task_watche_user_id_8d1637_idx'),
        ),
        migrations.AddIndex(
            model_name='taskwatcher',
            index=models.Index(fields=['task', 'created_at'], name='task_watche_task_id_b0086c_idx'),
        ),
    ]
