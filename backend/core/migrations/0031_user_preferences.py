# Generated manually for UserPreferences model

from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0030_enable_trigram'),
    ]

    operations = [
        migrations.CreateModel(
            name='UserPreferences',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('page', models.CharField(help_text='VD: products-list, dashboard, settings...', max_length=50, verbose_name='Trang')),
                ('config', models.JSONField(default=dict, help_text='JSON tự do: {columns, filters, theme, ...}', verbose_name='Cấu hình')),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('user', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='preferences', to=settings.AUTH_USER_MODEL, verbose_name='Người dùng')),
            ],
            options={
                'verbose_name': 'Cấu hình người dùng',
                'verbose_name_plural': 'Cấu hình người dùng',
                'db_table': 'user_preferences',
            },
        ),
        migrations.AddIndex(
            model_name='userpreferences',
            index=models.Index(fields=['user', 'page'], name='user_pref_user_page_idx'),
        ),
        migrations.AlterUniqueTogether(
            name='userpreferences',
            unique_together={('user', 'page')},
        ),
    ]
