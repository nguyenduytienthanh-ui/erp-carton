from decimal import Decimal

from django.db import transaction
from django.db.models import Sum
from django.utils import timezone
from rest_framework.exceptions import ValidationError

from finance.models import PayableAdjustmentDirection, PayableDocument, PayableStatus
from finance.services import create_payable_adjustment, get_payable_open_balance, refresh_payable_status
from inventory.models import InventoryTransactionType
from inventory.serializers import InventoryTransactionSerializer
from sales.document_policy import calc_line_totals, round_money, round_qty
from sales.models import PeriodSequence

from purchasing.models import (
    PurchaseOrderStatus,
    PurchaseReceiptLine,
    PurchaseReceiptStatus,
    PurchaseRequestSequence,
    PurchaseReturnLine,
    PurchaseReturnStatus,
)


def build_supplier_snapshot(supplier):
    if not supplier:
        return {}
    return {
        'id': supplier.id,
        'code': supplier.code,
        'name': supplier.name,
        'company_name': supplier.company_name,
        'tax_code': supplier.tax_code,
        'phone': supplier.phone,
        'email': supplier.email,
        'address': supplier.address,
        'contact_person': supplier.contact_person,
        'contact_phone': supplier.contact_phone,
        'payment_terms_days': supplier.payment_terms_days,
    }


def build_purchase_order_line_product_snapshot(product):
    if not product:
        return {}
    return {
        'product_id': product.id,
        'code': product.code,
        'name': product.name,
        'unit_id': product.unit_id,
        'unit_code': getattr(getattr(product, 'unit', None), 'code', None),
        'unit_name': getattr(getattr(product, 'unit', None), 'name', None),
        'category_id': product.category_id,
        'category_name': getattr(getattr(product, 'category', None), 'name', None),
        'description': product.description or '',
        'size_order': product.size_order or '',
        'size_production': product.size_production or '',
        'cost_price': str(product.cost_price or 0),
        'sale_price': str(product.sale_price or 0),
        'status': product.status,
    }


def get_next_purchase_order_code(order_date):
    period = order_date.strftime('%Y%m')
    seq, _ = PeriodSequence.objects.get_or_create(
        doc_type='PO',
        period=period,
        defaults={'current_number': 0, 'padding': 5},
    )
    return seq.get_next_code()


def get_next_purchase_receipt_code(receipt_date):
    period = receipt_date.strftime('%Y%m')
    seq, _ = PeriodSequence.objects.get_or_create(
        doc_type='GRN',
        period=period,
        defaults={'current_number': 0, 'padding': 5},
    )
    return seq.get_next_code()


def get_next_pr_code(request_date):
    """PR-YYYYMM-NNNNN."""
    period = request_date.strftime('%Y%m')
    seq, _ = PurchaseRequestSequence.objects.get_or_create(
        period=period,
        defaults={'current_number': 0, 'padding': 5},
    )
    return seq.get_next_code()


def add_received_qty(line, quantity):
    qty = round_qty(quantity or 0)
    line.received_qty = round_qty(Decimal(str(line.received_qty or 0)) + qty)
    line.save(update_fields=['received_qty'])
    return line.received_qty


def subtract_received_qty(line, quantity):
    qty = round_qty(quantity or 0)
    next_value = Decimal(str(line.received_qty or 0)) - qty
    line.received_qty = round_qty(next_value if next_value > 0 else Decimal('0'))
    line.save(update_fields=['received_qty'])
    return line.received_qty


def sync_purchase_order_receipt_status(order):
    lines = list(order.lines.all())
    if not lines:
        return order.status

    total_ordered = sum((Decimal(str(line.qty or 0)) for line in lines), Decimal('0'))
    total_received = sum((Decimal(str(line.received_qty or 0)) for line in lines), Decimal('0'))
    all_received = bool(lines) and all(line.remaining_qty <= 0 for line in lines)
    any_received = total_received > 0

    next_status = order.status
    if all_received and total_ordered > 0:
        next_status = PurchaseOrderStatus.RECEIVED
    elif any_received:
        next_status = PurchaseOrderStatus.PARTIAL_RECEIVED
    elif order.status in {PurchaseOrderStatus.PARTIAL_RECEIVED, PurchaseOrderStatus.RECEIVED}:
        next_status = PurchaseOrderStatus.APPROVED

    if next_status != order.status:
        order.status = next_status
        order.save(update_fields=['status', 'updated_at'])
    return order.status


