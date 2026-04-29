from collections import defaultdict
from datetime import timedelta
from decimal import Decimal

from django.db import transaction
from django.db.models import Sum
from django.utils import timezone

from inventory.services import build_stock_balance_map
from purchasing.models import PurchaseReceiptStatus
from products.models import ProductMaterialGroup, ProductMaterialTemplate
from sales.document_policy import round_qty
from sales.models import (
    SalesLineMaterialPlan,
    SalesLineMaterialPlanItem,
    SalesLineMaterialPlanStatus,
)


ORDERED_PO_STATUSES = ['SUBMITTED', 'APPROVED', 'PARTIAL_RECEIVED', 'RECEIVED']


def _group_key(item):
    return item.template_group_id or item.group_code_snapshot or item.id


def _active_group_options(group):
    return [option for option in group.options.all() if option.is_active]


def _resolve_default_option(group):
    options = _active_group_options(group)
    if not options:
        return None
    for option in options:
        if option.is_default:
            return option
    return sorted(options, key=lambda option: (option.priority_no, option.id))[0]


def _required_qty(finished_qty, qty_per_unit, waste_pct):
    base_qty = Decimal(str(finished_qty or 0)) * Decimal(str(qty_per_unit or 0))
    if waste_pct:
        base_qty *= Decimal('1') + (Decimal(str(waste_pct or 0)) / Decimal('100'))
    return round_qty(base_qty)


def _available_qty_by_product(product_ids):
    if not product_ids:
        return {}
    balances = build_stock_balance_map(product_ids=product_ids, include_reservations=True)
    available_map = defaultdict(lambda: Decimal('0'))
    for (product_id, _warehouse_id, _location_id), balance in balances.items():
        available_map[int(product_id)] += (balance['on_hand'] or Decimal('0')) - (balance['reserved'] or Decimal('0'))
    return available_map


def plan_has_valid_selection(plan):
    items = list(plan.items.all().order_by('id'))
    if not items:
        return False
    grouped = defaultdict(list)
    for item in items:
        grouped[_group_key(item)].append(item)
    for group_items in grouped.values():
        selection_rule = group_items[0].selection_rule
        selected_count = sum(1 for item in group_items if item.is_selected)
        if selection_rule == ProductMaterialGroup.RULE_ONE_OF and selected_count != 1:
            return False
        if selection_rule == ProductMaterialGroup.RULE_ALL_REQUIRED and selected_count != len(group_items):
            return False
    return True


def refresh_sales_line_material_plan_status(plan, *, actor=None):
    items = list(plan.items.all().order_by('id'))
    if not items:
        next_status = SalesLineMaterialPlanStatus.DRAFT
    elif not plan_has_valid_selection(plan):
        next_status = SalesLineMaterialPlanStatus.DRAFT
    else:
        selected_items = [item for item in items if item.is_selected]
        if selected_items and all((item.short_qty_cache or Decimal('0')) <= 0 for item in selected_items):
            next_status = SalesLineMaterialPlanStatus.READY
        elif any((item.received_qty_cache or Decimal('0')) > 0 for item in selected_items):
            next_status = SalesLineMaterialPlanStatus.PARTIAL_RECEIVED
        elif any((item.ordered_qty_cache or Decimal('0')) > 0 for item in selected_items):
            next_status = SalesLineMaterialPlanStatus.PARTIAL_ORDERED
        else:
            next_status = SalesLineMaterialPlanStatus.CONFIRMED
    update_fields = []
    if plan.status != next_status:
        plan.status = next_status
        update_fields.append('status')
    if actor is not None and next_status != SalesLineMaterialPlanStatus.DRAFT:
        plan.confirmed_by = actor
        plan.confirmed_at = timezone.now()
        update_fields.extend(['confirmed_by', 'confirmed_at'])
    if update_fields:
        update_fields.append('updated_at')
        plan.save(update_fields=update_fields)
    return plan


