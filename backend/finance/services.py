from datetime import timedelta
from decimal import Decimal

from django.db import models
from django.db import transaction
from django.utils import timezone

from sales.models import PeriodSequence
from sales.document_policy import round_money

from .models import (
    PayableAdjustment,
    PayableAdjustmentDirection,
    PayableAdjustmentStatus,
    PayableDocument,
    PayableSettlement,
    PayableStatus,
    ReceivableDocument,
    ReceivableSettlement,
    ReceivableStatus,
    TransactionCategory,
)


def build_customer_snapshot(customer):
    if not customer:
        return {}
    return {
        'id': customer.id,
        'code': customer.code,
        'name': customer.name,
        'company_name': customer.company_name,
        'tax_code': customer.tax_code,
        'phone': customer.phone,
        'email': customer.email,
        'address': customer.address,
        'contact_person': customer.contact_person,
        'contact_phone': customer.contact_phone,
        'payment_terms_days': customer.payment_terms,
        'credit_limit': str(customer.credit_limit or 0),
    }


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


def get_next_receivable_code(document_date):
    period = document_date.strftime('%Y%m')
    seq, _ = PeriodSequence.objects.get_or_create(
        doc_type='AR',
        period=period,
        defaults={'current_number': 0, 'padding': 5},
    )
    return seq.get_next_code()


def get_next_payable_code(document_date):
    period = document_date.strftime('%Y%m')
    seq, _ = PeriodSequence.objects.get_or_create(
        doc_type='AP',
        period=period,
        defaults={'current_number': 0, 'padding': 5},
    )
    return seq.get_next_code()


def refresh_receivable_status(document, actor=None):
    totals = document.settlements.aggregate(total=models.Sum('amount')) if hasattr(document, 'settlements') else {'total': 0}
    settled_amount = round_money(totals.get('total') or 0)
    total_amount = round_money(document.total_amount or 0)
    next_status = document.status
    if document.status == ReceivableStatus.CANCELLED:
        next_status = ReceivableStatus.CANCELLED
    elif settled_amount <= 0:
        next_status = ReceivableStatus.OPEN
    elif settled_amount < total_amount:
        next_status = ReceivableStatus.PARTIAL
    else:
        next_status = ReceivableStatus.SETTLED

    update_fields = []
    if settled_amount != document.settled_amount:
        document.settled_amount = settled_amount
        update_fields.append('settled_amount')
    if next_status != document.status:
        document.status = next_status
        update_fields.append('status')
    if actor is not None and getattr(document, 'updated_by_id', None) != getattr(actor, 'id', None):
        document.updated_by = actor
        update_fields.append('updated_by')
    if update_fields:
        update_fields.append('updated_at')
        document.save(update_fields=update_fields)
    return document.status


def refresh_payable_status(document, actor=None):
    totals = document.settlements.aggregate(total=models.Sum('amount')) if hasattr(document, 'settlements') else {'total': 0}
    settled_amount = round_money(totals.get('total') or 0)
    total_amount = get_payable_adjusted_total(document)
    next_status = document.status
    if document.status == PayableStatus.CANCELLED:
        next_status = PayableStatus.CANCELLED
    elif settled_amount <= 0:
        next_status = PayableStatus.OPEN
    elif settled_amount < total_amount:
        next_status = PayableStatus.PARTIAL
    else:
        next_status = PayableStatus.SETTLED

    update_fields = []
    if settled_amount != document.settled_amount:
        document.settled_amount = settled_amount
        update_fields.append('settled_amount')
    if next_status != document.status:
        document.status = next_status
        update_fields.append('status')
    if actor is not None and getattr(document, 'updated_by_id', None) != getattr(actor, 'id', None):
        document.updated_by = actor
        update_fields.append('updated_by')
    if update_fields:
        update_fields.append('updated_at')
        document.save(update_fields=update_fields)
    return document.status


def get_payable_adjustment_totals(document):
    if not getattr(document, 'pk', None):
        return {
            PayableAdjustmentDirection.CREDIT: Decimal('0'),
            PayableAdjustmentDirection.DEBIT: Decimal('0'),
        }
    totals = (
        PayableAdjustment.objects
        .filter(payable=document, status=PayableAdjustmentStatus.POSTED)
        .values('direction')
        .annotate(total=models.Sum('amount'))
    )
    result = {
        PayableAdjustmentDirection.CREDIT: Decimal('0'),
        PayableAdjustmentDirection.DEBIT: Decimal('0'),
    }
    for row in totals:
        direction = row.get('direction')
        if direction in result:
            result[direction] = round_money(row.get('total') or 0)
    return result