RETURN_AP_OPEN_BALANCE_MESSAGE = (
    'Không thể ghi nhận trả hàng vì công nợ của phiếu nhập đã được thanh toán hoặc không còn đủ số dư. '
    'Cần xử lý Phiếu ghi có nhà cung cấp ở giai đoạn sau.'
)


def recalc_purchase_return_totals(purchase_return):
    subtotal = Decimal('0')
    tax_total = Decimal('0')
    total = Decimal('0')
    for line in purchase_return.lines.all():
        line_subtotal, _discount, line_tax, line_total = calc_line_totals(
            line.qty,
            line.unit_price,
            Decimal('0'),
            line.tax_pct,
        )
        subtotal += line_subtotal
        tax_total += line_tax
        total += line_total
    purchase_return.subtotal = round_money(subtotal)
    purchase_return.tax_total = round_money(tax_total)
    purchase_return.total = round_money(total)
    purchase_return.save(update_fields=['subtotal', 'tax_total', 'total', 'updated_at'])
    return purchase_return


def get_returned_qty_for_receipt_line(receipt_line, *, exclude_return_id=None):
    queryset = PurchaseReturnLine.objects.filter(
        source_receipt_line=receipt_line,
        purchase_return__status=PurchaseReturnStatus.POSTED,
    )
    if exclude_return_id:
        queryset = queryset.exclude(purchase_return_id=exclude_return_id)
    total = queryset.aggregate(total=Sum('qty')).get('total') or Decimal('0')
    return round_qty(total)


def get_remaining_returnable_qty(receipt_line, *, exclude_return_id=None):
    received_qty = Decimal(str(receipt_line.quantity or 0))
    returned_qty = get_returned_qty_for_receipt_line(receipt_line, exclude_return_id=exclude_return_id)
    remaining = received_qty - returned_qty
    return round_qty(remaining if remaining > 0 else Decimal('0'))


def build_returnable_receipt_line_payload(receipt_line):
    posted_returned_qty = get_returned_qty_for_receipt_line(receipt_line)
    remaining_qty = get_remaining_returnable_qty(receipt_line)
    product_snapshot = receipt_line.product_snapshot or {}
    purchase_order_line = getattr(receipt_line, 'purchase_order_line', None)
    return {
        'id': receipt_line.id,
        'line_number': receipt_line.line_number,
        'purchase_order_line': receipt_line.purchase_order_line_id,
        'purchase_order_line_number': getattr(purchase_order_line, 'line_number', None),
        'product': receipt_line.product_id,
        'product_code': product_snapshot.get('code') or getattr(getattr(receipt_line, 'product', None), 'code', None),
        'product_name': product_snapshot.get('name') or getattr(getattr(receipt_line, 'product', None), 'name', None),
        'quantity': str(receipt_line.quantity or Decimal('0')),
        'unit_cost': str(receipt_line.unit_cost or Decimal('0')),
        'tax_pct': str(Decimal('0')),
        'posted_returned_qty': str(posted_returned_qty),
        'remaining_returnable_qty': str(remaining_qty),
        'note': receipt_line.note,
    }


