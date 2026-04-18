from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ('finance', '0006_add_general_ledger_models'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name='BankReconciliation',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('search_text', models.TextField(blank=True, default='')),
                ('code', models.CharField(max_length=30, unique=True, verbose_name='Mã đối soát')),
                ('statement_date', models.DateField(verbose_name='Ngày sao kê')),
                ('statement_balance', models.DecimalField(decimal_places=2, default=0, max_digits=18, verbose_name='Số dư sao kê')),
                ('book_balance', models.DecimalField(decimal_places=2, default=0, max_digits=18, verbose_name='Số dư sổ')),
                ('delta', models.DecimalField(decimal_places=2, default=0, max_digits=18, verbose_name='Chênh lệch')),
                ('status', models.CharField(choices=[('DRAFT', 'Nháp'), ('APPROVED', 'Đã duyệt'), ('POSTED', 'Đã post')], default='DRAFT', max_length=20)),
                ('reference', models.CharField(blank=True, default='', max_length=200, verbose_name='Tham chiếu')),
                ('note', models.TextField(blank=True, default='', verbose_name='Ghi chú')),
                ('approved_at', models.DateTimeField(blank=True, null=True)),
                ('posted_at', models.DateTimeField(blank=True, null=True)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('approved_by', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='finance_bank_reconciliations_approved', to=settings.AUTH_USER_MODEL)),
                ('bank_account', models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name='bank_reconciliations', to='finance.bankaccount', verbose_name='Tài khoản ngân hàng')),
                ('created_by', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='finance_bank_reconciliations_created', to=settings.AUTH_USER_MODEL)),
                ('posted_by', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='finance_bank_reconciliations_posted', to=settings.AUTH_USER_MODEL)),
                ('updated_by', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='finance_bank_reconciliations_updated', to=settings.AUTH_USER_MODEL)),
            ],
            options={
                'db_table': 'finance_bank_reconciliations',
                'ordering': ['-statement_date', '-id'],
                'indexes': [
                    models.Index(fields=['code'], name='finance_ban_code_0225b3_idx'),
                    models.Index(fields=['statement_date'], name='finance_ban_stateme_2398ad_idx'),
                    models.Index(fields=['status'], name='finance_ban_status_af6fb1_idx'),
                    models.Index(fields=['bank_account'], name='finance_ban_bank_ac_d99f54_idx'),
                ],
            },
        ),
    ]
