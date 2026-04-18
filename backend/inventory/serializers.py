from decimal import Decimal

from django.db import transaction
from django.db.models import Sum
from django.utils import timezone
from rest_framework import serializers

from collections import defaultdict

from inventory.models import (
    InventoryReservation,
    InventoryReservationStatus,
    InventoryTransaction,
    InventoryTransactionStatus,
    InventoryTransactionType,
    OutboundShipmentPackage,
    OutboundShipmentPackageStatus,
    OutboundShipment,
    StockAlert,
    Stocktake,
    StocktakeLine,
    StocktakeStatus,
    Warehouse,
    WarehouseLocation,
    WarehouseLocationType,
)
from inventory.services import (
    build_stock_balance_map,
    get_next_inventory_reservation_code,
    get_next_inventory_transaction_code,
    get_next_stocktake_code,
    get_stock_balance,
)
from sales.services import ensure_sales_order_line_shipment_allowed


def _ensure_active_warehouse(field_name: str, warehouse: Warehouse | None):
    if warehouse and not warehouse.is_active:
        raise serializers.ValidationError({field_name: 'Kho đã ngưng hoạt động, không thể ghi nhận giao dịch mới.'})


def _ensure_active_location(field_name: str, location: WarehouseLocation | None):
    if location and not location.is_active:
        raise serializers.ValidationError({field_name: 'Vị trí đã ngưng hoạt động, không thể ghi nhận giao dịch mới.'})


def _ensure_sales_ready_location(field_name: str, location: WarehouseLocation | None):
    if location and location.location_type == WarehouseLocationType.RETURN:
        raise serializers.ValidationError({field_name: 'Không được reserve/xuất đơn bán từ vị trí hàng trả.'})


class WarehouseSerializer(serializers.ModelSerializer):
    manager_name = serializers.SerializerMethodField()

    class Meta:
        model = Warehouse
        fields = [
            'id',
            'code',
            'name',
            'address',
            'manager',
            'manager_name',
            'note',
            'is_active',
            'sort_order',
            'created_at',
            'updated_at',
        ]
        read_only_fields = ['created_at', 'updated_at', 'manager_name']

    def get_manager_name(self, obj):
        if obj.manager_id and obj.manager:
            return getattr(obj.manager, 'full_name', None) or getattr(obj.manager, 'username', None)
        return None


class WarehouseLocationSerializer(serializers.ModelSerializer):
    warehouse_name = serializers.CharField(source='warehouse.name', read_only=True)
    parent_name = serializers.CharField(source='parent.name', read_only=True)

    class Meta:
        model = WarehouseLocation
        fields = [
            'id',
            'warehouse',
            'warehouse_name',
            'code',
            'name',
            'parent',
            'parent_name',
            'location_type',
            'allow_mixed_products',
            'is_active',
            'sort_order',
            'note',
            'created_at',
            'updated_at',
        ]
        read_only_fields = ['created_at', 'updated_at', 'warehouse_name', 'parent_name']

    def validate(self, attrs):
        attrs = super().validate(attrs)
        warehouse = attrs.get('warehouse', getattr(self.instance, 'warehouse', None))
        parent = attrs.get('parent', getattr(self.instance, 'parent', None))
        if parent and warehouse and parent.warehouse_id != warehouse.id:
            raise serializers.ValidationError({'parent': 'Vị trí cha phải cùng kho.'})
        return attrs


