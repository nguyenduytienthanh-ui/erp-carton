from decimal import Decimal

from django.db import transaction
from django.utils import timezone
from rest_framework import serializers

from purchasing.models import (
    MaterialPurchasePrice,
    PurchaseOrder,
    PurchaseOrderLine,
    PurchaseOrderStatus,
    PurchaseReceipt,
    PurchaseReceiptLine,
    PurchaseRequest,
    PurchaseRequestLine,
    PurchaseRequestStatus,
    PurchaseReturn,
    PurchaseReturnLine,
    Supplier,
)
from purchasing.services import (
    build_purchase_order_line_product_snapshot,
    build_supplier_snapshot,
)


class SupplierSerializer(serializers.ModelSerializer):
    class Meta:
        model = Supplier
        fields = [
            'id',
            'code',
            'name',
            'company_name',
            'tax_code',
            'phone',
            'email',
            'address',
            'contact_person',
            'contact_phone',
            'payment_terms_days',
            'is_preferred',
            'rating',
            'note',
            'is_active',
            'created_at',
            'updated_at',
        ]
        read_only_fields = ['created_at', 'updated_at']

    def validate_code(self, value):
        normalized = str(value or '').strip().upper()
        if not normalized:
            raise serializers.ValidationError('Vui lòng nhập mã nhà cung cấp.')
        queryset = Supplier.objects.filter(code__iexact=normalized)
        if self.instance:
            queryset = queryset.exclude(pk=self.instance.pk)
        if queryset.exists():
            raise serializers.ValidationError('Mã NCC đã tồn tại.')
        return normalized

    def validate_name(self, value):
        normalized = str(value or '').strip()
        if not normalized:
            raise serializers.ValidationError('Vui lòng nhập tên nhà cung cấp.')
        return normalized

    def validate_company_name(self, value):
        return str(value or '').strip()

    def validate_tax_code(self, value):
        normalized = str(value or '').strip()
        if not normalized:
            return ''
        queryset = Supplier.objects.filter(tax_code__iexact=normalized)
        if self.instance:
            queryset = queryset.exclude(pk=self.instance.pk)
        if queryset.exists():
            raise serializers.ValidationError('Mã số thuế đã tồn tại trên nhà cung cấp khác.')
        return normalized

    def validate_email(self, value):
        return str(value or '').strip().lower()

    def validate_phone(self, value):
        return str(value or '').strip()

    def validate_contact_phone(self, value):
        return str(value or '').strip()

    def validate_address(self, value):
        return str(value or '').strip()

    def validate_contact_person(self, value):
        return str(value or '').strip()

    def validate_note(self, value):
        return str(value or '').strip()

    def validate_payment_terms_days(self, value):
        if value is None:
            return 30
        if value < 0:
            raise serializers.ValidationError('Hạn thanh toán không được âm.')
        return value

    def validate_rating(self, value):
        if value is None:
            return 3
        if value < 1 or value > 5:
            raise serializers.ValidationError('Đánh giá phải nằm trong khoảng 1-5.')
        return value


class PurchaseOrderLineSerializer(serializers.ModelSerializer):
    product_code = serializers.SerializerMethodField()
    product_name = serializers.SerializerMethodField()
    remaining_qty = serializers.DecimalField(max_digits=18, decimal_places=4, read_only=True)
    product_snapshot = serializers.JSONField(required=False)

    class Meta:
        model = PurchaseOrderLine
        fields = [
            'id',
            'line_number',
            'product',
            'product_code',
            'product_name',
            'internal_product_code',
            'product_snapshot',
            'uom',
            'qty',
            'received_qty',
            'remaining_qty',
            'unit_price',
            'discount_pct',
            'tax_pct',
            'line_subtotal',
            'discount_amount',
            'tax_amount',
            'line_total',
            'note',
        ]
        read_only_fields = [
            'internal_product_code',
            'line_subtotal',
            'discount_amount',
            'tax_amount',
            'line_total',
            'received_qty',
            'remaining_qty',
        ]

    def validate_qty(self, value):
        if value is None or value <= 0:
            raise serializers.ValidationError('Số lượng phải > 0.')
        return value

    def validate_unit_price(self, value):
        if value is not None and value < 0:
            raise serializers.ValidationError('Đơn giá không được âm.')
        return value

    def get_product_code(self, obj):
        return obj.internal_product_code or (obj.product_snapshot or {}).get('code') or getattr(obj.product, 'code', None)

    def get_product_name(self, obj):
        return (obj.product_snapshot or {}).get('name') or getattr(obj.product, 'name', None)