def refresh_sales_line_material_plan_item_caches(plan_item_ids):
    from purchasing.models import (
        PurchaseOrderLineMaterialAllocation,
        PurchaseReceiptLineMaterialAllocation,
        PurchaseReceiptStatus,
    )

    plan_item_ids = [int(item_id) for item_id in plan_item_ids or []]
    if not plan_item_ids:
        return []
    items = list(
        SalesLineMaterialPlanItem.objects.select_related('plan', 'material_product')
        .filter(id__in=plan_item_ids)
    )
    if not items:
        return []

    ordered_map = {
        row['plan_item']: row['total'] or Decimal('0')
        for row in (
            PurchaseOrderLineMaterialAllocation.objects
            .filter(
                plan_item_id__in=plan_item_ids,
                purchase_order_line__purchase_order__status__in=ORDERED_PO_STATUSES,
            )
            .values('plan_item')
            .annotate(total=Sum('allocated_qty'))
        )
    }
    received_map = {
        row['plan_item']: row['total'] or Decimal('0')
        for row in (
            PurchaseReceiptLineMaterialAllocation.objects
            .filter(
                plan_item_id__in=plan_item_ids,
                purchase_receipt_line__receipt__status=PurchaseReceiptStatus.POSTED,
            )
            .values('plan_item')
            .annotate(total=Sum('allocated_qty'))
        )
    }
    available_map = _available_qty_by_product([item.material_product_id for item in items])

    changed_plan_ids = set()
    for item in items:
        available_qty = round_qty(available_map.get(item.material_product_id, Decimal('0')))
        short_qty = item.required_qty - available_qty
        if short_qty < 0:
            short_qty = Decimal('0')
        changed_fields = []
        next_values = {
            'ordered_qty_cache': round_qty(ordered_map.get(item.id, Decimal('0'))),
            'received_qty_cache': round_qty(received_map.get(item.id, Decimal('0'))),
            'available_qty_cache': available_qty,
            'short_qty_cache': round_qty(short_qty),
        }
        for field_name, next_value in next_values.items():
            if getattr(item, field_name) != next_value:
                setattr(item, field_name, next_value)
                changed_fields.append(field_name)
        if changed_fields:
            changed_fields.append('updated_at')
            item.save(update_fields=changed_fields)
        changed_plan_ids.add(item.plan_id)

    for plan in SalesLineMaterialPlan.objects.filter(id__in=changed_plan_ids):
        refresh_sales_line_material_plan_status(plan)
    return items


def refresh_sales_line_material_plan_caches(plan, *, actor=None):
    item_ids = list(plan.items.values_list('id', flat=True))
    refresh_sales_line_material_plan_item_caches(item_ids)
    refresh_sales_line_material_plan_status(plan, actor=actor)
    return plan


@transaction.atomic
def sync_sales_line_material_plan_for_line(line, *, actor=None):
    if not getattr(line, 'product_id', None):
        SalesLineMaterialPlan.objects.filter(sales_order_line=line).delete()
        return None

    template = ProductMaterialTemplate.resolve_for_product(line.product, as_of_date=getattr(line.sales_order, 'order_date', None))
    if template is None:
        SalesLineMaterialPlan.objects.filter(sales_order_line=line).delete()
        return None

    plan, _created = SalesLineMaterialPlan.objects.get_or_create(
        sales_order_line=line,
        defaults={
            'sales_order': line.sales_order,
            'finished_product': line.product,
            'template': template,
            'ordered_finished_qty': round_qty(line.qty),
        },
    )
    plan.sales_order = line.sales_order
    plan.finished_product = line.product
    plan.template = template
    plan.ordered_finished_qty = round_qty(line.qty)
    plan.save(update_fields=['sales_order', 'finished_product', 'template', 'ordered_finished_qty', 'updated_at'])

    existing_item_ids = list(plan.items.values_list('id', flat=True))
    if existing_item_ids:
        plan.items.all().delete()

    groups = list(
        template.groups.prefetch_related(
            'options',
            'options__material_product',
            'options__material_product__unit',
        ).order_by('sort_order', 'id')
    )
    plan_items = []
    for group in groups:
        default_option = _resolve_default_option(group)
        for option in _active_group_options(group):
            is_selected = group.selection_rule == ProductMaterialGroup.RULE_ALL_REQUIRED
            if group.selection_rule == ProductMaterialGroup.RULE_ONE_OF and default_option is not None:
                is_selected = option.id == default_option.id
            plan_items.append(
                SalesLineMaterialPlanItem(
                    plan=plan,
                    template_group=group,
                    template_option=option,
                    group_code_snapshot=group.group_code,
                    group_name_snapshot=group.group_name,
                    material_role=group.material_role,
                    selection_rule=group.selection_rule,
                    material_product=option.material_product,
                    spec_snapshot=option.spec_snapshot or {},
                    is_selected=is_selected,
                    required_qty=_required_qty(line.qty, option.qty_per_unit, option.waste_pct),
                    ordered_qty_cache=Decimal('0'),
                    received_qty_cache=Decimal('0'),
                    available_qty_cache=Decimal('0'),
                    short_qty_cache=Decimal('0'),
                    note=option.note or '',
                )
            )
    SalesLineMaterialPlanItem.objects.bulk_create(plan_items)
    refresh_sales_line_material_plan_caches(plan, actor=actor)
    return plan


