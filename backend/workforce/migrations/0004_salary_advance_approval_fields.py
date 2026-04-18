from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ('workforce', '0003_salary_advance_payroll'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.AddField(
            model_name='salaryadvancerecord',
            name='approval_status',
            field=models.CharField(
                choices=[
                    ('DRAFT', 'Nháp'),
                    ('PENDING_L1', 'Chờ duyệt cấp 1'),
                    ('PENDING_L2', 'Chờ duyệt cấp 2'),
                    ('APPROVED', 'Đã duyệt'),
                    ('REJECTED', 'Từ chối'),
                ],
                default='APPROVED',
                max_length=20,
                verbose_name='Trạng thái duyệt',
            ),
        ),
        migrations.AddField(
            model_name='salaryadvancerecord',
            name='required_approval_level',
            field=models.PositiveSmallIntegerField(default=1, verbose_name='Số cấp duyệt yêu cầu'),
        ),
        migrations.AddField(
            model_name='salaryadvancerecord',
            name='submitted_at',
            field=models.DateTimeField(blank=True, null=True, verbose_name='Thời điểm gửi duyệt'),
        ),
        migrations.AddField(
            model_name='salaryadvancerecord',
            name='submitted_by',
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name='workforce_salary_advance_submitted',
                to=settings.AUTH_USER_MODEL,
            ),
        ),
        migrations.AddField(
            model_name='salaryadvancerecord',
            name='approved_level1_at',
            field=models.DateTimeField(blank=True, null=True, verbose_name='Thời điểm duyệt cấp 1'),
        ),
        migrations.AddField(
            model_name='salaryadvancerecord',
            name='approved_level1_by',
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name='workforce_salary_advance_approved_l1',
                to=settings.AUTH_USER_MODEL,
            ),
        ),
        migrations.AddField(
            model_name='salaryadvancerecord',
            name='approved_level2_at',
            field=models.DateTimeField(blank=True, null=True, verbose_name='Thời điểm duyệt cấp 2'),
        ),
        migrations.AddField(
            model_name='salaryadvancerecord',
            name='approved_level2_by',
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name='workforce_salary_advance_approved_l2',
                to=settings.AUTH_USER_MODEL,
            ),
        ),
        migrations.AddField(
            model_name='salaryadvancerecord',
            name='rejected_at',
            field=models.DateTimeField(blank=True, null=True, verbose_name='Thời điểm từ chối'),
        ),
        migrations.AddField(
            model_name='salaryadvancerecord',
            name='rejected_by',
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name='workforce_salary_advance_rejected',
                to=settings.AUTH_USER_MODEL,
            ),
        ),
        migrations.AddField(
            model_name='salaryadvancerecord',
            name='rejection_reason',
            field=models.CharField(blank=True, default='', max_length=255, verbose_name='Lý do từ chối'),
        ),
        migrations.AddIndex(
            model_name='salaryadvancerecord',
            index=models.Index(fields=['approval_status'], name='workforce_s_approva_7b7f3e_idx'),
        ),
    ]