class PurchaseOrderSerializer(serializers.ModelSerializer):
    lines = PurchaseOrderLineSerializer(many=True, required=False)
    supplier_name = serializers.SerializerMethodField()
    warehouse_name = serializers.CharField(source='warehouse.name', read_only=True)
    location_name = serializers.CharField(source='location.name', read_only=True)

    class Meta:
        model = PurchaseOrder
        fields = [
            'id',
            'code',
            'doc_type',
            'order_date',
            'expected_receipt_date',
            'status',
            'reference',
            'supplier',
            'supplier_name',
            'supplier_snapshot',
            'warehouse',
            'warehouse_name',
            'location',
            'location_name',
            'currency',
            'exchange_rate',
            'payment_terms_days',
            'subtotal',
            'discount_total',
            'tax_total',
            'total',
            'notes',
            'submitted_by',
            'submitted_at',
            'approved_by',
            'approved_at',
            'rejected_by',
            'rejected_at',
            'reject_reason',
            'cancelled_by',
            'cancelled_at',
            'cancel_reason',
            'version',
            'created_by',
            'created_at',
            'updated_by',
            'updated_at',
            'owner',
            'team',
            'lines',
        ]
        read_only_fields = [
            'code',
            'doc_type',
            'status',
            'supplier_snapshot',
            'subtotal',
            'discount_total',
            'tax_total',
            'total',
            'submitted_by',
            'submitted_at',
            'approved_by',
            'approved_at',
            'rejected_by',
            'rejected_at',
            'reject_reason',
            'cancelled_by',
            'cancelled_at',
            'cancel_reason',
            'version',
            'created_by',
            'created_at',
            'updated_by',
            'updated_at',
            'owner',
            'team',
        ]

    def get_supplier_name(self, obj):
        snapshot = obj.supplier_snapshot or {}
        return snapshot.get('name') or snapshot.get('company_name') or getattr(getattr(obj, 'supplier', None), 'name', None)

    def validate_lines(self, value):
        if not value:
            raise serializers.ValidationError('Đơn mua phải có ít nhất 1 dòng hàng.')
        line_numbers = [line.get('line_number') for line in value if line.get('line_number')]
        if len(line_numbers) != len(set(line_numbers)):
            raise serializers.ValidationError('line_number bị trùng.')
        return value

    def validate(self, attrs):
        attrs = super().validate(attrs)
        warehouse = attrs.get('warehouse', getattr(self.instance, 'warehouse', None))
        location = attrs.get('location', getattr(self.instance, 'location', None))
        if location and warehouse and location.warehouse_id != warehouse.id:
            raise serializers.ValidationError({'location': 'Vị trí nhập mặc định phải thuộc kho đã chọn.'})

        if self.instance:
            incoming_version = self.initial_data.get('version')
            if incoming_version is None:
                raise serializers.ValidationError({'version': 'Thiếu version hiện tại. Vui lòng tải lại đơn mua trước khi lưu.'})
            try:
                incoming_version = int(incoming_version)
            except (TypeError, ValueError):
                raise serializers.ValidationError({'version': 'Version không hợp lệ.'})
            if incoming_version != int(getattr(self.instance, 'version', 0) or 0):
                raise serializers.ValidationError({'version': 'Đơn mua đã được cập nhật bởi người khác. Vui lòng tải lại rồi thử lại.'})
            if getattr(self.instance, 'status', None) not in {PurchaseOrderStatus.DRAFT, PurchaseOrderStatus.REJECTED}:
                raise serializers.ValidationError({'status': 'Chỉ được sửa đơn mua ở trạng thái Nháp hoặc Từ chối.'})
        return attrs

    def create(self, validated_data):
        lines_data = validated_data.pop('lines', [])
        validated_data['code'] = validated_data.get('code') or self.initial_data.get('code') or ''
        if not validated_data['code']:
            raise serializers.ValidationError({'code': 'Thiếu mã đơn mua.'})
        supplier = validated_data.get('supplier')
        validated_data['supplier_snapshot'] = build_supplier_snapshot(supplier)
        if validated_data.get('payment_terms_days') in (None, '') and supplier:
            validated_data['payment_terms_days'] = supplier.payment_terms_days
        with transaction.atomic():
            order = PurchaseOrder.objects.create(**validated_data)
            self._replace_lines(order, lines_data)
            order.recalc_totals()
        return order

    def update(self, instance, validated_data):
        if instance.status not in {PurchaseOrderStatus.DRAFT, PurchaseOrderStatus.REJECTED}:
            raise serializers.ValidationError({'status': 'Chỉ được sửa đơn mua ở trạng thái Nháp hoặc Từ chối.'})
        lines_data = validated_data.pop('lines', None)
        with transaction.atomic():
            for key, value in validated_data.items():
                setattr(instance, key, value)
            if 'supplier' in validated_data and 'payment_terms_days' not in validated_data:
                instance.payment_terms_days = getattr(instance.supplier, 'payment_terms_days', instance.payment_terms_days)
            instance.version += 1
            instance.supplier_snapshot = build_supplier_snapshot(instance.supplier)
            instance.save()
            if lines_data is not None:
                instance.lines.all().delete()
                self._replace_lines(instance, lines_data)
            instance.recalc_totals()
        return instance

    def _replace_lines(self, order, lines_data):
        for index, line_data in enumerate(lines_data, start=1):
            product_snapshot_input = line_data.pop('product_snapshot', None) or {}
            line_data['purchase_order'] = order
            line_data['line_number'] = line_data.get('line_number') or index
            product = line_data.get('product')
            if product:
                snapshot = build_purchase_order_line_product_snapshot(product)
                snapshot.update({
                    key: value
                    for key, value in product_snapshot_input.items()
                    if value not in (None, '')
                })
                line_data['internal_product_code'] = getattr(product, 'code', '') or ''
                line_data['uom'] = line_data.get('uom') or getattr(getattr(product, 'unit', None), 'code', '') or ''
                line_data['product_snapshot'] = snapshot
            PurchaseOrderLine.objects.create(**line_data)