class InventoryTransactionSerializer(serializers.ModelSerializer):
    product_code = serializers.CharField(source='product.code', read_only=True)
    product_name = serializers.CharField(source='product.name', read_only=True)
    warehouse_name = serializers.CharField(source='warehouse.name', read_only=True)
    location_name = serializers.CharField(source='location.name', read_only=True)
    target_warehouse_name = serializers.CharField(source='target_warehouse.name', read_only=True)
    target_location_name = serializers.CharField(source='target_location.name', read_only=True)
    sales_order_code = serializers.CharField(source='sales_order.code', read_only=True)
    reservation_code = serializers.CharField(source='reservation.code', read_only=True)
    shipment_batch_code = serializers.CharField(source='shipment_batch.code', read_only=True)
    amount = serializers.DecimalField(max_digits=18, decimal_places=2, read_only=True)

    class Meta:
        model = InventoryTransaction
        fields = [
            'id',
            'code',
            'transaction_type',
            'status',
            'transaction_date',
            'reference',
            'reason',
            'note',
            'product',
            'product_code',
            'product_name',
            'warehouse',
            'warehouse_name',
            'location',
            'location_name',
            'target_warehouse',
            'target_warehouse_name',
            'target_location',
            'target_location_name',
            'quantity',
            'unit_cost',
            'amount',
            'sales_order',
            'sales_order_code',
            'sales_order_line',
            'reservation',
            'reservation_code',
            'shipment_batch',
            'shipment_batch_code',
            'posted_at',
            'posted_by',
            'cancelled_at',
            'cancelled_by',
            'cancel_reason',
            'created_at',
            'updated_at',
        ]
        read_only_fields = [
            'code',
            'status',
            'amount',
            'posted_at',
            'posted_by',
            'cancelled_at',
            'cancelled_by',
            'cancel_reason',
            'created_at',
            'updated_at',
            'product_code',
            'product_name',
            'warehouse_name',
            'location_name',
            'target_warehouse_name',
            'target_location_name',
            'sales_order_code',
            'reservation_code',
            'shipment_batch_code',
        ]

    def validate(self, attrs):
        attrs = super().validate(attrs)
        tx_type = attrs.get('transaction_type', getattr(self.instance, 'transaction_type', None))
        warehouse = attrs.get('warehouse', getattr(self.instance, 'warehouse', None))
        location = attrs.get('location', getattr(self.instance, 'location', None))
        target_warehouse = attrs.get('target_warehouse', getattr(self.instance, 'target_warehouse', None))
        target_location = attrs.get('target_location', getattr(self.instance, 'target_location', None))
        product = attrs.get('product', getattr(self.instance, 'product', None))
        quantity = attrs.get('quantity', getattr(self.instance, 'quantity', None))
        sales_order_line = attrs.get('sales_order_line', getattr(self.instance, 'sales_order_line', None))
        reservation = attrs.get('reservation', getattr(self.instance, 'reservation', None))

        _ensure_active_warehouse('warehouse', warehouse)
        _ensure_active_location('location', location)
        _ensure_active_warehouse('target_warehouse', target_warehouse)
        _ensure_active_location('target_location', target_location)

        if location and warehouse and location.warehouse_id != warehouse.id:
            raise serializers.ValidationError({'location': 'Vị trí nguồn không thuộc kho nguồn.'})
        if target_location and target_warehouse and target_location.warehouse_id != target_warehouse.id:
            raise serializers.ValidationError({'target_location': 'Vị trí đích không thuộc kho đích.'})

        if tx_type == InventoryTransactionType.TRANSFER:
            if not warehouse or not target_warehouse:
                raise serializers.ValidationError('Chuyển kho bắt buộc có kho nguồn và kho đích.')
            if warehouse.id == target_warehouse.id and (location_id := getattr(location, 'id', None)) == getattr(target_location, 'id', None):
                raise serializers.ValidationError('Kho/vị trí nguồn và đích không được trùng nhau.')
        elif tx_type in {InventoryTransactionType.RECEIPT, InventoryTransactionType.ADJUSTMENT_IN}:
            if not warehouse:
                raise serializers.ValidationError({'warehouse': 'Chứng từ nhập/tăng tồn bắt buộc có kho.'})
            if target_warehouse or target_location:
                raise serializers.ValidationError('Nhập kho/điều chỉnh tăng không dùng kho đích.')
        elif tx_type in {InventoryTransactionType.ISSUE, InventoryTransactionType.ADJUSTMENT_OUT}:
            if not warehouse:
                raise serializers.ValidationError({'warehouse': 'Chứng từ xuất/giảm tồn bắt buộc có kho.'})
            if target_warehouse or target_location:
                raise serializers.ValidationError('Xuất kho/điều chỉnh giảm không dùng kho đích.')

        if sales_order_line:
            _ensure_sales_ready_location('location', location)
            if product and sales_order_line.product_id != product.id:
                raise serializers.ValidationError({'sales_order_line': 'Dòng đơn hàng phải cùng sản phẩm.'})
            sales_order = attrs.get('sales_order', getattr(self.instance, 'sales_order', None))
            if sales_order and sales_order_line.sales_order_id != sales_order.id:
                raise serializers.ValidationError({'sales_order': 'Sales order phải khớp với dòng đơn hàng.'})
            attrs.setdefault('sales_order', sales_order_line.sales_order)
            if tx_type == InventoryTransactionType.ISSUE and quantity:
                try:
                    ensure_sales_order_line_shipment_allowed(
                        sales_order_line,
                        quantity,
                        exclude_transaction_id=getattr(self.instance, 'id', None),
                    )
                except ValueError as exc:
                    raise serializers.ValidationError({'quantity': str(exc)}) from exc
        sales_order = attrs.get('sales_order', getattr(self.instance, 'sales_order', None))
        if sales_order and getattr(sales_order, 'status', None) not in ['APPROVED', 'POSTED']:
            raise serializers.ValidationError({'sales_order': 'Chỉ được reserve cho đơn đã duyệt hoặc đã post.'})

        if reservation:
            _ensure_sales_ready_location('location', location or reservation.location)
            if tx_type != InventoryTransactionType.ISSUE:
                raise serializers.ValidationError({'reservation': 'Reservation chỉ được dùng cho chứng từ xuất kho.'})
            if reservation.status != InventoryReservationStatus.OPEN:
                raise serializers.ValidationError({'reservation': 'Reservation phải ở trạng thái OPEN.'})
            if product and reservation.product_id != product.id:
                raise serializers.ValidationError({'reservation': 'Reservation phải cùng sản phẩm.'})
            if warehouse and reservation.warehouse_id != warehouse.id:
                raise serializers.ValidationError({'reservation': 'Reservation phải cùng kho nguồn.'})
            if reservation.location_id and getattr(location, 'id', None) != reservation.location_id:
                raise serializers.ValidationError({'location': 'Vị trí xuất phải đúng vị trí đã reserve.'})
            if sales_order_line and reservation.sales_order_line_id != sales_order_line.id:
                raise serializers.ValidationError({'reservation': 'Reservation phải khớp với dòng đơn hàng.'})
            sales_order = attrs.get('sales_order', getattr(self.instance, 'sales_order', None))
            if sales_order and reservation.sales_order_id and reservation.sales_order_id != sales_order.id:
                raise serializers.ValidationError({'reservation': 'Reservation phải khớp với đơn hàng.'})
            if quantity and reservation.active_qty < quantity:
                raise serializers.ValidationError(
                    {'quantity': f'Reservation chỉ còn {reservation.active_qty}, yêu cầu={quantity}.'}
                )

        if tx_type in {
            InventoryTransactionType.ISSUE,
            InventoryTransactionType.ADJUSTMENT_OUT,
            InventoryTransactionType.TRANSFER,
        } and product and warehouse and quantity:
            balance = get_stock_balance(product_id=product.id, warehouse_id=warehouse.id, location_id=getattr(location, 'id', None))
            if balance['on_hand'] < quantity:
                raise serializers.ValidationError(
                    {'quantity': f'Tồn hiện tại không đủ. On hand={balance["on_hand"]}, yêu cầu={quantity}.'}
                )
            if reservation:
                # Reservation này đã được trừ khỏi available; khi xuất đúng reservation chỉ cần đảm bảo on-hand và quota reservation.
                pass
            elif balance['available'] < quantity:
                raise serializers.ValidationError(
                    {'quantity': f'Available không đủ. Available={balance["available"]}, yêu cầu={quantity}.'}
                )

        return attrs

    def create(self, validated_data):
        validated_data.setdefault('transaction_date', timezone.localdate())
        validated_data['code'] = get_next_inventory_transaction_code(validated_data['transaction_date'])
        return super().create(validated_data)


