"""
Migration 0042: WorkflowTaskTemplate model + source_key on Task.
"""
from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0041_task_pin_and_tags'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        # 1. source_key trên Task (idempotency)
        migrations.AddField(
            model_name='task',
            name='source_key',
            field=models.CharField(
                blank=True, max_length=200, null=True, unique=True,
                verbose_name='Khóa nguồn gốc',
                help_text='Định danh duy nhất khi sinh tự động từ template.',
            ),
        ),

        # 2. Bảng WorkflowTaskTemplate
        migrations.CreateModel(
            name='WorkflowTaskTemplate',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('entity_type', models.CharField(max_length=50, verbose_name='Loại đối tượng')),
                ('trigger', models.CharField(
                    max_length=50,
                    choices=[
                        ('SUBMIT', 'Nộp duyệt'),
                        ('APPROVE', 'Phê duyệt'),
                        ('REJECT', 'Từ chối'),
                        ('POST', 'Đăng sổ (Post)'),
                        ('VOID', 'Hủy (Void)'),
                        ('MANUAL', 'Thủ công'),
                    ],
                    verbose_name='Sự kiện kích hoạt',
                )),
                ('title_template', models.CharField(max_length=200, verbose_name='Tiêu đề nhiệm vụ')),
                ('description_template', models.TextField(blank=True, verbose_name='Mô tả nhiệm vụ')),
                ('assign_rule', models.JSONField(blank=True, default=dict, verbose_name='Quy tắc gán người')),
                ('due_in_days', models.PositiveSmallIntegerField(default=3, verbose_name='Hạn hoàn thành (ngày)')),
                ('priority', models.CharField(
                    choices=[
                        ('LOW', 'Thấp'),
                        ('MEDIUM', 'Trung bình'),
                        ('HIGH', 'Cao'),
                        ('URGENT', 'Khẩn cấp'),
                    ],
                    default='MEDIUM', max_length=20, verbose_name='Ưu tiên',
                )),
                ('is_blocking', models.BooleanField(default=False, verbose_name='Chặn sản xuất')),
                ('blocks_action', models.CharField(blank=True, max_length=50, verbose_name='Hành động bị chặn')),
                ('tags', models.JSONField(blank=True, default=list, verbose_name='Nhãn')),
                ('sort_order', models.PositiveSmallIntegerField(default=0, verbose_name='Thứ tự')),
                ('is_active', models.BooleanField(default=True, verbose_name='Kích hoạt')),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('created_by', models.ForeignKey(
                    blank=True, null=True,
                    on_delete=django.db.models.deletion.SET_NULL,
                    related_name='created_workflow_templates',
                    to=settings.AUTH_USER_MODEL,
                    verbose_name='Người tạo',
                )),
            ],
            options={
                'verbose_name': 'Mẫu nhiệm vụ workflow',
                'verbose_name_plural': 'Mẫu nhiệm vụ workflow',
                'db_table': 'workflow_task_templates',
                'ordering': ['entity_type', 'trigger', 'sort_order', 'id'],
            },
        ),

        # 3. Index
        migrations.AddIndex(
            model_name='workflowtasktemplate',
            index=models.Index(
                fields=['entity_type', 'trigger', 'is_active'],
                name='wft_entity_trigger_active_idx',
            ),
        ),
    ]