class PurchaseReceiptLineSerializer(serializers.ModelSerializer):
    purchase_order_line_number = serializers.IntegerField(source='purchase_order_line.line_number', read_only=True)
    product_code = serializers.SerializerMethodField()
    product_name = serializers.SerializerMethodField()
    inventory_transaction_code = serializers.CharField(source='inventory_transaction.code', read_only=True)

    class Meta:
        model = PurchaseReceiptLine
        fields = [
            'id',
            'line_number',
            'purchase_order_line',
            'purchase_order_line_number',
            'product',
            'product_code',
            'product_name',
            'product_snapshot',
            'quantity',
            'unit_cost',
            'line_total',
            'note',
            'inventory_transaction',
            'inventory_transaction_code',
        ]

    def get_product_code(self, obj):
        return (obj.product_snapshot or {}).get('code') or getattr(getattr(obj, 'product', None), 'code', None)

    def get_product_name(self, obj):
        return (obj.product_snapshot or {}).get('name') or getattr(getattr(obj, 'product', None), 'name', None)


class PurchaseReceiptSerializer(serializers.ModelSerializer):
    lines = PurchaseReceiptLineSerializer(many=True, read_only=True)
    purchase_order_code = serializers.CharField(source='purchase_order.code', read_only=True)
    supplier_name = serializers.SerializerMethodField()
    warehouse_name = serializers.CharField(source='warehouse.name', read_only=True)
    location_name = serializers.CharField(source='location.name', read_only=True)

    class Meta:
        model = PurchaseReceipt
        fields = [
            'id',
            'code',
            'purchase_order',
            'purchase_order_code',
            'receipt_date',
            'status',
            'reference',
            'supplier_snapshot',
            'supplier_name',
            'warehouse',
            'warehouse_name',
            'location',
            'location_name',
            'total_qty',
            'total_amount',
            'note',
            'posted_at',
            'posted_by',
            'cancelled_at',
            'cancelled_by',
            'cancel_reason',
            'created_at',
            'updated_at',
            'lines',
        ]
        read_only_fields = fields

    def get_supplier_name(self, obj):
        snapshot = obj.supplier_snapshot or {}
        return snapshot.get('name') or snapshot.get('company_name')