@transaction.atomic
def set_sales_line_material_plan_selection(plan, *, selected_item_ids, actor=None):
    selected_item_ids = {int(item_id) for item_id in (selected_item_ids or [])}
    items = list(plan.items.all().order_by('id'))
    if not items:
        raise ValueError('Plan vat tu chua co dong du lieu.')
    allowed_item_ids = {item.id for item in items}
    invalid_item_ids = selected_item_ids - allowed_item_ids
    if invalid_item_ids:
        raise ValueError('Co lua chon vat tu khong thuoc plan hien tai.')

    grouped = defaultdict(list)
    for item in items:
        grouped[_group_key(item)].append(item)

    for group_items in grouped.values():
        selection_rule = group_items[0].selection_rule
        selected_count = sum(1 for item in group_items if item.id in selected_item_ids)
        if selection_rule == ProductMaterialGroup.RULE_ONE_OF and selected_count != 1:
            raise ValueError(f"Nhom {group_items[0].group_code_snapshot} phai chon dung 1 vat tu.")
        if selection_rule == ProductMaterialGroup.RULE_ALL_REQUIRED and selected_count != len(group_items):
            raise ValueError(f"Nhom {group_items[0].group_code_snapshot} bat buoc chon tat ca vat tu.")

    changed_ids = []
    for item in items:
        is_selected = item.id in selected_item_ids
        if item.is_selected != is_selected:
            item.is_selected = is_selected
            item.save(update_fields=['is_selected', 'updated_at'])
        changed_ids.append(item.id)

    refresh_sales_line_material_plan_item_caches(changed_ids)
    refresh_sales_line_material_plan_status(plan, actor=actor)
    return plan


def auto_allocate_receipt_line_to_plan_items(receipt_line):
    from purchasing.models import (
        PurchaseOrderLineMaterialAllocation,
        PurchaseReceiptLineMaterialAllocation,
    )

    if not getattr(receipt_line, 'purchase_order_line_id', None):
        return []

    po_allocations = list(
        PurchaseOrderLineMaterialAllocation.objects.filter(
            purchase_order_line_id=receipt_line.purchase_order_line_id,
        ).select_related('plan_item')
    )
    if not po_allocations:
        return []

    total_allocated = sum((allocation.allocated_qty or Decimal('0') for allocation in po_allocations), Decimal('0'))
    if total_allocated <= 0:
        return []

    created_rows = []
    remaining_qty = Decimal(str(receipt_line.quantity or 0))
    for index, allocation in enumerate(po_allocations, start=1):
        if index == len(po_allocations):
            allocated_qty = round_qty(remaining_qty)
        else:
            allocated_qty = round_qty(
                Decimal(str(receipt_line.quantity or 0))
                * Decimal(str(allocation.allocated_qty or 0))
                / total_allocated
            )
            remaining_qty -= allocated_qty
        created_rows.append(
            PurchaseReceiptLineMaterialAllocation(
                purchase_receipt_line=receipt_line,
                plan_item=allocation.plan_item,
                allocated_qty=allocated_qty,
                note=allocation.note or '',
            )
        )
    PurchaseReceiptLineMaterialAllocation.objects.bulk_create(created_rows)
    refresh_sales_line_material_plan_item_caches([row.plan_item_id for row in created_rows])
    return created_rows


