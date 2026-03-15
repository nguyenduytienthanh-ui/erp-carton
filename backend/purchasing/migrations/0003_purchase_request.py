from decimal import Decimal

from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('products', '0012_bundlepricechange'),
        ('purchasing', '0002_add_material_purchase_price'),
    ]

    operations = [
        migrations.CreateModel(
            name='PurchaseRequestSequence',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('period', models.CharField(db_index=True, max_length=6, unique=True)),
                ('current_number', models.IntegerField(default=0)),
                ('padding', models.IntegerField(default=5)),
            ],
            options={
                'verbose_name': 'PR Sequence',
                'verbose_name_plural': 'PR Sequences',
                'db_table': 'purchasing_request_sequences',
            },
        ),
        migrations.CreateModel(
            name='PurchaseRequest',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('code', models.CharField(db_index=True, max_length=50, unique=True)),
                ('request_date', models.DateField(db_index=True)),
                ('status', models.CharField(
                    choices=[
                        ('DRAFT', 'Nháp'),
                        ('SUBMITTED', 'Đã gửi'),
                        ('APPROVED', 'Đã duyệt'),
                        ('REJECTED', 'Từ chối'),
                    ],
                    db_index=True,
                    default='DRAFT',
                    max_length=20,
                )),
                ('reference', models.CharField(blank=True, max_length=200)),
                ('notes', models.TextField(blank=True)),
                ('approved_at', models.DateTimeField(blank=True, null=True)),
                ('reject_reason', models.TextField(blank=True)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('approved_by', models.ForeignKey(
                    blank=True,
                    null=True,
                    on_delete=models.deletion.SET_NULL,
                    related_name='purchase_requests_approved',
                    to=settings.AUTH_USER_MODEL,
                )),
                ('created_by', models.ForeignKey(
                    blank=True,
                    null=True,
                    on_delete=models.deletion.SET_NULL,
                    related_name='purchase_requests_created',
                    to=settings.AUTH_USER_MODEL,
                )),
                ('rejected_by', models.ForeignKey(
                    blank=True,
                    null=True,
                    on_delete=models.deletion.SET_NULL,
                    related_name='purchase_requests_rejected',
                    to=settings.AUTH_USER_MODEL,
                )),
                ('requested_by', models.ForeignKey(
                    blank=True,
                    null=True,
                    on_delete=models.deletion.SET_NULL,
                    related_name='purchase_requests_requested',
                    to=settings.AUTH_USER_MODEL,
                )),
                ('updated_by', models.ForeignKey(
                    blank=True,
                    null=True,
                    on_delete=models.deletion.SET_NULL,
                    related_name='purchase_requests_updated',
                    to=settings.AUTH_USER_MODEL,
                )),
            ],
            options={
                'verbose_name': 'Purchase Request',
                'verbose_name_plural': 'Purchase Requests',
                'db_table': 'purchasing_requests',
                'ordering': ['-request_date', '-id'],
            },
        ),
        migrations.CreateModel(
            name='PurchaseRequestLine',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('line_number', models.PositiveIntegerField()),
                ('qty', models.DecimalField(decimal_places=4, default=Decimal('1'), max_digits=18)),
                ('note', models.CharField(blank=True, max_length=255)),
                ('product', models.ForeignKey(
                    on_delete=models.deletion.PROTECT,
                    related_name='purchase_request_lines',
                    to='products.product',
                )),
                ('purchase_request', models.ForeignKey(
                    on_delete=models.deletion.CASCADE,
                    related_name='lines',
                    to='purchasing.purchaserequest',
                )),
            ],
            options={
                'verbose_name': 'Purchase Request Line',
                'verbose_name_plural': 'Purchase Request Lines',
                'db_table': 'purchasing_request_lines',
                'ordering': ['purchase_request_id', 'line_number'],
                'unique_together': {('purchase_request', 'line_number')},
            },
        ),
    ]
