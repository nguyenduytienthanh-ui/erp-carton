from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ('finance', '0001_initial'),
    ]

    operations = [
        migrations.CreateModel(
            name='AdvanceTransaction',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('search_text', models.TextField(blank=True, default='')),
                ('code', models.CharField(max_length=30, unique=True, verbose_name='Mã tạm ứng')),
                ('advance_type', models.CharField(choices=[('PURCHASE', 'Tạm ứng mua hàng'), ('SALARY', 'Tạm ứng lương'), ('OTHER', 'Tạm ứng khác')], default='PURCHASE', max_length=20, verbose_name='Loại tạm ứng')),
                ('advance_date', models.DateField(verbose_name='Ngày tạm ứng')),
                ('recipient_name', models.CharField(max_length=255, verbose_name='Người nhận tạm ứng')),
                ('source_type', models.CharField(choices=[('CASH', 'Tiền mặt / Quỹ'), ('BANK', 'Ngân hàng')], default='CASH', max_length=20, verbose_name='Nguồn tiền')),
                ('amount', models.DecimalField(decimal_places=2, max_digits=15, verbose_name='Số tiền tạm ứng')),
                ('purpose', models.CharField(blank=True, default='', max_length=255, verbose_name='Mục đích')),
                ('note', models.TextField(blank=True, default='', verbose_name='Ghi chú')),
                ('status', models.CharField(choices=[('OPEN', 'Chưa quyết toán'), ('PARTIAL', 'Đang quyết toán'), ('SETTLED', 'Đã quyết toán'), ('CANCELLED', 'Đã hủy')], default='OPEN', max_length=20, verbose_name='Trạng thái')),
                ('is_active', models.BooleanField(default=True, verbose_name='Đang dùng')),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('created_by', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='finance_advance_transactions_created', to=settings.AUTH_USER_MODEL)),
                ('source_bank_account', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='advance_transactions_from_bank', to='finance.bankaccount', verbose_name='Tài khoản nguồn (ngân hàng)')),
                ('source_cash_account', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='advance_transactions_from_cash', to='finance.cashaccount', verbose_name='Tài khoản nguồn (quỹ)')),
                ('updated_by', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='finance_advance_transactions_updated', to=settings.AUTH_USER_MODEL)),
            ],
            options={
                'db_table': 'finance_advance_transactions',
                'ordering': ['-advance_date', '-id'],
                'indexes': [
                    models.Index(fields=['code'], name='finance_adv_code_eeb4ec_idx'),
                    models.Index(fields=['advance_date'], name='finance_adv_advance_90889c_idx'),
                    models.Index(fields=['advance_type'], name='finance_adv_advance_b15486_idx'),
                    models.Index(fields=['status'], name='finance_adv_status_00e1cb_idx'),
                    models.Index(fields=['is_active'], name='finance_adv_is_acti_5cf4a7_idx'),
                ],
            },
        ),
        migrations.CreateModel(
            name='AdvanceSettlement',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('search_text', models.TextField(blank=True, default='')),
                ('settlement_date', models.DateField(verbose_name='Ngày quyết toán')),
                ('spent_amount', models.DecimalField(decimal_places=2, default=0, max_digits=15, verbose_name='Chi thực tế')),
                ('refund_amount', models.DecimalField(decimal_places=2, default=0, max_digits=15, verbose_name='Hoàn ứng')),
                ('note', models.TextField(blank=True, default='', verbose_name='Ghi chú')),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('advance_transaction', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='settlements', to='finance.advancetransaction', verbose_name='Phiếu tạm ứng')),
                ('created_by', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='finance_advance_settlements_created', to=settings.AUTH_USER_MODEL)),
                ('updated_by', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='finance_advance_settlements_updated', to=settings.AUTH_USER_MODEL)),
            ],
            options={
                'db_table': 'finance_advance_settlements',
                'ordering': ['-settlement_date', '-id'],
                'indexes': [
                    models.Index(fields=['settlement_date'], name='finance_adv_settle_6bb21f_idx'),
                    models.Index(fields=['advance_transaction'], name='finance_adv_advanc_99711c_idx'),
                ],
            },
        ),
    ]

