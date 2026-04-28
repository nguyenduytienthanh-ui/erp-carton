# Generated for Product Operation master rollout (1A).

import django.core.validators
import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('products', '0013_material_template_models'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name='Operation',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('code', models.CharField(max_length=30, unique=True)),
                ('name', models.CharField(max_length=100)),
                ('sequence', models.PositiveIntegerField(default=100)),
                ('default_unit', models.CharField(default='pcs/hour', max_length=30)),
                ('description', models.TextField(blank=True)),
                ('is_active', models.BooleanField(default=True)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
            ],
            options={
                'db_table': 'operations',
                'ordering': ['sequence', 'code'],
            },
        ),
        migrations.CreateModel(
            name='ProductOperation',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('operation_code', models.CharField(blank=True, max_length=30)),
                ('operation_name', models.CharField(blank=True, max_length=100)),
                ('sequence', models.PositiveIntegerField(default=0)),
                ('standard_rate_per_hour', models.PositiveIntegerField(validators=[django.core.validators.MinValueValidator(1)])),
                ('note', models.TextField(blank=True)),
                ('is_active', models.BooleanField(default=True)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('created_by', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='created_product_operations', to=settings.AUTH_USER_MODEL)),
                ('operation', models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name='product_operations', to='products.operation')),
                ('product', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='operations', to='products.product')),
                ('updated_by', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='updated_product_operations', to=settings.AUTH_USER_MODEL)),
            ],
            options={
                'db_table': 'product_operations',
                'ordering': ['product_id', 'sequence', 'operation_code'],
            },
        ),
        migrations.AddIndex(
            model_name='operation',
            index=models.Index(fields=['code'], name='operations_code_7a6bea_idx'),
        ),
        migrations.AddIndex(
            model_name='operation',
            index=models.Index(fields=['sequence'], name='operations_sequenc_e0d676_idx'),
        ),
        migrations.AddIndex(
            model_name='operation',
            index=models.Index(fields=['is_active'], name='operations_is_acti_33d382_idx'),
        ),
        migrations.AddIndex(
            model_name='productoperation',
            index=models.Index(fields=['product', 'sequence'], name='product_ope_product_e2d744_idx'),
        ),
        migrations.AddIndex(
            model_name='productoperation',
            index=models.Index(fields=['operation'], name='product_ope_operati_410bec_idx'),
        ),
        migrations.AddIndex(
            model_name='productoperation',
            index=models.Index(fields=['operation_code'], name='product_ope_operati_a21172_idx'),
        ),
        migrations.AddIndex(
            model_name='productoperation',
            index=models.Index(fields=['is_active'], name='product_ope_is_acti_a59dd9_idx'),
        ),
        migrations.AddConstraint(
            model_name='productoperation',
            constraint=models.UniqueConstraint(fields=('product', 'operation'), name='product_operation_product_operation_uniq'),
        ),
        migrations.AddConstraint(
            model_name='productoperation',
            constraint=models.CheckConstraint(condition=models.Q(('standard_rate_per_hour__gt', 0)), name='product_operation_rate_gt_0'),
        ),
    ]
