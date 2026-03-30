from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('finance', '0008_budgetplan'),
    ]

    operations = [
        migrations.AddField(
            model_name='payabledocument',
            name='document_type',
            field=models.CharField(db_index=True, default='PAYABLE', max_length=50, verbose_name='Loại chứng từ'),
        ),
        migrations.AddField(
            model_name='receivabledocument',
            name='document_type',
            field=models.CharField(db_index=True, default='RECEIVABLE', max_length=50, verbose_name='Loại chứng từ'),
        ),
    ]
