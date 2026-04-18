from decimal import Decimal

from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('sales', '0005_salesorderdeliveryplan_shipped_qty'),
    ]

    operations = [
        migrations.CreateModel(
            name='Quote',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('code', models.CharField(db_index=True, max_length=50, unique=True)),
                ('quote_date', models.DateField(db_index=True)),
                ('valid_until', models.DateField(blank=True, db_index=True, null=True)),
                ('status', models.CharField(
                    choices=[
                        ('DRAFT', 'Nháp'),
                        ('SENT', 'Đã gửi'),
                        ('ACCEPTED', 'Khách chấp nhận'),
                        ('REJECTED', 'Từ chối'),
                        ('EXPIRED', 'Hết hạn'),
                    ],
                    db_index=True,
                    default='DRAFT',
                    max_length=20,
                )),
                ('reference', models.CharField(blank=True, max_length=200)),
                ('currency', models.CharField(default='VND', max_length=3)),
                ('subtotal', models.DecimalField(decimal_places=2, default=Decimal('0'), max_digits=18)),
                ('discount_total', models.DecimalField(decimal_places=2, default=Decimal('0'), max_digits=18)),
                ('tax_total', models.DecimalField(decimal_places=2, default=Decimal('0'), max_digits=18)),
                ('total', models.DecimalField(decimal_places=2, default=Decimal('0'), max_digits=18)),
                ('notes', models.TextField(blank=True)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('created_by', models.ForeignKey(
                    blank=True,
                    null=True,
                    on_delete=models.deletion.SET_NULL,
                    related_name='quotes_created',
                    to=settings.AUTH_USER_MODEL,
                )),
                ('customer', models.ForeignKey(
                    blank=True,
                    null=True,
                    on_delete=models.deletion.PROTECT,
                    related_name='quotes',
                    to='core.customer',
                )),
                ('updated_by', models.ForeignKey(
                    blank=True,
                    null=True,
                    on_delete=models.deletion.SET_NULL,
                    related_name='quotes_updated',
                    to=settings.AUTH_USER_MODEL,
                )),
            ],
            options={
                'verbose_name': 'Quote',
                'verbose_name_plural': 'Quotes',
                'db_table': 'sales_quotes',
                'ordering': ['-quote_date', '-id'],
            },
        ),
        migrations.CreateModel(
            name='QuoteLine',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('line_number', models.PositiveIntegerField()),
                ('qty', models.DecimalField(decimal_places=4, default=Decimal('1'), max_digits=18)),
                ('unit_price', models.DecimalField(decimal_places=2, default=Decimal('0'), max_digits=18)),
                ('discount_pct', models.DecimalField(decimal_places=2, default=Decimal('0'), max_digits=5)),
                ('tax_pct', models.DecimalField(decimal_places=2, default=Decimal('0'), max_digits=5)),
                ('line_subtotal', models.DecimalField(decimal_places=2, default=Decimal('0'), max_digits=18)),
                ('discount_amount', models.DecimalField(decimal_places=2, default=Decimal('0'), max_digits=18)),
                ('tax_amount', models.DecimalField(decimal_places=2, default=Decimal('0'), max_digits=18)),
                ('line_total', models.DecimalField(decimal_places=2, default=Decimal('0'), max_digits=18)),
                ('note', models.CharField(blank=True, max_length=255)),
                ('product', models.ForeignKey(
                    on_delete=models.deletion.PROTECT,
                    related_name='quote_lines',
                    to='products.product',
                )),
                ('quote', models.ForeignKey(
                    on_delete=models.deletion.CASCADE,
                    related_name='lines',
                    to='sales.quote',
                )),
            ],
            options={
                'verbose_name': 'Quote Line',
                'verbose_name_plural': 'Quote Lines',
                'db_table': 'sales_quote_lines',
                'ordering': ['quote_id', 'line_number'],
                'unique_together': {('quote', 'line_number')},
            },
        ),
        migrations.AddIndex(
            model_name='quote',
            index=models.Index(fields=['code'], name='sales_quote_code_idx'),
        ),
        migrations.AddIndex(
            model_name='quote',
            index=models.Index(fields=['quote_date'], name='sales_quote_quote_d_idx'),
        ),
        migrations.AddIndex(
            model_name='quote',
            index=models.Index(fields=['valid_until'], name='sales_quote_valid_u_idx'),
        ),
        migrations.AddIndex(
            model_name='quote',
            index=models.Index(fields=['status'], name='sales_quote_status_idx'),
        ),
    ]
