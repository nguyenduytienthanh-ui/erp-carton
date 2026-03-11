from collections import defaultdict
from datetime import date
from decimal import Decimal

from django.db import transaction
from django.db.models import Q
from django.utils import timezone

from inventory.models import (
    OutboundShipmentStatus,
    OutboundShipmentPackageStatus,
    InventoryReservation,
    InventoryReservationStatus,
    InventoryTransaction,
    InventoryTransactionStatus,
    InventoryTransactionType,
)
from sales.models import PeriodSequence


def _get_next_sequence_code(doc_type: str, tx_date: date) -> str:
    period = (tx_date or timezone.localdate()).strftime('%Y%m')
    with transaction.atomic():
        sequence, _ = PeriodSequence.objects.select_for_update().get_or_create(
            doc_type=doc_type,
            period=period,
            defaults={'current_number': 0, 'padding': 5},
        )
        return sequence.get_next_code()


def get_next_inventory_transaction_code(tx_date: date | None = None) -> str:
    return _get_next_sequence_code('INVTX', tx_date or timezone.localdate())


def get_next_inventory_reservation_code(tx_date: date | None = None) -> str:
    return _get_next_sequence_code('INVRSV', tx_date or timezone.localdate())


def get_next_inventory_shipment_code(tx_date: date | None = None) -> str:
    return _get_next_sequence_code('SHIP', tx_date or timezone.localdate())


def _normalize_key(product_id, warehouse_id, location_id):
    return (int(product_id), int(warehouse_id) if warehouse_id else 0, int(location_id) if location_id else 0)


def build_stock_balance_map(
    *,
    product_ids=None,
    warehouse_ids=None,
    location_ids=None,
    include_reservations: bool = True,
):
    tx_filters = Q(status=InventoryTransactionStatus.POSTED)
    if product_ids:
        tx_filters &= Q(product_id__in=list(product_ids))
    if warehouse_ids:
        tx_filters &= (Q(warehouse_id__in=list(warehouse_ids)) | Q(target_warehouse_id__in=list(warehouse_ids)))
    if location_ids:
        tx_filters &= (Q(location_id__in=list(location_ids)) | Q(target_location_id__in=list(location_ids)))

    balances = defaultdict(lambda: {'on_hand': Decimal('0'), 'reserved': Decimal('0')})
    tx_qs = InventoryTransaction.objects.filter(tx_filters).select_related(
        'product',
        'warehouse',
        'location',
        'target_warehouse',
        'target_location',
    )
    for tx in tx_qs:
        qty = tx.quantity or Decimal('0')
        if tx.transaction_type in {InventoryTransactionType.RECEIPT, InventoryTransactionType.ADJUSTMENT_IN}:
            key = _normalize_key(tx.product_id, tx.warehouse_id, tx.location_id)
            balances[key]['on_hand'] += qty
        elif tx.transaction_type in {InventoryTransactionType.ISSUE, InventoryTransactionType.ADJUSTMENT_OUT}:
            key = _normalize_key(tx.product_id, tx.warehouse_id, tx.location_id)
            balances[key]['on_hand'] -= qty
        elif tx.transaction_type == InventoryTransactionType.TRANSFER:
            source_key = _normalize_key(tx.product_id, tx.warehouse_id, tx.location_id)
            target_key = _normalize_key(tx.product_id, tx.target_warehouse_id, tx.target_location_id)
            balances[source_key]['on_hand'] -= qty
            balances[target_key]['on_hand'] += qty

    if include_reservations:
        reservation_filters = Q(status=InventoryReservationStatus.OPEN)
        if product_ids:
            reservation_filters &= Q(product_id__in=list(product_ids))
        if warehouse_ids:
            reservation_filters &= Q(warehouse_id__in=list(warehouse_ids))
        if location_ids:
            reservation_filters &= Q(location_id__in=list(location_ids))
        for reservation in InventoryReservation.objects.filter(reservation_filters):
            key = _normalize_key(reservation.product_id, reservation.warehouse_id, reservation.location_id)
            balances[key]['reserved'] += reservation.active_qty

    return balances


