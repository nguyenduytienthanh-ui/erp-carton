from decimal import Decimal

from sales.document_policy import round_qty
from sales.models import PeriodSequence

from purchasing.models import PurchaseOrderStatus, PurchaseRequestSequence


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