class InventoryReservationSerializer(serializers.ModelSerializer):
    product_code = serializers.CharField(source='product.code', read_only=True)
    product_name = serializers.CharField(source='product.name', read_only=True)
    warehouse_name = serializers.CharField(source='warehouse.name', read_only=True)
    location_name = serializers.CharField(source='location.name', read_only=True)
    sales_order_code = serializers.CharField(source='sales_order.code', read_only=True)
    active_qty = serializers.DecimalField(max_digits=18, decimal_places=4, read_only=True)

    class Meta:
        model = InventoryReservation
        fields = [
            'id',
            'code',
            'status',
            'reservation_date',
            'sales_order',
            'sales_order_code',
            'sales_order_line',
            'product',
            'product_code',
            'product_name',
            'warehouse',
            'warehouse_name',
            'location',
            'location_name',
            'reserved_qty',
            'released_qty',
            'fulfilled_qty',
            'active_qty',
            'reference',
            'note',
            'created_at',
            'updated_at',
        ]
        read_only_fields = [
            'code',
            'status',
            'released_qty',
            'fulfilled_qty',
            'active_qty',
            'created_at',
            'updated_at',
            'sales_order_code',
            'product_code',
            'product_name',
            'warehouse_name',
            'location_name',
        ]

    def validate(self, attrs):
        attrs = super().validate(attrs)
        product = attrs.get('product', getattr(self.instance, 'product', None))
        warehouse = attrs.get('warehouse', getattr(self.instance, 'warehouse', None))
        location = attrs.get('location', getattr(self.instance, 'location', None))
        sales_order_line = attrs.get('sales_order_line', getattr(self.instance, 'sales_order_line', None))
        reserved_qty = attrs.get('reserved_qty', getattr(self.instance, 'reserved_qty', None))
        sales_order = attrs.get('sales_order', getattr(self.instance, 'sales_order', None))

        _ensure_active_warehouse('warehouse', warehouse)
        _ensure_active_location('location', location)
        if location and warehouse and location.warehouse_id != warehouse.id:
            raise serializers.ValidationError({'location': 'Vị trí không thuộc kho đã chọn.'})
        if sales_order or sales_order_line:
            _ensure_sales_ready_location('location', location)
        if sales_order_line:
            if product and sales_order_line.product_id != product.id:
                raise serializers.ValidationError({'sales_order_line': 'Dòng đơn hàng phải cùng sản phẩm.'})
            attrs.setdefault('sales_order', sales_order_line.sales_order)
            existing_reserved = (
                InventoryReservation.objects.filter(
                    sales_order_line=sales_order_line,
                    status__in=[InventoryReservationStatus.OPEN, InventoryReservationStatus.FULFILLED],
                )
                .exclude(pk=getattr(self.instance, 'pk', None))
                .aggregate(total=Sum('reserved_qty'))
                .get('total')
                or Decimal('0')
            )
            order_line_qty = sales_order_line.qty or Decimal('0')
            if reserved_qty and (existing_reserved + reserved_qty) > order_line_qty:
                raise serializers.ValidationError(
                    {'reserved_qty': f'Tổng reservation vượt số lượng dòng hàng ({order_line_qty}).'}
                )

        if product and warehouse and reserved_qty:
            balance = get_stock_balance(product_id=product.id, warehouse_id=warehouse.id, location_id=getattr(location, 'id', None))
            if balance['available'] < reserved_qty:
                raise serializers.ValidationError(
                    {'reserved_qty': f'Available không đủ. Available={balance["available"]}, yêu cầu={reserved_qty}.'}
                )
        return attrs

    def create(self, validated_data):
        validated_data.setdefault('reservation_date', timezone.localdate())
        validated_data['code'] = get_next_inventory_reservation_code(validated_data['reservation_date'])
        return super().create(validated_data)