def get_payable_adjusted_total(document):
    adjustments = get_payable_adjustment_totals(document)
    total = (
        Decimal(str(document.total_amount or 0))
        - adjustments[PayableAdjustmentDirection.CREDIT]
        + adjustments[PayableAdjustmentDirection.DEBIT]
    )
    return round_money(total if total > 0 else Decimal('0'))


def get_payable_open_balance(document):
    remaining = get_payable_adjusted_total(document) - Decimal(str(document.settled_amount or 0))
    return round_money(remaining if remaining > 0 else Decimal('0'))


def create_payable_adjustment(
    *,
    payable,
    direction,
    amount,
    idempotency_key,
    actor=None,
    source_purchase_receipt=None,
    source_return=None,
    reversal_of=None,
    reason='',
    note='',
):
    amount = round_money(amount or 0)
    if amount <= 0:
        raise ValueError('Số tiền điều chỉnh công nợ phải lớn hơn 0.')
    if direction == PayableAdjustmentDirection.CREDIT and not source_return:
        raise ValueError('Điều chỉnh giảm công nợ từ trả hàng phải có phiếu trả hàng nguồn.')
    if direction == PayableAdjustmentDirection.DEBIT and not reversal_of:
        raise ValueError('Điều chỉnh hoàn nhập công nợ phải tham chiếu bút toán gốc.')

    defaults = {
        'payable': payable,
        'source_purchase_receipt': source_purchase_receipt or getattr(payable, 'source_purchase_receipt', None),
        'source_return': source_return if direction == PayableAdjustmentDirection.CREDIT else None,
        'reversal_of': reversal_of,
        'direction': direction,
        'status': PayableAdjustmentStatus.POSTED,
        'amount': amount,
        'currency': getattr(payable, 'currency', 'VND') or 'VND',
        'exchange_rate': getattr(payable, 'exchange_rate', Decimal('1')) or Decimal('1'),
        'reason': str(reason or '').strip(),
        'note': str(note or '').strip(),
        'posted_at': timezone.now(),
        'posted_by': actor,
        'created_by': actor,
    }
    adjustment, created = PayableAdjustment.objects.select_for_update().get_or_create(
        idempotency_key=str(idempotency_key),
        defaults=defaults,
    )
    if not created:
        mismatches = []
        for field in ('payable_id', 'direction', 'amount'):
            expected = getattr(defaults['payable'], 'id', None) if field == 'payable_id' else defaults[field]
            actual = getattr(adjustment, field)
            if str(actual) != str(expected):
                mismatches.append(field)
        if mismatches:
            raise ValueError('Khóa chống ghi trùng công nợ đã được dùng cho dữ liệu khác.')
    refresh_payable_status(payable, actor=actor)
    return adjustment


def ensure_system_transaction_category(*, code: str, name: str, category_type: str, color: str):
    category, _ = TransactionCategory.objects.update_or_create(
        code=code,
        defaults={
            'name': name,
            'category_type': category_type,
            'color': color,
            'is_system': True,
            'is_active': True,
            'note': 'Tự động tạo từ cầu nối công nợ.',
        },
    )
    return category


def build_receivable_from_sales_order(order, *, actor=None):
    customer = getattr(order, 'customer', None)
    posted_snapshot = getattr(order, 'posted_snapshot', None) or {}
    customer_snapshot = build_customer_snapshot(customer)
    if not customer_snapshot and isinstance(posted_snapshot, dict):
        customer_snapshot = dict(posted_snapshot.get('customer') or {})

    document_date = getattr(order, 'posted_at', None)
    document_date = (document_date.date() if document_date else None) or getattr(order, 'order_date', None) or timezone.localdate()
    payment_terms_days = int(customer_snapshot.get('payment_terms_days') or getattr(customer, 'payment_terms', 0) or 0)
    due_date = document_date + timedelta(days=payment_terms_days)

    defaults = {
        'code': get_next_receivable_code(document_date),
        'document_type': 'RECEIVABLE',
        'customer': customer,
        'customer_snapshot': customer_snapshot,
        'document_date': document_date,
        'due_date': due_date,
        'currency': getattr(order, 'currency', 'VND') or 'VND',
        'exchange_rate': getattr(order, 'exchange_rate', Decimal('1')) or Decimal('1'),
        'subtotal_amount': round_money(getattr(order, 'subtotal', 0) or 0),
        'tax_amount': round_money(getattr(order, 'tax_total', 0) or 0),
        'total_amount': round_money(getattr(order, 'total', 0) or 0),
        'reference': getattr(order, 'reference', '') or getattr(order, 'code', '') or '',
        'note': f'Tự động tạo từ đơn bán {getattr(order, "code", "")}',
        'created_by': actor,
        'updated_by': actor,
    }
    with transaction.atomic():
        document, created = ReceivableDocument.objects.select_for_update().get_or_create(
            source_sales_order=order,
            defaults=defaults,
        )
        if not created and document.status != ReceivableStatus.CANCELLED:
            update_fields = []
            for field, value in defaults.items():
                if field == 'code':
                    continue
                if getattr(document, field) != value:
                    setattr(document, field, value)
                    update_fields.append(field)
            if actor is not None and getattr(document, 'updated_by_id', None) != getattr(actor, 'id', None):
                document.updated_by = actor
                update_fields.append('updated_by')
            if update_fields:
                update_fields.append('updated_at')
                document.save(update_fields=update_fields)
        refresh_receivable_status(document, actor=actor)
    return document