def _serialize_delivery_plans(line, today):
    plans = [
        {
            'id': plan.id,
            'delivery_date': plan.delivery_date.isoformat(),
            'qty': str(plan.qty or 0),
            'shipped_qty': str(plan.shipped_qty or 0),
            'delivered_qty': str(plan.delivered_qty or 0),
            'remaining_qty': str(plan.remaining_qty or 0),
            'remaining_shipment_qty': str(plan.remaining_shipment_qty or 0),
            'is_completed': bool(plan.is_completed),
            'is_overdue': bool(plan.remaining_qty > 0 and plan.delivery_date < today),
            'is_due_today': bool(plan.remaining_qty > 0 and plan.delivery_date == today),
            'is_due_soon': bool(plan.remaining_qty > 0 and today <= plan.delivery_date <= (today + timedelta(days=3))),
            'planned_carrier_name': plan.planned_carrier_name or '',
            'delivery_rule': plan.delivery_rule,
            'note': plan.note or '',
        }
        for plan in line.delivery_plans.all().order_by('delivery_date', 'id')
    ]
    if not plans and getattr(line.sales_order, 'delivery_date', None):
        header_date = line.sales_order.delivery_date
        qty = round_qty(line.qty or 0)
        plans = [{
            'id': None,
            'delivery_date': header_date.isoformat(),
            'qty': str(qty),
            'shipped_qty': '0.0000',
            'delivered_qty': '0.0000',
            'remaining_qty': str(qty),
            'remaining_shipment_qty': str(qty),
            'is_completed': False,
            'is_overdue': bool(header_date < today),
            'is_due_today': bool(header_date == today),
            'is_due_soon': bool(today <= header_date <= (today + timedelta(days=3))),
            'note': '[HEADER-DELIVERY]',
        }]
    delivered_total = sum((Decimal(plan['delivered_qty']) for plan in plans), Decimal('0'))
    remaining_total = sum((Decimal(plan['remaining_qty']) for plan in plans), Decimal('0'))
    overdue_count = sum(1 for plan in plans if plan['is_overdue'])
    due_soon_count = sum(1 for plan in plans if plan['is_due_soon'])
    next_delivery_date = plans[0]['delivery_date'] if plans else None
    return plans, {
        'delivery_count': len(plans),
        'overdue_count': overdue_count,
        'due_soon_count': due_soon_count,
        'next_delivery_date': next_delivery_date,
        'delivered_qty_total': str(round_qty(delivered_total)),
        'remaining_qty_total': str(round_qty(remaining_total)),
    }