class OutboundShipmentSerializer(serializers.ModelSerializer):
    sales_order_code = serializers.CharField(source='sales_order.code', read_only=True)
    total_qty = serializers.SerializerMethodField()
    item_count = serializers.SerializerMethodField()
    package_count = serializers.SerializerMethodField()
    total_gross_weight_kg = serializers.SerializerMethodField()
    verified_package_count = serializers.SerializerMethodField()
    loaded_package_count = serializers.SerializerMethodField()
    loading_confirmed_by_name = serializers.SerializerMethodField()
    delivery_confirmed_by_name = serializers.SerializerMethodField()

    class Meta:
        model = OutboundShipment
        fields = [
            'id',
            'code',
            'sales_order',
            'sales_order_code',
            'shipment_date',
            'status',
            'reference',
            'carrier_name',
            'tracking_number',
            'vehicle_no',
            'driver_name',
            'driver_phone',
            'note',
            'loading_reference',
            'handover_receiver_name',
            'handover_receiver_phone',
            'handover_proof_url',
            'loading_confirmation_note',
            'loading_confirmed_at',
            'loading_confirmed_by',
            'loading_confirmed_by_name',
            'delivery_reference',
            'customer_receiver_name',
            'customer_receiver_phone',
            'delivery_proof_url',
            'delivery_confirmation_note',
            'delivered_at_actual',
            'delivery_confirmed_at',
            'delivery_confirmed_by',
            'delivery_confirmed_by_name',
            'total_qty',
            'item_count',
            'package_count',
            'total_gross_weight_kg',
            'verified_package_count',
            'loaded_package_count',
            'posted_at',
            'created_at',
            'updated_at',
        ]
        read_only_fields = fields

    def get_total_qty(self, obj):
        return (
            obj.transactions.filter(status=InventoryTransactionStatus.POSTED).aggregate(total=Sum('quantity')).get('total')
            or Decimal('0')
        )

    def get_item_count(self, obj):
        return obj.transactions.filter(status=InventoryTransactionStatus.POSTED).count()

    def get_package_count(self, obj):
        return obj.packages.filter(status=OutboundShipmentPackageStatus.ACTIVE).count()

    def get_total_gross_weight_kg(self, obj):
        return (
            obj.packages.filter(status=OutboundShipmentPackageStatus.ACTIVE).aggregate(total=Sum('gross_weight_kg')).get('total')
            or Decimal('0')
        )

    def get_verified_package_count(self, obj):
        return obj.packages.filter(status=OutboundShipmentPackageStatus.ACTIVE, verified_at__isnull=False).count()

    def get_loaded_package_count(self, obj):
        return obj.packages.filter(status=OutboundShipmentPackageStatus.ACTIVE, loaded_at__isnull=False).count()

    def get_loading_confirmed_by_name(self, obj):
        user = getattr(obj, 'loading_confirmed_by', None)
        if not user:
            return None
        return getattr(user, 'full_name', None) or getattr(user, 'username', None)

    def get_delivery_confirmed_by_name(self, obj):
        user = getattr(obj, 'delivery_confirmed_by', None)
        if not user:
            return None
        return getattr(user, 'full_name', None) or getattr(user, 'username', None)