class MaterialPurchasePriceSerializer(serializers.ModelSerializer):
    product_code = serializers.CharField(source='product.code', read_only=True)
    product_name = serializers.CharField(source='product.name', read_only=True)
    supplier_code = serializers.SerializerMethodField()
    supplier_name = serializers.SerializerMethodField()

    class Meta:
        model = MaterialPurchasePrice
        fields = [
            'id',
            'product',
            'product_code',
            'product_name',
            'supplier',
            'supplier_code',
            'supplier_name',
            'unit_price',
            'currency',
            'uom',
            'effective_from',
            'effective_to',
            'min_quantity',
            'note',
            'created_at',
            'updated_at',
        ]
        read_only_fields = ['created_at', 'updated_at']

    def get_supplier_code(self, obj):
        return getattr(obj.supplier, 'code', '') if obj.supplier_id else 'Chung'

    def get_supplier_name(self, obj):
        if obj.supplier_id:
            return getattr(obj.supplier, 'name', '') or getattr(obj.supplier, 'company_name', '')
        return 'Giá chuẩn'

    def validate_unit_price(self, value):
        if value is not None and value < 0:
            raise serializers.ValidationError('Đơn giá không được âm.')
        return value

    def validate(self, attrs):
        attrs = super().validate(attrs)
        eff_from = attrs.get('effective_from')
        eff_to = attrs.get('effective_to')
        if eff_from and eff_to and eff_to < eff_from:
            raise serializers.ValidationError({'effective_to': 'Ngày hết hạn phải >= ngày hiệu lực.'})
        return attrs


class PurchaseRequestLineSerializer(serializers.ModelSerializer):
    product_code = serializers.CharField(source='product.code', read_only=True)
    product_name = serializers.CharField(source='product.name', read_only=True)

    class Meta:
        model = PurchaseRequestLine
        fields = [
            'id',
            'line_number',
            'product',
            'product_code',
            'product_name',
            'sales_material_plan_item_id',
            'source_snapshot',
            'qty',
            'note',
        ]

    def validate_qty(self, value):
        if value is not None and value <= 0:
            raise serializers.ValidationError('Số lượng phải > 0.')
        return value