def _serialize_production_summary(line):
    production_orders = list(line.production_orders.all().order_by('order_date', 'id'))
    operation_rollups = {}
    order_payloads = []
    total_planned = Decimal('0')
    total_produced = Decimal('0')
    total_remaining = Decimal('0')
    total_scrap = Decimal('0')
    active_order_count = 0

    for order in production_orders:
        planned_qty = Decimal(str(order.planned_qty or 0))
        produced_qty = Decimal(str(order.produced_qty or 0))
        remaining_qty = Decimal(str(order.remaining_qty or 0))
        scrap_qty = Decimal(str(order.scrap_qty or 0))
        total_planned += planned_qty
        total_produced += produced_qty
        total_remaining += remaining_qty
        total_scrap += scrap_qty
        if order.status in {'APPROVED', 'RELEASED', 'IN_PROGRESS'}:
            active_order_count += 1
        order_payloads.append({
            'id': order.id,
            'code': order.code,
            'status': order.status,
            'order_date': order.order_date.isoformat(),
            'planned_start_date': order.planned_start_date.isoformat() if order.planned_start_date else None,
            'planned_end_date': order.planned_end_date.isoformat() if order.planned_end_date else None,
            'planned_qty': str(order.planned_qty or 0),
            'produced_qty': str(order.produced_qty or 0),
            'remaining_qty': str(order.remaining_qty or 0),
            'scrap_qty': str(order.scrap_qty or 0),
        })
        for operation in order.operations.all().order_by('sequence'):
            key = operation.step_code or f'SEQ-{operation.sequence}'
            if key not in operation_rollups:
                operation_rollups[key] = {
                    'step_code': operation.step_code,
                    'step_name': operation.step_name,
                    'planned_qty': Decimal('0'),
                    'completed_qty': Decimal('0'),
                    'scrap_qty': Decimal('0'),
                    'order_count': 0,
                    'done_order_count': 0,
                    'in_progress_order_count': 0,
                    'ready_order_count': 0,
                }
            bucket = operation_rollups[key]
            bucket['planned_qty'] += Decimal(str(operation.planned_qty or 0))
            bucket['completed_qty'] += Decimal(str(operation.completed_qty or 0))
            bucket['scrap_qty'] += Decimal(str(operation.scrap_qty or 0))
            bucket['order_count'] += 1
            if operation.status == 'DONE':
                bucket['done_order_count'] += 1
            if operation.status == 'IN_PROGRESS':
                bucket['in_progress_order_count'] += 1
            if operation.status == 'READY':
                bucket['ready_order_count'] += 1

    operation_payloads = [
        {
            'step_code': bucket['step_code'],
            'step_name': bucket['step_name'],
            'planned_qty': str(round_qty(bucket['planned_qty'])),
            'completed_qty': str(round_qty(bucket['completed_qty'])),
            'scrap_qty': str(round_qty(bucket['scrap_qty'])),
            'order_count': bucket['order_count'],
            'done_order_count': bucket['done_order_count'],
            'in_progress_order_count': bucket['in_progress_order_count'],
            'ready_order_count': bucket['ready_order_count'],
        }
        for bucket in operation_rollups.values()
    ]
    return {
        'order_count': len(production_orders),
        'active_order_count': active_order_count,
        'total_planned_qty': str(round_qty(total_planned)),
        'total_produced_qty': str(round_qty(total_produced)),
        'total_remaining_qty': str(round_qty(total_remaining)),
        'total_scrap_qty': str(round_qty(total_scrap)),
        'orders': order_payloads,
        'operations': operation_payloads,
    }


