from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0042_workflowtasktemplate_task_source_key'),
    ]

    operations = [
        migrations.AddField(
            model_name='workflowtasktemplate',
            name='depends_on_previous',
            field=models.BooleanField(
                default=True,
                help_text='Bật: task sinh từ mẫu này sẽ phụ thuộc task của mẫu đứng ngay trước theo thứ tự.',
                verbose_name='Phụ thuộc bước trước',
            ),
        ),
    ]