class PurchaseRequestSerializer(serializers.ModelSerializer):
    lines = PurchaseRequestLineSerializer(many=True, required=False)
    requested_by_name = serializers.SerializerMethodField()

    class Meta:
        model = PurchaseRequest
        fields = [
            'id', 'code', 'request_date', 'status', 'reference', 'notes',
            'requested_by', 'requested_by_name', 'approved_by', 'approved_at',
            'rejected_by', 'rejected_at', 'reject_reason',
            'cancelled_by', 'cancelled_at', 'cancel_reason',
            'created_by', 'created_at', 'updated_by', 'updated_at', 'lines',
        ]
        read_only_fields = [
            'code',
            'cancelled_by',
            'cancelled_at',
            'cancel_reason',
            'created_by',
            'created_at',
            'updated_by',
            'updated_at',
        ]

    def get_requested_by_name(self, obj):
        user = getattr(obj, 'requested_by', None)
        if not user:
            return None
        return getattr(user, 'full_name', None) or getattr(user, 'username', None)

    def create(self, validated_data, **kwargs):
        from purchasing.services import get_next_pr_code
        lines_data = validated_data.pop('lines', [])
        request_date = validated_data.get('request_date')
        if not request_date:
            raise serializers.ValidationError({'request_date': 'Thiếu ngày yêu cầu.'})
        validated_data['code'] = get_next_pr_code(request_date)
        validated_data.update({k: v for k, v in kwargs.items() if k in ('created_by', 'updated_by')})
        with transaction.atomic():
            pr = PurchaseRequest.objects.create(**validated_data)
            for i, line_data in enumerate(lines_data, start=1):
                line_data['line_number'] = line_data.get('line_number') or i
                line_data['purchase_request'] = pr
                PurchaseRequestLine.objects.create(**line_data)
        return pr

    def update(self, instance, validated_data, **kwargs):
        lines_data = validated_data.pop('lines', None)
        with transaction.atomic():
            for k, v in validated_data.items():
                setattr(instance, k, v)
            instance.save()
            if lines_data is not None:
                instance.lines.all().delete()
                for i, line_data in enumerate(lines_data, start=1):
                    line_data['line_number'] = line_data.get('line_number') or i
                    line_data['purchase_request'] = instance
                    PurchaseRequestLine.objects.create(**line_data)
        return instance

class PurchaseReturnLineSerializer(serializers.ModelSerializer):
    product_code = serializers.SerializerMethodField()
    product_name = serializers.SerializerMethodField()

    class Meta:
        model = PurchaseReturnLine
        fields = ['id', 'line_number', 'product', 'product_code', 'product_name', 'qty', 'unit_price', 'tax_pct', 'note']

    def get_product_code(self, obj):
        return getattr(obj.product, 'code', None) if obj.product else None

    def get_product_name(self, obj):
        return getattr(obj.product, 'name', None) if obj.product else None


class PurchaseReturnSerializer(serializers.ModelSerializer):
    lines = PurchaseReturnLineSerializer(many=True, required=False)
    supplier_name = serializers.SerializerMethodField()
    purchase_order_code = serializers.SerializerMethodField()

    class Meta:
        model = PurchaseReturn
        fields = [
            'id', 'code', 'return_date', 'status', 'reference',
            'purchase_order', 'purchase_order_code', 'supplier', 'supplier_name',
            'subtotal', 'tax_total', 'total',
            'return_reason', 'return_notes',
            'submitted_by', 'submitted_at', 'approved_by', 'approved_at',
            'posted_by', 'posted_at', 'cancelled_by', 'cancelled_at', 'cancel_reason',
            'created_by', 'created_at', 'updated_by', 'updated_at',
            'lines',
        ]
        read_only_fields = ['code', 'created_by', 'created_at', 'updated_by', 'updated_at']

    def get_supplier_name(self, obj):
        return getattr(obj.supplier, 'name', None) if obj.supplier else None

    def get_purchase_order_code(self, obj):
        return getattr(obj.purchase_order, 'code', None) if obj.purchase_order else None

    def create(self, validated_data):
        from datetime import date
        lines_data = validated_data.pop('lines', [])
        return_date = validated_data.get('return_date')
        if not return_date:
            return_date = date.today()
        validated_data['code'] = f"RET-{return_date.strftime('%Y%m%d')}-{timezone.now().strftime('%H%M%S%f')}"
        with transaction.atomic():
            ret = PurchaseReturn.objects.create(**validated_data)
            for i, line_data in enumerate(lines_data, start=1):
                line_data['line_number'] = line_data.get('line_number') or i
                line_data['purchase_return'] = ret
                PurchaseReturnLine.objects.create(**line_data)
        return ret

    def update(self, instance, validated_data):
        lines_data = validated_data.pop('lines', None)
        with transaction.atomic():
            for k, v in validated_data.items():
                setattr(instance, k, v)
            instance.save()
            if lines_data is not None:
                instance.lines.all().delete()
                for i, line_data in enumerate(lines_data, start=1):
                    line_data['line_number'] = line_data.get('line_number') or i
                    line_data['purchase_return'] = instance
                    PurchaseReturnLine.objects.create(**line_data)
        return instance