def _serialize_material_groups(plan):
    from purchasing.models import PurchaseOrderStatus, PurchaseRequestStatus

    grouped = defaultdict(lambda: {
        'group_code': '',
        'group_name': '',
        'selection_rule': '',
        'material_role': '',
        'include_in_summary': True,
        'selected_item_ids': [],
        'items': [],
    })

    for item in plan.items.all().order_by('template_group__sort_order', 'group_code_snapshot', 'id'):
        key = _group_key(item)
        group = grouped[key]
        group['group_code'] = item.group_code_snapshot
        group['group_name'] = item.group_name_snapshot
        group['selection_rule'] = item.selection_rule
        group['material_role'] = item.material_role
        group['include_in_summary'] = getattr(item.template_group, 'include_in_summary', True)
        request_qty_total = Decimal('0')
        open_request_qty = Decimal('0')
        approved_request_qty = Decimal('0')
        draft_request_qty = Decimal('0')
        submitted_request_qty = Decimal('0')
        latest_request = None
        purchase_request_codes = []
        request_ids = set()
        request_line_count = 0
        purchase_order_qty_total = Decimal('0')
        active_purchase_order_qty = Decimal('0')
        purchase_order_codes = []
        purchase_order_ids = set()
        purchase_order_line_count = 0
        latest_purchase_order = None
        purchase_receipt_line_count = 0
        purchase_receipt_qty_total = Decimal('0')
        purchase_receipt_codes = []
        purchase_receipt_ids = set()
        latest_purchase_receipt = None
        for request_line in item.purchase_request_lines.all():
            request = getattr(request_line, 'purchase_request', None)
            if request is None:
                continue
            request_line_count += 1
            request_ids.add(request.id)
            qty = Decimal(str(request_line.qty or 0))
            request_qty_total += qty
            if request.status != PurchaseRequestStatus.REJECTED:
                open_request_qty += qty
            if request.status == PurchaseRequestStatus.APPROVED:
                approved_request_qty += qty
            elif request.status == PurchaseRequestStatus.DRAFT:
                draft_request_qty += qty
            elif request.status == PurchaseRequestStatus.SUBMITTED:
                submitted_request_qty += qty
            if request.code and request.code not in purchase_request_codes:
                purchase_request_codes.append(request.code)
            request_marker = (
                getattr(request, 'request_date', None),
                int(getattr(request, 'id', 0) or 0),
                int(getattr(request_line, 'id', 0) or 0),
            )
            if latest_request is None or request_marker > latest_request[0]:
                latest_request = (request_marker, request)
            for purchase_order_line in request_line.purchase_order_lines.all():
                purchase_order = getattr(purchase_order_line, 'purchase_order', None)
                if purchase_order is None:
                    continue
                purchase_order_line_count += 1
                purchase_order_ids.add(purchase_order.id)
                line_qty = Decimal(str(purchase_order_line.qty or 0))
                purchase_order_qty_total += line_qty
                if purchase_order.status not in {PurchaseOrderStatus.REJECTED, PurchaseOrderStatus.CANCELLED}:
                    active_purchase_order_qty += line_qty
                    if purchase_order.code and purchase_order.code not in purchase_order_codes:
                        purchase_order_codes.append(purchase_order.code)
                purchase_order_marker = (
                    getattr(purchase_order, 'order_date', None),
                    int(getattr(purchase_order, 'id', 0) or 0),
                    int(getattr(purchase_order_line, 'id', 0) or 0),
                )
                if latest_purchase_order is None or purchase_order_marker > latest_purchase_order[0]:
                    latest_purchase_order = (purchase_order_marker, purchase_order)
                for receipt_line in purchase_order_line.receipt_lines.all():
                    receipt = getattr(receipt_line, 'receipt', None)
                    if receipt is None or receipt.status != PurchaseReceiptStatus.POSTED:
                        continue
                    purchase_receipt_line_count += 1
                    purchase_receipt_ids.add(receipt.id)
                    receipt_qty = Decimal(str(receipt_line.quantity or 0))
                    purchase_receipt_qty_total += receipt_qty
                    if receipt.code and receipt.code not in purchase_receipt_codes:
                        purchase_receipt_codes.append(receipt.code)
                    purchase_receipt_marker = (
                        getattr(receipt, 'receipt_date', None),
                        int(getattr(receipt, 'id', 0) or 0),
                        int(getattr(receipt_line, 'id', 0) or 0),
                    )
                    if latest_purchase_receipt is None or purchase_receipt_marker > latest_purchase_receipt[0]:
                        latest_purchase_receipt = (purchase_receipt_marker, receipt)
        item_payload = {
            'id': item.id,
            'material_product_id': item.material_product_id,
            'material_product_code': item.material_product.code,
            'material_product_name': item.material_product.name,
            'material_product_unit_name': getattr(getattr(item.material_product, 'unit', None), 'name', None),
            'is_selected': bool(item.is_selected),
            'required_qty': str(item.required_qty or 0),
            'ordered_qty_cache': str(item.ordered_qty_cache or 0),
            'received_qty_cache': str(item.received_qty_cache or 0),
            'available_qty_cache': str(item.available_qty_cache or 0),
            'short_qty_cache': str(item.short_qty_cache or 0),
            'purchase_request_line_count': request_line_count,
            'purchase_request_count': len(request_ids),
            'purchase_request_qty_total': str(round_qty(request_qty_total)),
            'open_purchase_request_qty': str(round_qty(open_request_qty)),
            'approved_purchase_request_qty': str(round_qty(approved_request_qty)),
            'draft_purchase_request_qty': str(round_qty(draft_request_qty)),
            'submitted_purchase_request_qty': str(round_qty(submitted_request_qty)),
            'purchase_request_codes': purchase_request_codes,
            'latest_purchase_request_id': latest_request[1].id if latest_request else None,
            'latest_purchase_request_code': latest_request[1].code if latest_request else None,
            'latest_purchase_request_status': latest_request[1].status if latest_request else None,
            'latest_purchase_request_date': latest_request[1].request_date.isoformat() if latest_request and latest_request[1].request_date else None,
            'purchase_order_line_count': purchase_order_line_count,
            'purchase_order_count': len(purchase_order_ids),
            'purchase_order_qty_total': str(round_qty(purchase_order_qty_total)),
            'active_purchase_order_qty': str(round_qty(active_purchase_order_qty)),
            'purchase_order_codes': purchase_order_codes,
            'latest_purchase_order_id': latest_purchase_order[1].id if latest_purchase_order else None,
            'latest_purchase_order_code': latest_purchase_order[1].code if latest_purchase_order else None,
            'latest_purchase_order_status': latest_purchase_order[1].status if latest_purchase_order else None,
            'latest_purchase_order_date': latest_purchase_order[1].order_date.isoformat() if latest_purchase_order and latest_purchase_order[1].order_date else None,
            'purchase_receipt_line_count': purchase_receipt_line_count,
            'purchase_receipt_count': len(purchase_receipt_ids),
            'purchase_receipt_qty_total': str(round_qty(purchase_receipt_qty_total)),
            'purchase_receipt_codes': purchase_receipt_codes,
            'latest_purchase_receipt_id': latest_purchase_receipt[1].id if latest_purchase_receipt else None,
            'latest_purchase_receipt_code': latest_purchase_receipt[1].code if latest_purchase_receipt else None,
            'latest_purchase_receipt_status': latest_purchase_receipt[1].status if latest_purchase_receipt else None,
            'latest_purchase_receipt_date': latest_purchase_receipt[1].receipt_date.isoformat() if latest_purchase_receipt and latest_purchase_receipt[1].receipt_date else None,
            'spec_snapshot': item.spec_snapshot or {},
            'note': item.note or '',
        }
        if item.is_selected:
            group['selected_item_ids'].append(item.id)
        group['items'].append(item_payload)

    groups = list(grouped.values())
    selected_primary_items = [
        item
        for group in groups
        if group['material_role'] == ProductMaterialGroup.ROLE_PRIMARY and group['include_in_summary']
        for item in group['items']
        if item['is_selected']
    ]
    shortage_count = sum(1 for item in selected_primary_items if Decimal(item['short_qty_cache']) > 0)
    ready_count = sum(1 for item in selected_primary_items if Decimal(item['short_qty_cache']) <= 0)
    purchase_request_line_count = sum(int(item['purchase_request_line_count']) for item in selected_primary_items)
    purchase_request_count = sum(int(item['purchase_request_count']) for item in selected_primary_items)
    purchase_request_qty_total = sum((Decimal(item['purchase_request_qty_total']) for item in selected_primary_items), Decimal('0'))
    open_purchase_request_qty = sum((Decimal(item['open_purchase_request_qty']) for item in selected_primary_items), Decimal('0'))
    approved_purchase_request_qty = sum((Decimal(item['approved_purchase_request_qty']) for item in selected_primary_items), Decimal('0'))
    purchase_order_line_count = sum(int(item['purchase_order_line_count']) for item in selected_primary_items)
    purchase_order_count = sum(int(item['purchase_order_count']) for item in selected_primary_items)
    purchase_order_qty_total = sum((Decimal(item['purchase_order_qty_total']) for item in selected_primary_items), Decimal('0'))
    active_purchase_order_qty = sum((Decimal(item['active_purchase_order_qty']) for item in selected_primary_items), Decimal('0'))
    purchase_receipt_line_count = sum(int(item['purchase_receipt_line_count']) for item in selected_primary_items)
    purchase_receipt_count = sum(int(item['purchase_receipt_count']) for item in selected_primary_items)
    purchase_receipt_qty_total = sum((Decimal(item['purchase_receipt_qty_total']) for item in selected_primary_items), Decimal('0'))
    return groups, {
        'selected_primary_material_count': len(selected_primary_items),
        'shortage_count': shortage_count,
        'ready_count': ready_count,
        'purchase_request_line_count': purchase_request_line_count,
        'purchase_request_count': purchase_request_count,
        'purchase_request_qty_total': str(round_qty(purchase_request_qty_total)),
        'open_purchase_request_qty': str(round_qty(open_purchase_request_qty)),
        'approved_purchase_request_qty': str(round_qty(approved_purchase_request_qty)),
        'purchase_order_line_count': purchase_order_line_count,
        'purchase_order_count': purchase_order_count,
        'purchase_order_qty_total': str(round_qty(purchase_order_qty_total)),
        'active_purchase_order_qty': str(round_qty(active_purchase_order_qty)),
        'purchase_receipt_line_count': purchase_receipt_line_count,
        'purchase_receipt_count': purchase_receipt_count,
        'purchase_receipt_qty_total': str(round_qty(purchase_receipt_qty_total)),
        'selected_primary_items': selected_primary_items,
    }