class OutboundShipmentPackageSerializer(serializers.ModelSerializer):
    shipment_code = serializers.CharField(source='shipment.code', read_only=True)
    transaction_code = serializers.CharField(source='inventory_transaction.code', read_only=True)
    line_number = serializers.IntegerField(source='sales_order_line.line_number', read_only=True)
    product_code = serializers.CharField(source='inventory_transaction.product.code', read_only=True)
    product_name = serializers.CharField(source='inventory_transaction.product.name', read_only=True)
    verified_by_name = serializers.SerializerMethodField()
    loaded_by_name = serializers.SerializerMethodField()

    class Meta:
        model = OutboundShipmentPackage
        fields = [
            'id',
            'shipment',
            'shipment_code',
            'inventory_transaction',
            'transaction_code',
            'sales_order_line',
            'line_number',
            'product_code',
            'product_name',
            'status',
            'package_no',
            'total_packages',
            'quantity',
            'package_type',
            'gross_weight_kg',
            'length_cm',
            'width_cm',
            'height_cm',
            'package_code',
            'label_qr_value',
            'note',
            'verified_at',
            'verified_by',
            'verified_by_name',
            'loaded_at',
            'loaded_by',
            'loaded_by_name',
            'cancelled_at',
            'cancel_reason',
            'created_at',
            'updated_at',
        ]
        read_only_fields = fields

    def get_verified_by_name(self, obj):
        user = getattr(obj, 'verified_by', None)
        if not user:
            return None
        return getattr(user, 'full_name', None) or getattr(user, 'username', None)

    def get_loaded_by_name(self, obj):
        user = getattr(obj, 'loaded_by', None)
        if not user:
            return None
        return getattr(user, 'full_name', None) or getattr(user, 'username', None)