def validate_purchase_return_sources(purchase_return, *, exclude_return_id=None):
    if not purchase_return.source_receipt_id:
        raise ValidationError({'source_receipt': 'Phiếu trả hàng phải chọn phiếu nhập nguồn.'})
    source_receipt = purchase_return.source_receipt
    if source_receipt.status != PurchaseReceiptStatus.POSTED:
        raise ValidationError({'source_receipt': 'Chỉ được trả hàng từ phiếu nhập đã ghi sổ.'})
    if purchase_return.purchase_order_id and purchase_return.purchase_order_id != source_receipt.purchase_order_id:
        raise ValidationError({'purchase_order': 'Đơn mua phải trùng với phiếu nhập nguồn.'})
    if purchase_return.supplier_id != source_receipt.purchase_order.supplier_id:
        raise ValidationError({'supplier': 'Nhà cung cấp phải trùng với phiếu nhập nguồn.'})

    seen_receipt_lines = set()
    lines = list(purchase_return.lines.select_related('source_receipt_line', 'source_receipt_line__product'))
    if not lines:
        raise ValidationError({'lines': 'Phiếu trả hàng phải có ít nhất một dòng.'})
    for index, line in enumerate(lines, start=1):
        if not line.source_receipt_line_id:
            raise ValidationError({'lines': f'Dòng {index}: thiếu dòng phiếu nhập nguồn.'})
        if line.source_receipt_line.receipt_id != source_receipt.id:
            raise ValidationError({'lines': f'Dòng {index}: dòng phiếu nhập không thuộc phiếu nhập nguồn.'})
        if line.source_receipt_line_id in seen_receipt_lines:
            raise ValidationError({'lines': f'Dòng {index}: dòng phiếu nhập bị lặp.'})
        seen_receipt_lines.add(line.source_receipt_line_id)
        if line.product_id != line.source_receipt_line.product_id:
            raise ValidationError({'lines': f'Dòng {index}: sản phẩm phải trùng với dòng phiếu nhập nguồn.'})
        if line.qty <= 0:
            raise ValidationError({'lines': f'Dòng {index}: số lượng trả phải lớn hơn 0.'})
        remaining_qty = get_remaining_returnable_qty(line.source_receipt_line, exclude_return_id=exclude_return_id)
        if line.qty > remaining_qty:
            raise ValidationError({'lines': f'Dòng {index}: chỉ còn {remaining_qty} có thể trả.'})
    return True


def cancel_unposted_purchase_return(purchase_return, *, actor=None, reason=''):
    if purchase_return.status in {PurchaseReturnStatus.POSTED, PurchaseReturnStatus.REVERSED}:
        raise ValidationError({'error': 'Phiếu trả hàng đã ghi sổ không thể hủy; cần dùng nghiệp vụ đảo phiếu.'})
    if purchase_return.status == PurchaseReturnStatus.CANCELLED:
        return purchase_return
    purchase_return.status = PurchaseReturnStatus.CANCELLED
    purchase_return.cancelled_by = actor
    purchase_return.cancelled_at = timezone.now()
    purchase_return.cancel_reason = str(reason or '').strip() or 'Hủy phiếu trả'
    purchase_return.save(update_fields=['status', 'cancelled_by', 'cancelled_at', 'cancel_reason', 'updated_at'])
    return purchase_return


def _create_inventory_transaction_for_return_line(line, *, actor, transaction_type, reference, note):
    source_receipt = line.purchase_return.source_receipt
    serializer = InventoryTransactionSerializer(data={
        'transaction_type': transaction_type,
        'transaction_date': line.purchase_return.return_date,
        'product': line.product_id,
        'warehouse': source_receipt.warehouse_id,
        'location': source_receipt.location_id,
        'quantity': str(line.qty),
        'unit_cost': str(line.unit_price or 0),
        'reference': reference,
        'reason': line.purchase_return.return_reason,
        'note': note,
    })
    serializer.is_valid(raise_exception=True)
    return serializer.save(
        created_by=actor,
        updated_by=actor,
        posted_by=actor,
        purchase_order=line.purchase_return.purchase_order,
        purchase_order_line=line.source_receipt_line.purchase_order_line,
        purchase_receipt=source_receipt,
    )