def build_sales_material_command_center_row(plan, *, today=None):
    today = today or timezone.localdate()
    delivery_plans, delivery_summary = _serialize_delivery_plans(plan.sales_order_line, today)
    production_summary = _serialize_production_summary(plan.sales_order_line)
    material_groups, material_summary = _serialize_material_groups(plan)
    ordered_finished_qty = Decimal(str(plan.ordered_finished_qty or 0))
    produced_qty = Decimal(str(production_summary['total_produced_qty'] or 0))
    has_overdue_delivery = delivery_summary['overdue_count'] > 0
    has_shortage = material_summary['shortage_count'] > 0

    if has_overdue_delivery:
        attention_status = 'OVERDUE'
    elif has_shortage:
        attention_status = 'MATERIAL_SHORTAGE'
    elif delivery_summary['due_soon_count'] > 0:
        attention_status = 'DUE_SOON'
    else:
        attention_status = 'ON_TRACK'

    return {
        'id': plan.id,
        'plan_id': plan.id,
        'status': plan.status,
        'plan_status': plan.status,
        'sales_order_id': plan.sales_order_id,
        'sales_order_code': plan.sales_order.code,
        'sales_order_status': plan.sales_order.status,
        'sales_order_line_id': plan.sales_order_line_id,
        'sales_order_line_number': plan.sales_order_line.line_number,
        'customer_id': plan.sales_order.customer_id,
        'customer_name': getattr(getattr(plan.sales_order, 'customer', None), 'name', None),
        'finished_product_id': plan.finished_product_id,
        'finished_product_code': plan.finished_product.code,
        'finished_product_name': plan.finished_product.name,
        'ordered_finished_qty': str(plan.ordered_finished_qty or 0),
        'confirmed_at': plan.confirmed_at.isoformat() if plan.confirmed_at else None,
        'delivery_plans': delivery_plans,
        'delivery_summary': delivery_summary,
        'production': production_summary,
        'production_summary': production_summary,
        'material_groups': material_groups,
        'material_summary': material_summary,
        'has_overdue_delivery': has_overdue_delivery,
        'has_shortage': has_shortage,
        'ready_for_delivery': bool(not has_shortage and produced_qty >= ordered_finished_qty),
        'attention_status': attention_status,
    }


def summarize_sales_material_command_center(rows):
    total_order_qty = Decimal('0')
    total_produced_qty = Decimal('0')
    overdue_delivery_count = 0
    due_soon_count = 0
    shortage_count = 0
    ready_count = 0

    for row in rows:
        total_order_qty += Decimal(str(row.get('ordered_finished_qty') or 0))
        total_produced_qty += Decimal(str((row.get('production') or {}).get('total_produced_qty') or 0))
        if row.get('has_overdue_delivery'):
            overdue_delivery_count += 1
        if ((row.get('delivery_summary') or {}).get('due_soon_count') or 0) > 0:
            due_soon_count += 1
        if row.get('has_shortage'):
            shortage_count += 1
        if row.get('ready_for_delivery'):
            ready_count += 1

    return {
        'total_lines': len(rows),
        'overdue_delivery_count': overdue_delivery_count,
        'due_soon_count': due_soon_count,
        'shortage_count': shortage_count,
        'ready_count': ready_count,
        'total_order_qty': str(round_qty(total_order_qty)),
        'total_produced_qty': str(round_qty(total_produced_qty)),
    }