def build_payable_from_purchase_receipt(receipt, *, actor=None):
    purchase_order = getattr(receipt, 'purchase_order', None)
    supplier = getattr(purchase_order, 'supplier', None) if purchase_order else None
    supplier_snapshot = build_supplier_snapshot(supplier)
    document_date = getattr(receipt, 'receipt_date', None) or timezone.localdate()
    payment_terms_days = int(supplier_snapshot.get('payment_terms_days') or getattr(purchase_order, 'payment_terms_days', 0) or 0)
    due_date = document_date + timedelta(days=payment_terms_days)
    total_amount = round_money(getattr(receipt, 'total_amount', 0) or 0)

    defaults = {
        'code': get_next_payable_code(document_date),
        'document_type': 'PAYABLE',
        'supplier': supplier,
        'supplier_snapshot': supplier_snapshot,
        'document_date': document_date,
        'due_date': due_date,
        'currency': getattr(purchase_order, 'currency', 'VND') or 'VND',
        'exchange_rate': getattr(purchase_order, 'exchange_rate', Decimal('1')) or Decimal('1'),
        'subtotal_amount': total_amount,
        'tax_amount': Decimal('0'),
        'total_amount': total_amount,
        'reference': getattr(receipt, 'reference', '') or getattr(receipt, 'code', '') or '',
        'note': f'Tự động tạo từ phiếu nhập {getattr(receipt, "code", "")}',
        'created_by': actor,
        'updated_by': actor,
    }
    with transaction.atomic():
        document, created = PayableDocument.objects.select_for_update().get_or_create(
            source_purchase_receipt=receipt,
            defaults=defaults,
        )
        if not created and document.status != PayableStatus.CANCELLED:
            update_fields = []
            for field, value in defaults.items():
                if field == 'code':
                    continue
                if getattr(document, field) != value:
                    setattr(document, field, value)
                    update_fields.append(field)
            if actor is not None and getattr(document, 'updated_by_id', None) != getattr(actor, 'id', None):
                document.updated_by = actor
                update_fields.append('updated_by')
            if update_fields:
                update_fields.append('updated_at')
                document.save(update_fields=update_fields)
        refresh_payable_status(document, actor=actor)
    return document


def get_sales_order_void_blockers_from_receivable(order):
    document = ReceivableDocument.objects.filter(source_sales_order=order).first()
    if not document:
        return []
    if document.status == ReceivableStatus.CANCELLED:
        return []
    if document.settled_amount > 0:
        return ['Đơn đã phát sinh thu tiền công nợ, cần hủy/đảo thu tiền trước khi void.']
    return []


def cancel_receivable_for_sales_order(order, *, actor=None, reason=''):
    document = ReceivableDocument.objects.filter(source_sales_order=order).first()
    if not document:
        return None
    if document.settled_amount > 0:
        raise ValueError('Đơn đã phát sinh thu tiền công nợ, không thể tự động hủy phải thu.')
    if document.status != ReceivableStatus.CANCELLED:
        document.status = ReceivableStatus.CANCELLED
        if reason:
            document.note = ((document.note or '').strip() + f'\n[Huỷ tự động] {reason}').strip()
        update_fields = ['status', 'note', 'updated_at']
        if actor is not None:
            document.updated_by = actor
            update_fields.append('updated_by')
        document.save(update_fields=update_fields)
    return document


def cancel_payable_for_purchase_receipt(receipt, *, actor=None, reason=''):
    document = PayableDocument.objects.filter(source_purchase_receipt=receipt).first()
    if not document:
        return None
    if document.settled_amount > 0:
        raise ValueError('Phiếu nhập đã phát sinh thanh toán công nợ, không thể tự động hủy phải trả.')
    if document.status != PayableStatus.CANCELLED:
        document.status = PayableStatus.CANCELLED
        if reason:
            document.note = ((document.note or '').strip() + f'\n[Huỷ tự động] {reason}').strip()
        update_fields = ['status', 'note', 'updated_at']
        if actor is not None:
            document.updated_by = actor
            update_fields.append('updated_by')
        document.save(update_fields=update_fields)
    return document