def post_purchase_return(purchase_return, *, actor=None):
    with transaction.atomic():
        locked_return = (
            purchase_return.__class__.objects
            .select_for_update()
            .select_related('supplier', 'purchase_order', 'source_receipt', 'source_receipt__purchase_order')
            .prefetch_related('lines', 'lines__source_receipt_line', 'lines__source_receipt_line__purchase_order_line')
            .get(pk=purchase_return.pk)
        )
        if locked_return.status != PurchaseReturnStatus.APPROVED:
            raise ValidationError({'error': 'Chỉ được ghi sổ phiếu trả hàng đã duyệt.'})
        validate_purchase_return_sources(locked_return, exclude_return_id=locked_return.id)
        receipt_line_ids = list(locked_return.lines.values_list('source_receipt_line_id', flat=True))
        list(PurchaseReceiptLine.objects.select_for_update().filter(pk__in=receipt_line_ids))
        validate_purchase_return_sources(locked_return, exclude_return_id=locked_return.id)

        payable = (
            PayableDocument.objects
            .select_for_update()
            .exclude(status=PayableStatus.CANCELLED)
            .filter(source_purchase_receipt=locked_return.source_receipt)
            .first()
        )
        if not payable:
            raise ValidationError({'error': 'Không tìm thấy chứng từ công nợ của phiếu nhập nguồn.'})
        reduction_amount = round_money(locked_return.total or 0)
        if reduction_amount <= 0:
            raise ValidationError({'error': 'Giá trị trả hàng phải lớn hơn 0.'})
        if reduction_amount > get_payable_open_balance(payable):
            raise ValidationError({'error': RETURN_AP_OPEN_BALANCE_MESSAGE})

        for line in locked_return.lines.select_related('source_receipt_line', 'source_receipt_line__purchase_order_line'):
            if line.inventory_transaction_id:
                continue
            tx = _create_inventory_transaction_for_return_line(
                line,
                actor=actor,
                transaction_type=InventoryTransactionType.ISSUE,
                reference=f'{locked_return.code}-ISSUE-L{line.line_number}',
                note=line.note or locked_return.return_notes or '',
            )
            line.inventory_transaction = tx
            line.save(update_fields=['inventory_transaction'])

        create_payable_adjustment(
            payable=payable,
            direction=PayableAdjustmentDirection.CREDIT,
            amount=reduction_amount,
            idempotency_key=f'purchase-return:{locked_return.id}:credit',
            actor=actor,
            source_purchase_receipt=locked_return.source_receipt,
            source_return=locked_return,
            reason=f'Trả hàng mua {locked_return.code}',
            note=locked_return.return_notes,
        )
        locked_return.status = PurchaseReturnStatus.POSTED
        locked_return.posted_by = actor
        locked_return.posted_at = timezone.now()
        locked_return.save(update_fields=['status', 'posted_by', 'posted_at', 'updated_at'])
    return locked_return


def reverse_purchase_return(purchase_return, *, actor=None, reason=''):
    reason = str(reason or '').strip()
    if not reason:
        raise ValidationError({'reason': 'Bắt buộc nhập lý do đảo phiếu trả hàng.'})
    with transaction.atomic():
        locked_return = (
            purchase_return.__class__.objects
            .select_for_update()
            .select_related('supplier', 'purchase_order', 'source_receipt', 'source_receipt__purchase_order')
            .prefetch_related('lines', 'lines__source_receipt_line', 'lines__source_receipt_line__purchase_order_line')
            .get(pk=purchase_return.pk)
        )
        if locked_return.status == PurchaseReturnStatus.REVERSED:
            raise ValidationError({'error': 'Phiếu trả hàng đã được đảo trước đó.'})
        if locked_return.status != PurchaseReturnStatus.POSTED:
            raise ValidationError({'error': 'Chỉ được đảo phiếu trả hàng đã ghi sổ.'})

        credit_adjustment = locked_return.payable_adjustments.select_for_update().filter(
            direction=PayableAdjustmentDirection.CREDIT,
        ).first()
        if not credit_adjustment:
            raise ValidationError({'error': 'Không tìm thấy bút toán giảm công nợ của phiếu trả hàng.'})
        payable = PayableDocument.objects.select_for_update().get(pk=credit_adjustment.payable_id)

        for line in locked_return.lines.select_related('source_receipt_line', 'source_receipt_line__purchase_order_line'):
            if line.reversal_inventory_transaction_id:
                continue
            tx = _create_inventory_transaction_for_return_line(
                line,
                actor=actor,
                transaction_type=InventoryTransactionType.RECEIPT,
                reference=f'{locked_return.code}-REV-L{line.line_number}',
                note=reason,
            )
            line.reversal_inventory_transaction = tx
            line.save(update_fields=['reversal_inventory_transaction'])

        create_payable_adjustment(
            payable=payable,
            direction=PayableAdjustmentDirection.DEBIT,
            amount=credit_adjustment.amount,
            idempotency_key=f'purchase-return:{locked_return.id}:debit-reversal',
            actor=actor,
            source_purchase_receipt=locked_return.source_receipt,
            reversal_of=credit_adjustment,
            reason=f'Đảo phiếu trả hàng mua {locked_return.code}',
            note=reason,
        )
        refresh_payable_status(payable, actor=actor)
        locked_return.status = PurchaseReturnStatus.REVERSED
        locked_return.reversed_by = actor
        locked_return.reversed_at = timezone.now()
        locked_return.reversal_reason = reason
        locked_return.save(update_fields=['status', 'reversed_by', 'reversed_at', 'reversal_reason', 'updated_at'])
    return locked_return