class StocktakeLineSerializer(serializers.ModelSerializer):
    product_code = serializers.CharField(source='product.code', read_only=True)
    product_name = serializers.CharField(source='product.name', read_only=True)
    variance_qty = serializers.SerializerMethodField()

    class Meta:
        model = StocktakeLine
        fields = [
            'id',
            'stocktake',
            'product',
            'product_code',
            'product_name',
            'warehouse',
            'line_number',
            'system_qty',
            'count_qty',
            'variance_qty',
            'note',
        ]
        read_only_fields = ['product_code', 'product_name', 'variance_qty']

    def get_variance_qty(self, obj):
        return (obj.count_qty or Decimal('0')) - (obj.system_qty or Decimal('0'))


class StocktakeSerializer(serializers.ModelSerializer):
    warehouse_name = serializers.CharField(source='warehouse.name', read_only=True)
    lines = StocktakeLineSerializer(many=True, read_only=True)
    lines_data = serializers.ListField(child=serializers.DictField(), write_only=True, required=False)

    class Meta:
        model = Stocktake
        fields = [
            'id',
            'code',
            'warehouse',
            'warehouse_name',
            'count_date',
            'status',
            'note',
            'created_at',
            'updated_at',
            'created_by',
            'completed_at',
            'completed_by',
            'lines',
            'lines_data',
        ]
        read_only_fields = ['code', 'created_at', 'updated_at', 'warehouse_name', 'completed_at', 'completed_by']

    def create(self, validated_data):
        lines_data = validated_data.pop('lines_data', [])
        validated_data['code'] = get_next_stocktake_code(validated_data.get('count_date'))
        created_by = validated_data.pop('created_by', None) or getattr(self.context.get('request'), 'user', None)
        warehouse_id = validated_data['warehouse'].id
        product_ids = [item.get('product_id') or item.get('product') for item in lines_data if item.get('product_id') or item.get('product')]
        product_ids = [int(x) for x in product_ids if x is not None]
        balances = build_stock_balance_map(product_ids=product_ids or None, warehouse_ids=[warehouse_id])
        sum_by_pw = defaultdict(Decimal)
        for (pid, wid, _), row in balances.items():
            sum_by_pw[(pid, wid)] = sum_by_pw[(pid, wid)] + row['on_hand']
        with transaction.atomic():
            stocktake = Stocktake.objects.create(**validated_data, created_by=created_by)
            for idx, line_item in enumerate(lines_data):
                product_id = line_item.get('product_id') or line_item.get('product')
                if not product_id:
                    continue
                product_id = int(product_id)
                count_qty = line_item.get('count_qty', 0)
                system_qty = sum_by_pw.get((product_id, warehouse_id), Decimal('0'))
                StocktakeLine.objects.create(
                    stocktake=stocktake,
                    product_id=product_id,
                    warehouse_id=warehouse_id,
                    line_number=idx + 1,
                    system_qty=system_qty,
                    count_qty=count_qty,
                    note=line_item.get('note', ''),
                )
        return stocktake

    def update(self, instance, validated_data):
        if instance.status != StocktakeStatus.DRAFT:
            raise serializers.ValidationError('Chỉ được sửa phiếu kiểm tồn ở trạng thái Nháp.')
        lines_data = validated_data.pop('lines_data', None)
        for k, v in validated_data.items():
            setattr(instance, k, v)
        instance.save()
        if lines_data is not None:
            instance.lines.all().delete()
            warehouse_id = instance.warehouse_id
            product_ids = [int(item.get('product_id') or item.get('product')) for item in lines_data if item.get('product_id') or item.get('product')]
            balances = build_stock_balance_map(product_ids=product_ids or None, warehouse_ids=[warehouse_id])
            sum_by_pw = defaultdict(Decimal)
            for (pid, wid, _), row in balances.items():
                sum_by_pw[(pid, wid)] = sum_by_pw[(pid, wid)] + row['on_hand']
            for idx, line_item in enumerate(lines_data):
                product_id = line_item.get('product_id') or line_item.get('product')
                if not product_id:
                    continue
                product_id = int(product_id)
                count_qty = line_item.get('count_qty', 0)
                system_qty = sum_by_pw.get((product_id, warehouse_id), Decimal('0'))
                StocktakeLine.objects.create(
                    stocktake=instance,
                    product_id=product_id,
                    warehouse_id=warehouse_id,
                    line_number=idx + 1,
                    system_qty=system_qty,
                    count_qty=count_qty,
                    note=line_item.get('note', ''),
                )
        return instance


