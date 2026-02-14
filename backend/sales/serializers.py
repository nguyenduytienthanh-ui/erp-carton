"""
Serializers chứng từ: nested lines, create/update trong transaction, validate.
"""
from rest_framework import serializers
from sales.models import SalesOrder, SalesOrderLine, SalesOrderStatus
from sales.document_policy import calc_line_totals, round_money


class SalesOrderLineSerializer(serializers.ModelSerializer):
    class Meta:
        model = SalesOrderLine
        fields = [
            'id', 'line_number', 'product', 'uom', 'qty', 'unit_price',
            'discount_pct', 'tax_pct', 'line_subtotal', 'discount_amount',
            'tax_amount', 'line_total', 'note',
        ]
        read_only_fields = [
            'line_subtotal', 'discount_amount', 'tax_amount', 'line_total',
        ]

    def validate_qty(self, value):
        if value is not None and value <= 0:
            raise serializers.ValidationError('Số lượng phải > 0.')
        return value

    def validate_unit_price(self, value):
        if value is not None and value < 0:
            raise serializers.ValidationError('Đơn giá không được âm.')
        return value


class SalesOrderSerializer(serializers.ModelSerializer):
    lines = SalesOrderLineSerializer(many=True, required=False)
    customer_name = serializers.SerializerMethodField()

    class Meta:
        model = SalesOrder
        fields = [
            'id', 'code', 'doc_type', 'order_date', 'status', 'reference',
            'customer', 'customer_name', 'currency', 'exchange_rate',
            'subtotal', 'discount_total', 'tax_total', 'total', 'notes',
            'submitted_by', 'submitted_at', 'approved_by', 'approved_at',
            'rejected_by', 'rejected_at', 'reject_reason',
            'posted_by', 'posted_at', 'post_number',
            'voided_by', 'voided_at', 'void_reason',
            'posted_snapshot', 'version',
            'created_by', 'created_at', 'updated_by', 'updated_at',
            'owner', 'team', 'reversal_of', 'lines',
        ]
        read_only_fields = [
            'code', 'subtotal', 'discount_total', 'tax_total', 'total',
            'submitted_by', 'submitted_at', 'approved_by', 'approved_at',
            'rejected_by', 'rejected_at', 'reject_reason',
            'posted_by', 'posted_at', 'post_number',
            'voided_by', 'voided_at', 'void_reason',
            'posted_snapshot', 'version',
            'created_by', 'created_at', 'updated_by', 'updated_at',
        ]

    def get_customer_name(self, obj):
        if obj.customer_id and hasattr(obj, 'customer') and obj.customer:
            return obj.customer.name
        return None

    def validate_lines(self, value):
        if not value:
            return value
        line_numbers = [l.get('line_number') for l in value if l.get('line_number')]
        if len(line_numbers) != len(set(line_numbers)):
            raise serializers.ValidationError('line_number trùng.')
        return value

    def create(self, validated_data):
        from django.db import transaction
        lines_data = validated_data.pop('lines', [])
        with transaction.atomic():
            order = SalesOrder.objects.create(**validated_data)
            for i, line_data in enumerate(lines_data, start=1):
                line_data['line_number'] = line_data.get('line_number') or i
                line_data['sales_order'] = order
                SalesOrderLine.objects.create(**line_data)
            order.recalc_totals()
        return order

    def validate(self, data):
        if self.instance and getattr(self.instance, 'status', None) != SalesOrderStatus.DRAFT:
            raise serializers.ValidationError({'status': 'Chỉ được sửa đơn ở trạng thái Nháp.'})
        return data

    def update(self, instance, validated_data):
        from django.db import transaction
        if instance.status != SalesOrderStatus.DRAFT:
            raise serializers.ValidationError({'status': 'Chỉ được sửa đơn ở trạng thái Nháp.'})
        lines_data = validated_data.pop('lines', None)
        with transaction.atomic():
            for k, v in validated_data.items():
                setattr(instance, k, v)
            instance.version += 1
            instance.save()
            if lines_data is not None:
                instance.lines.all().delete()
                for i, line_data in enumerate(lines_data, start=1):
                    line_data['line_number'] = line_data.get('line_number') or i
                    line_data['sales_order'] = instance
                    SalesOrderLine.objects.create(**line_data)
                instance.recalc_totals()
        return instance