def get_stock_balance(*, product_id: int, warehouse_id: int, location_id: int | None = None):
    key = _normalize_key(product_id, warehouse_id, location_id)
    row = build_stock_balance_map(
        product_ids=[product_id],
        warehouse_ids=[warehouse_id],
        location_ids=[location_id] if location_id else None,
    ).get(key, {'on_hand': Decimal('0'), 'reserved': Decimal('0')})
    on_hand = row['on_hand']
    reserved = row['reserved']
    available = on_hand - reserved
    return {
        'on_hand': on_hand,
        'reserved': reserved,
        'available': available,
    }


def sync_reservation_status(reservation: InventoryReservation, *, actor=None, save: bool = True):
    active_qty = reservation.active_qty
    effective_reserved_qty = (reservation.reserved_qty or Decimal('0')) - (reservation.released_qty or Decimal('0'))
    if active_qty > 0:
        reservation.status = InventoryReservationStatus.OPEN
    elif (reservation.fulfilled_qty or Decimal('0')) > 0 and (reservation.fulfilled_qty or Decimal('0')) >= effective_reserved_qty:
        reservation.status = InventoryReservationStatus.FULFILLED
    elif (reservation.released_qty or Decimal('0')) > 0:
        reservation.status = InventoryReservationStatus.RELEASED
    else:
        reservation.status = InventoryReservationStatus.OPEN
    if actor is not None:
        reservation.updated_by = actor
    if save:
        reservation.save(update_fields=['status', 'updated_by', 'updated_at'])
    return reservation


def apply_reservation_fulfillment(reservation: InventoryReservation, quantity: Decimal, *, actor=None):
    reservation.fulfilled_qty = (reservation.fulfilled_qty or Decimal('0')) + (quantity or Decimal('0'))
    sync_reservation_status(reservation, actor=actor, save=False)
    reservation.save(update_fields=['fulfilled_qty', 'status', 'updated_by', 'updated_at'])
    return reservation


def reverse_reservation_fulfillment(reservation: InventoryReservation, quantity: Decimal, *, actor=None):
    reservation.fulfilled_qty = max(Decimal('0'), (reservation.fulfilled_qty or Decimal('0')) - (quantity or Decimal('0')))
    sync_reservation_status(reservation, actor=actor, save=False)
    reservation.save(update_fields=['fulfilled_qty', 'status', 'updated_by', 'updated_at'])
    return reservation


def cancel_inventory_transaction_record(tx: InventoryTransaction, *, actor=None, reason: str = ''):
    if tx.status != InventoryTransactionStatus.POSTED:
        raise ValueError('Chỉ hủy được chứng từ đã ghi sổ.')
    reason = str(reason or '').strip()
    if not reason:
        raise ValueError('Hủy chứng từ bắt buộc có lý do.')

    tx.status = InventoryTransactionStatus.CANCELLED
    tx.cancel_reason = reason
    tx.cancelled_at = timezone.now()
    tx.cancelled_by = actor
    tx.updated_by = actor
    tx.save(update_fields=['status', 'cancel_reason', 'cancelled_at', 'cancelled_by', 'updated_by', 'updated_at'])

    if tx.reservation and tx.transaction_type == InventoryTransactionType.ISSUE:
        reverse_reservation_fulfillment(tx.reservation, tx.quantity or Decimal('0'), actor=actor)

    if tx.transaction_type == InventoryTransactionType.ISSUE and tx.sales_order_line_id:
        from sales.services import reverse_delivery_plan_shipment

        reverse_delivery_plan_shipment(tx.sales_order_line, tx.quantity or Decimal('0'), actor=actor)

    if tx.shipment_batch_id:
        remaining_posted = tx.shipment_batch.transactions.filter(status=InventoryTransactionStatus.POSTED).exists()
        if not remaining_posted:
            tx.shipment_batch.status = OutboundShipmentStatus.CANCELLED
            tx.shipment_batch.cancelled_at = timezone.now()
            tx.shipment_batch.cancelled_by = actor
            tx.shipment_batch.cancel_reason = reason
            tx.shipment_batch.updated_by = actor
            tx.shipment_batch.save(
                update_fields=[
                    'status',
                    'cancelled_at',
                    'cancelled_by',
                    'cancel_reason',
                    'updated_by',
                    'updated_at',
                ]
            )
            tx.shipment_batch.packages.filter(status=OutboundShipmentPackageStatus.ACTIVE).update(
                status=OutboundShipmentPackageStatus.CANCELLED,
                cancelled_at=timezone.now(),
                cancel_reason=reason,
                updated_by=actor,
            )

    return tx