class StockAlertSerializer(serializers.ModelSerializer):
    product_code = serializers.SerializerMethodField()
    product_name = serializers.SerializerMethodField()
    acknowledged_by_name = serializers.SerializerMethodField()

    class Meta:
        model = StockAlert
        fields = [
            'id',
            'product',
            'product_code',
            'product_name',
            'alert_type',
            'status',
            'triggered_at',
            'acknowledged_at',
            'acknowledged_by',
            'acknowledged_by_name',
            'current_qty',
            'min_stock',
        ]
        read_only_fields = [
            'id',
            'product',
            'alert_type',
            'triggered_at',
            'product_code',
            'product_name',
            'acknowledged_by_name',
        ]

    def get_product_code(self, obj):
        if obj.product_id and obj.product:
            return obj.product.code
        return None

    def get_product_name(self, obj):
        if obj.product_id and obj.product:
            return obj.product.name
        return None

    def get_acknowledged_by_name(self, obj):
        user = getattr(obj, 'acknowledged_by', None)
        if not user:
            return None
        return getattr(user, 'full_name', None) or getattr(user, 'username', None)


# Warehouse Transfer Serializers
from inventory import models as inv_models


class WarehouseTransferLineSerializer(serializers.ModelSerializer):
    product_code = serializers.SerializerMethodField()
    product_name = serializers.SerializerMethodField()

    class Meta:
        model = inv_models.WarehouseTransferLine
        fields = ['id', 'line_number', 'product', 'product_code', 'product_name', 'qty', 'received_qty', 'note']

    def get_product_code(self, obj):
        return getattr(obj.product, 'code', None) if obj.product else None

    def get_product_name(self, obj):
        return getattr(obj.product, 'name', None) if obj.product else None


class WarehouseTransferSerializer(serializers.ModelSerializer):
    lines = WarehouseTransferLineSerializer(many=True, required=False)
    from_warehouse_code = serializers.SerializerMethodField()
    to_warehouse_code = serializers.SerializerMethodField()

    class Meta:
        model = inv_models.WarehouseTransfer
        fields = [
            'id', 'code', 'transfer_date', 'status', 'reference',
            'from_warehouse', 'from_warehouse_code', 'to_warehouse', 'to_warehouse_code',
            'note', 'created_by', 'created_at', 'submitted_by', 'submitted_at',
            'posted_by', 'posted_at', 'cancelled_by', 'cancelled_at', 'cancel_reason',
            'lines',
        ]
        read_only_fields = ['code', 'created_by', 'created_at']

    def get_from_warehouse_code(self, obj):
        return f"{obj.from_warehouse.code} - {obj.from_warehouse.name}" if obj.from_warehouse else None

    def get_to_warehouse_code(self, obj):
        return f"{obj.to_warehouse.code} - {obj.to_warehouse.name}" if obj.to_warehouse else None

    def create(self, validated_data):
        from datetime import date
        lines_data = validated_data.pop('lines', [])
        transfer_date = validated_data.get('transfer_date')
        if not transfer_date:
            transfer_date = date.today()
        validated_data['code'] = f"TRN-{transfer_date.strftime('%Y%m%d')}-{int(timezone.now().timestamp()) % 10000}"
        with transaction.atomic():
            transfer = inv_models.WarehouseTransfer.objects.create(**validated_data)
            for i, line_data in enumerate(lines_data, start=1):
                line_data['line_number'] = line_data.get('line_number') or i
                line_data['transfer'] = transfer
                inv_models.WarehouseTransferLine.objects.create(**line_data)
        return transfer

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
                    line_data['transfer'] = instance
                    inv_models.WarehouseTransferLine.objects.create(**line_data)
        return instance
