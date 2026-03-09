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
            name='BankAccount',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('search_text', models.TextField(blank=True, default='')),
                ('code', models.CharField(max_length=30, unique=True, verbose_name='Mã')),
                ('account_number', models.CharField(max_length=50, unique=True, verbose_name='Số tài khoản')),
                ('account_name', models.CharField(max_length=255, verbose_name='Tên chủ tài khoản')),
                ('bank_name', models.CharField(max_length=150, verbose_name='Ngân hàng')),
                ('branch', models.CharField(blank=True, default='', max_length=150, verbose_name='Chi nhánh')),
                ('note', models.TextField(blank=True, default='', verbose_name='Ghi chú')),
                ('is_active', models.BooleanField(default=True, verbose_name='Đang dùng')),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('created_by', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='finance_bank_accounts_created', to=settings.AUTH_USER_MODEL)),
                ('updated_by', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='finance_bank_accounts_updated', to=settings.AUTH_USER_MODEL)),
            ],
            options={
                'db_table': 'finance_bank_accounts',
                'ordering': ['code'],
                'indexes': [
                    models.Index(fields=['code'], name='finance_ban_code_ff04c6_idx'),
                    models.Index(fields=['account_number'], name='finance_ban_account_536997_idx'),
                    models.Index(fields=['bank_name'], name='finance_ban_bank_na_64b2fb_idx'),
                    models.Index(fields=['is_active'], name='finance_ban_is_acti_8e3086_idx'),
                ],
            },
        ),
        migrations.CreateModel(
            name='CashAccount',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('search_text', models.TextField(blank=True, default='')),
                ('name', models.CharField(max_length=150, verbose_name='Tên tài khoản')),
                ('account_type', models.CharField(choices=[('CASH', 'Tiền mặt'), ('FUND', 'Quỹ')], default='CASH', max_length=20, verbose_name='Loại')),
                ('balance', models.DecimalField(decimal_places=2, default=0, max_digits=15, verbose_name='Số dư')),
                ('note', models.TextField(blank=True, default='', verbose_name='Ghi chú')),
                ('is_active', models.BooleanField(default=True, verbose_name='Đang dùng')),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('created_by', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='finance_cash_accounts_created', to=settings.AUTH_USER_MODEL)),
                ('updated_by', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='finance_cash_accounts_updated', to=settings.AUTH_USER_MODEL)),
            ],
            options={
                'db_table': 'finance_cash_accounts',
                'ordering': ['name'],
                'indexes': [
                    models.Index(fields=['name'], name='finance_cas_name_590a16_idx'),
                    models.Index(fields=['account_type'], name='finance_cas_account_c8b995_idx'),
                    models.Index(fields=['is_active'], name='finance_cas_is_acti_ef65f4_idx'),
                ],
            },
        ),
        migrations.CreateModel(
            name='TransactionCategory',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('search_text', models.TextField(blank=True, default='')),
                ('code', models.CharField(max_length=20, unique=True, verbose_name='Mã')),
                ('name', models.CharField(max_length=150, verbose_name='Tên loại')),
                ('category_type', models.CharField(choices=[('INCOME', 'Thu'), ('EXPENSE', 'Chi')], max_length=20, verbose_name='Loại')),
                ('color', models.CharField(default='#1677ff', max_length=20, verbose_name='Màu hiển thị')),
                ('note', models.TextField(blank=True, default='', verbose_name='Ghi chú')),
                ('is_system', models.BooleanField(default=False, verbose_name='Danh mục hệ thống')),
                ('is_active', models.BooleanField(default=True, verbose_name='Đang dùng')),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('created_by', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='finance_categories_created', to=settings.AUTH_USER_MODEL)),
                ('updated_by', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='finance_categories_updated', to=settings.AUTH_USER_MODEL)),
            ],
            options={
                'db_table': 'finance_transaction_categories',
                'ordering': ['code'],
                'indexes': [
                    models.Index(fields=['code'], name='finance_tra_code_7768fd_idx'),
                    models.Index(fields=['name'], name='finance_tra_name_89b957_idx'),
                    models.Index(fields=['category_type'], name='finance_tra_categor_734f97_idx'),
                    models.Index(fields=['is_active'], name='finance_tra_is_acti_9e59f2_idx'),
                ],
            },
        ),
        migrations.CreateModel(
            name='CashTransaction',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('search_text', models.TextField(blank=True, default='')),
                ('transaction_type', models.CharField(choices=[('INCOME', 'Thu'), ('EXPENSE', 'Chi'), ('TRANSFER', 'Chuyển')], default='EXPENSE', max_length=20, verbose_name='Loại giao dịch')),
                ('source_type', models.CharField(choices=[('CASH', 'Tiền mặt / Quỹ'), ('BANK', 'Ngân hàng')], default='CASH', max_length=20, verbose_name='Nguồn tiền')),
                ('transaction_date', models.DateField(verbose_name='Ngày giao dịch')),
                ('amount', models.DecimalField(decimal_places=2, max_digits=15, verbose_name='Số tiền')),
                ('object_name', models.CharField(blank=True, default='', max_length=255, verbose_name='Đối tượng')),
                ('reason', models.CharField(blank=True, default='', max_length=255, verbose_name='Lý do')),
                ('note', models.TextField(blank=True, default='', verbose_name='Ghi chú')),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('category', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='transactions', to='finance.transactioncategory', verbose_name='Danh mục thu chi')),
                ('created_by', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='finance_cash_transactions_created', to=settings.AUTH_USER_MODEL)),
                ('source_bank_account', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='bank_transactions', to='finance.bankaccount', verbose_name='Tài khoản nguồn (ngân hàng)')),
                ('source_cash_account', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='outgoing_transactions', to='finance.cashaccount', verbose_name='Tài khoản nguồn (quỹ)')),
                ('target_cash_account', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='incoming_transfer_transactions', to='finance.cashaccount', verbose_name='Tài khoản đích (khi chuyển)')),
            ],
            options={
                'db_table': 'finance_cash_transactions',
                'ordering': ['-transaction_date', '-id'],
                'indexes': [
                    models.Index(fields=['transaction_date'], name='finance_cas_transac_24ee0e_idx'),
                    models.Index(fields=['transaction_type'], name='finance_cas_transac_9b7a95_idx'),
                    models.Index(fields=['source_type'], name='finance_cas_source__4f93a8_idx'),
                ],
            },
        ),
    ]

