import calendar
import time
from datetime import date, datetime, time as time_value, timedelta
from decimal import Decimal

from django.db.models import Count, Sum
from django.utils import timezone

from core.models import AuditLog, CustomReportDefinition, CustomReportRun
from finance.models import CashTransaction, PayableDocument, ReceivableDocument
from inventory.services import build_stock_balance_map
from products.models import Product
from production.models import ProductionIssue, ProductionOrder, ProductionReceipt
from purchasing.models import PurchaseOrder, PurchaseReceipt
from sales.models import SalesOrder, SalesOrderLine
from workforce.models import AttendanceRecord, BonusPenaltyRecord, PayrollRecord


BUILTIN_REPORTS = [
    {
        'code': 'SALES_SUMMARY',
        'name': 'Tong hop ban hang',
        'report_type': CustomReportDefinition.TYPE_SALES,
        'description': 'Tong hop doanh thu, don hang va top khach hang theo ky.',
        'status': CustomReportDefinition.STATUS_FINALIZED,
    },
    {
        'code': 'PURCHASE_SUMMARY',
        'name': 'Tong hop mua hang',
        'report_type': CustomReportDefinition.TYPE_PURCHASE,
        'description': 'Tong hop don mua, gia tri mua va tinh trang nhan hang.',
        'status': CustomReportDefinition.STATUS_FINALIZED,
    },
    {
        'code': 'INVENTORY_HEALTH',
        'name': 'Suc khoe ton kho',
        'report_type': CustomReportDefinition.TYPE_INVENTORY,
        'description': 'Tong hop ton kho hien tai, canh bao duoi min stock va gia tri ton.',
        'status': CustomReportDefinition.STATUS_GENERATED,
    },
    {
        'code': 'AUDIT_TRAIL',
        'name': 'Nhat ky hoat dong',
        'report_type': CustomReportDefinition.TYPE_FINANCIAL,
        'description': 'Tong hop nhat ky tac dong tren he thong.',
        'status': CustomReportDefinition.STATUS_GENERATED,
    },
    {
        'code': 'PRODUCTION_COSTING',
        'name': 'Gia von thuc te sau san xuat',
        'report_type': CustomReportDefinition.TYPE_PRODUCTION,
        'description': 'So sanh chi phi uoc tinh va thuc te theo lenh san xuat.',
        'status': CustomReportDefinition.STATUS_GENERATED,
    },
    {
        'code': 'PROFIT_REPORT',
        'name': 'Bao cao loi nhuan gop',
        'report_type': CustomReportDefinition.TYPE_FINANCIAL,
        'description': 'Tong hop doanh thu, gia von va bien loi nhuan gop theo don hang.',
        'status': CustomReportDefinition.STATUS_GENERATED,
    },
    {
        'code': 'EMPLOYEE_PERFORMANCE',
        'name': 'Danh gia nhan vien theo dinh muc',
        'report_type': CustomReportDefinition.TYPE_WORKFORCE,
        'description': 'Tong hop cham cong, tang ca va diem hieu suat theo thang.',
        'status': CustomReportDefinition.STATUS_GENERATED,
    },
]


def ensure_builtin_custom_reports():
    reports = []
    for item in BUILTIN_REPORTS:
        report, _created = CustomReportDefinition.objects.update_or_create(
            code=item['code'],
            defaults={
                'name': item['name'],
                'report_type': item['report_type'],
                'description': item['description'],
                'status': item['status'],
                'is_system': True,
            },
        )
        reports.append(report)
    return reports


def _parse_date(value, default_value):
    if value in (None, ''):
        return default_value
    if isinstance(value, date):
        return value
    return datetime.fromisoformat(str(value).strip()[:10]).date()


def _json_ready(value):
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if isinstance(value, list):
        return [_json_ready(item) for item in value]
    if isinstance(value, dict):
        return {key: _json_ready(item) for key, item in value.items()}
    return value


def _trim_result_for_storage(result, max_rows=100):
    storage_payload = _json_ready(result)
    rows = storage_payload.get('rows')
    if isinstance(rows, list) and len(rows) > max_rows:
        storage_payload['rows'] = rows[:max_rows]
        storage_payload['rows_truncated'] = True
        storage_payload['stored_row_count'] = len(rows[:max_rows])
    return storage_payload


def _result_row_count(result):
    rows = result.get('rows')
    if isinstance(rows, list):
        return len(rows)
    latest_items = result.get('latest_items')
    if isinstance(latest_items, list):
        return len(latest_items)
    return int(result.get('count') or 0)


def _result_summary(result):
    summary = result.get('summary')
    if isinstance(summary, dict):
        return _json_ready(summary)
    count = result.get('count')
    if count is not None:
        return {'count': count}
    return {}


def _get_next_month(year, month):
    if month == 12:
        return year + 1, 1
    return year, month + 1


def compute_next_schedule_run(report, now=None):
    now = timezone.localtime(now or timezone.now())
    schedule_time = report.schedule_time or time_value(hour=8, minute=0)
    timezone_info = timezone.get_current_timezone()

    def combine(run_date):
        naive = datetime.combine(run_date, schedule_time)
        return timezone.make_aware(naive, timezone_info)

    if report.schedule_frequency == CustomReportDefinition.SCHEDULE_DAILY:
        candidate = combine(now.date())
        if candidate <= now:
            candidate = combine(now.date() + timedelta(days=1))
        return candidate

    if report.schedule_frequency == CustomReportDefinition.SCHEDULE_WEEKLY:
        target_day = int(report.schedule_day_of_week if report.schedule_day_of_week is not None else now.weekday())
        days_until = (target_day - now.weekday()) % 7
        candidate = combine(now.date() + timedelta(days=days_until))
        if candidate <= now:
            candidate = candidate + timedelta(days=7)
        return candidate

    if report.schedule_frequency == CustomReportDefinition.SCHEDULE_MONTHLY:
        target_day = int(report.schedule_day_of_month or now.day)
        target_day = max(1, min(target_day, 31))
        last_day_this_month = calendar.monthrange(now.year, now.month)[1]
        candidate_date = date(now.year, now.month, min(target_day, last_day_this_month))
        candidate = combine(candidate_date)
        if candidate <= now:
            next_year, next_month = _get_next_month(now.year, now.month)
            last_day_next_month = calendar.monthrange(next_year, next_month)[1]
            candidate = combine(date(next_year, next_month, min(target_day, last_day_next_month)))
        return candidate

    return None


def sync_custom_report_schedule(report):
    try:
        from django_q.models import Schedule
    except Exception:
        report.schedule_name = ''
        report.next_run_at = None
        report.save(update_fields=['schedule_name', 'next_run_at', 'updated_at'])
        return {'schedule_available': False, 'schedule_id': None, 'next_run': None}

    if not report.schedule_enabled or report.schedule_frequency == CustomReportDefinition.SCHEDULE_NONE:
        if report.schedule_name:
            Schedule.objects.filter(name=report.schedule_name).delete()
        report.schedule_name = ''
        report.next_run_at = None
        report.save(update_fields=['schedule_name', 'next_run_at', 'updated_at'])
        return {'schedule_available': True, 'schedule_id': None, 'next_run': None}

    schedule_type_map = {
        CustomReportDefinition.SCHEDULE_DAILY: Schedule.DAILY,
        CustomReportDefinition.SCHEDULE_WEEKLY: Schedule.WEEKLY,
        CustomReportDefinition.SCHEDULE_MONTHLY: Schedule.MONTHLY,
    }
    schedule_name = report.schedule_name or f'CUSTOM_REPORT_{report.id}_{report.code}'
    next_run = compute_next_schedule_run(report)
    schedule, _created = Schedule.objects.get_or_create(
        name=schedule_name,
        defaults={
            'func': 'phase5_reports.run_scheduled_custom_report_job',
            'args': str(report.id),
            'schedule_type': schedule_type_map[report.schedule_frequency],
            'repeats': -1,
            'next_run': next_run,
            'cluster': 'default',
        },
    )
    schedule.func = 'phase5_reports.run_scheduled_custom_report_job'
    schedule.args = str(report.id)
    schedule.schedule_type = schedule_type_map[report.schedule_frequency]
    schedule.repeats = -1
    schedule.next_run = next_run
    schedule.minutes = None
    schedule.cron = ''
    schedule.cluster = 'default'
    schedule.save()

    report.schedule_name = schedule.name
    report.next_run_at = schedule.next_run
    report.save(update_fields=['schedule_name', 'next_run_at', 'updated_at'])
    return {'schedule_available': True, 'schedule_id': schedule.id, 'next_run': schedule.next_run}


def _refresh_next_run_from_schedule(report):
    if not report.schedule_name:
        return
    try:
        from django_q.models import Schedule
    except Exception:
        return
    schedule = Schedule.objects.filter(name=report.schedule_name).first()
    report.next_run_at = getattr(schedule, 'next_run', None)
    report.save(update_fields=['next_run_at', 'updated_at'])


def _sales_summary(period_start, period_end, report_code):
    order_qs = (
        SalesOrder.objects
        .filter(order_date__gte=period_start, order_date__lte=period_end)
        .select_related('customer')
        .order_by('-order_date', '-id')
    )
    posted_qs = order_qs.filter(status='POSTED')
    top_customer_rows = list(
        posted_qs
        .values('customer__name')
        .annotate(total_revenue=Sum('total'), order_count=Count('id'))
        .order_by('-total_revenue')[:5]
    )
    top_product_rows = list(
        SalesOrderLine.objects.filter(
            sales_order__status='POSTED',
            sales_order__order_date__gte=period_start,
            sales_order__order_date__lte=period_end,
        )
        .values('product__code', 'product__name')
        .annotate(total_qty=Sum('qty'), total_revenue=Sum('line_total'))
        .order_by('-total_revenue')[:5]
    )
    rows = [
        {
            'order_code': order.code,
            'order_date': order.order_date.isoformat(),
            'customer_name': getattr(order.customer, 'name', '') if getattr(order, 'customer_id', None) else '',
            'status': order.status,
            'total': float(order.total or 0),
        }
        for order in order_qs[:50]
    ]
    total_revenue = Decimal(str(posted_qs.aggregate(total=Sum('total')).get('total') or 0))
    return {
        'report_code': report_code,
        'period_start': period_start.isoformat(),
        'period_end': period_end.isoformat(),
        'summary': {
            'total_orders': order_qs.count(),
            'posted_orders': posted_qs.count(),
            'total_revenue': float(total_revenue),
            'avg_posted_order_value': float((total_revenue / posted_qs.count()).quantize(Decimal('0.01'))) if posted_qs.exists() else 0,
            'top_customers': [
                {
                    'customer_name': item['customer__name'] or 'Khach le',
                    'order_count': item['order_count'],
                    'total_revenue': float(item['total_revenue'] or 0),
                }
                for item in top_customer_rows
            ],
            'top_products': [
                {
                    'product_code': item['product__code'],
                    'product_name': item['product__name'],
                    'total_qty': float(item['total_qty'] or 0),
                    'total_revenue': float(item['total_revenue'] or 0),
                }
                for item in top_product_rows
            ],
        },
        'rows': rows,
    }


def _purchase_summary(period_start, period_end, report_code):
    order_qs = (
        PurchaseOrder.objects
        .filter(order_date__gte=period_start, order_date__lte=period_end)
        .select_related('supplier')
        .order_by('-order_date', '-id')
    )
    receipt_qs = PurchaseReceipt.objects.filter(
        receipt_date__gte=period_start,
        receipt_date__lte=period_end,
        status='POSTED',
    )
    total_order_value = Decimal(str(order_qs.aggregate(total=Sum('total')).get('total') or 0))
    total_received_value = Decimal(str(receipt_qs.aggregate(total=Sum('total_amount')).get('total') or 0))
    rows = [
        {
            'order_code': order.code,
            'order_date': order.order_date.isoformat(),
            'supplier_name': order.supplier.name if order.supplier_id else '',
            'status': order.status,
            'expected_receipt_date': order.expected_receipt_date.isoformat() if order.expected_receipt_date else None,
            'total': float(order.total or 0),
        }
        for order in order_qs[:50]
    ]
    return {
        'report_code': report_code,
        'period_start': period_start.isoformat(),
        'period_end': period_end.isoformat(),
        'summary': {
            'total_orders': order_qs.count(),
            'approved_orders': order_qs.filter(status='APPROVED').count(),
            'received_orders': order_qs.filter(status='RECEIVED').count(),
            'cancelled_orders': order_qs.filter(status='CANCELLED').count(),
            'total_order_value': float(total_order_value),
            'total_received_value': float(total_received_value),
        },
        'rows': rows,
    }


def _inventory_health(period_start, period_end, report_code):
    del period_start, period_end
    products = list(Product.objects.filter(status='ACTIVE').only('id', 'code', 'name', 'min_stock', 'cost_price'))
    stock_map = build_stock_balance_map(product_ids=[product.id for product in products])
    on_hand_by_product = {}
    for (product_id, _warehouse_id, _location_id), balance in stock_map.items():
        on_hand_by_product[product_id] = on_hand_by_product.get(product_id, Decimal('0')) + Decimal(str(balance.get('on_hand') or 0))

    rows = []
    low_stock_count = 0
    out_of_stock_count = 0
    total_stock_value = Decimal('0')
    for product in products:
        current_stock = on_hand_by_product.get(product.id, Decimal('0'))
        min_stock = Decimal(str(product.min_stock or 0))
        if current_stock <= 0:
            out_of_stock_count += 1
        if current_stock < min_stock:
            low_stock_count += 1
        total_stock_value += current_stock * Decimal(str(product.cost_price or 0))
        rows.append({
            'product_code': product.code,
            'product_name': product.name,
            'current_stock': float(current_stock),
            'min_stock': float(min_stock),
            'gap_to_min_stock': float((min_stock - current_stock) if current_stock < min_stock else Decimal('0')),
            'health': 'LOW' if current_stock < min_stock else ('OUT' if current_stock <= 0 else 'OK'),
        })
    rows.sort(key=lambda item: ({'OUT': 0, 'LOW': 1, 'OK': 2}.get(item['health'], 9), item['product_code']))
    return {
        'report_code': report_code,
        'generated_at': timezone.now().isoformat(),
        'summary': {
            'total_products': len(products),
            'low_stock_count': low_stock_count,
            'out_of_stock_count': out_of_stock_count,
            'healthy_count': max(len(products) - low_stock_count, 0),
            'total_stock_value': float(total_stock_value),
        },
        'rows': rows[:100],
    }


def _production_summary(period_start, period_end, report_code):
    order_qs = (
        ProductionOrder.objects
        .filter(order_date__gte=period_start, order_date__lte=period_end)
        .select_related('product')
        .order_by('-order_date', '-id')
    )
    total_planned_qty = Decimal(str(order_qs.aggregate(total=Sum('planned_qty')).get('total') or 0))
    total_produced_qty = Decimal(str(order_qs.aggregate(total=Sum('produced_qty')).get('total') or 0))
    material_issue_cost = Decimal(str(
        ProductionIssue.objects.filter(issue_date__gte=period_start, issue_date__lte=period_end, status='POSTED')
        .aggregate(total=Sum('total_amount')).get('total') or 0
    ))
    rows = [
        {
            'order_code': order.code,
            'order_date': order.order_date.isoformat(),
            'product_code': getattr(order.product, 'code', ''),
            'product_name': getattr(order.product, 'name', ''),
            'status': order.status,
            'planned_qty': float(order.planned_qty or 0),
            'produced_qty': float(order.produced_qty or 0),
            'scrap_qty': float(order.scrap_qty or 0),
            'unit_cost_estimate': float(order.unit_cost_estimate or 0),
        }
        for order in order_qs[:50]
    ]
    return {
        'report_code': report_code,
        'period_start': period_start.isoformat(),
        'period_end': period_end.isoformat(),
        'summary': {
            'total_orders': order_qs.count(),
            'released_orders': order_qs.filter(status='RELEASED').count(),
            'completed_orders': order_qs.filter(status='COMPLETED').count(),
            'total_planned_qty': float(total_planned_qty),
            'total_produced_qty': float(total_produced_qty),
            'material_issue_cost': float(material_issue_cost),
        },
        'rows': rows,
    }


def _financial_summary(period_start, period_end, report_code):
    cash_qs = CashTransaction.objects.filter(transaction_date__gte=period_start, transaction_date__lte=period_end)
    receivable_qs = ReceivableDocument.objects.filter(document_date__gte=period_start, document_date__lte=period_end)
    payable_qs = PayableDocument.objects.filter(document_date__gte=period_start, document_date__lte=period_end)
    total_income = Decimal(str(cash_qs.filter(transaction_type='INCOME').aggregate(total=Sum('amount')).get('total') or 0))
    total_expense = Decimal(str(cash_qs.filter(transaction_type='EXPENSE').aggregate(total=Sum('amount')).get('total') or 0))
    total_receivable = Decimal(str(receivable_qs.aggregate(total=Sum('total_amount')).get('total') or 0))
    total_payable = Decimal(str(payable_qs.aggregate(total=Sum('total_amount')).get('total') or 0))
    rows = [
        {
            'transaction_date': item.transaction_date.isoformat(),
            'transaction_type': item.transaction_type,
            'object_name': item.object_name,
            'amount': float(item.amount or 0),
            'reason': item.reason,
        }
        for item in cash_qs.order_by('-transaction_date', '-id')[:50]
    ]
    return {
        'report_code': report_code,
        'period_start': period_start.isoformat(),
        'period_end': period_end.isoformat(),
        'summary': {
            'total_income': float(total_income),
            'total_expense': float(total_expense),
            'net_cash': float(total_income - total_expense),
            'receivable_total': float(total_receivable),
            'payable_total': float(total_payable),
            'receivable_count': receivable_qs.count(),
            'payable_count': payable_qs.count(),
        },
        'rows': rows,
    }


def _employee_performance(period_end, report_code):
    month_value = period_end.strftime('%Y-%m')
    attendances = AttendanceRecord.objects.filter(month=month_value, is_active=True).select_related('employee').prefetch_related('overtime_items')
    payroll_map = {
        row.employee_id: row
        for row in PayrollRecord.objects.filter(month=month_value).select_related('employee')
    }
    bonus_rows = BonusPenaltyRecord.objects.filter(month=month_value, is_active=True)
    bonus_map = {}
    penalty_map = {}
    for row in bonus_rows:
        key = row.employee_id
        if row.record_type == BonusPenaltyRecord.TYPE_BONUS:
            bonus_map[key] = bonus_map.get(key, Decimal('0')) + Decimal(str(row.amount or 0))
        else:
            penalty_map[key] = penalty_map.get(key, Decimal('0')) + Decimal(str(row.amount or 0))
    rows = []
    for attendance in attendances:
        standard_days = Decimal(str(attendance.standard_days or 0))
        actual_days = Decimal(str(attendance.actual_days or 0))
        attendance_rate = (actual_days / standard_days * Decimal('100')).quantize(Decimal('0.01')) if standard_days > 0 else Decimal('0')
        overtime_hours = Decimal(str(attendance.total_overtime_hours or 0))
        payroll = payroll_map.get(attendance.employee_id)
        total_bonus = Decimal(str(getattr(payroll, 'total_bonus', 0) or bonus_map.get(attendance.employee_id, Decimal('0'))))
        total_penalty = Decimal(str(getattr(payroll, 'total_penalty', 0) or penalty_map.get(attendance.employee_id, Decimal('0'))))
        performance_score = attendance_rate
        if overtime_hours > 20:
            performance_score += Decimal('5')
        if total_penalty > 0:
            performance_score -= Decimal('5')
        rows.append({
            'employee_code': attendance.employee.code,
            'employee_name': attendance.employee.name,
            'department': attendance.employee.department,
            'position': attendance.employee.position,
            'month': month_value,
            'standard_days': float(standard_days),
            'actual_days': float(actual_days),
            'attendance_rate_pct': float(attendance_rate),
            'overtime_hours': float(overtime_hours),
            'bonus_amount': float(total_bonus),
            'penalty_amount': float(total_penalty),
            'net_pay': float(getattr(payroll, 'net_pay', 0) or 0),
            'performance_score': float(max(Decimal('0'), performance_score.quantize(Decimal('0.01')))),
        })
    rows.sort(key=lambda item: item['performance_score'], reverse=True)
    return {
        'report_code': report_code,
        'month': month_value,
        'summary': {
            'employees': len(rows),
            'avg_performance_score': round(sum(item['performance_score'] for item in rows) / len(rows), 2) if rows else 0,
            'avg_attendance_rate_pct': round(sum(item['attendance_rate_pct'] for item in rows) / len(rows), 2) if rows else 0,
            'total_net_pay': round(sum(item['net_pay'] for item in rows), 2) if rows else 0,
        },
        'rows': rows,
    }


def _audit_trail(report_code):
    rows = list(
        AuditLog.objects.order_by('-created_at').values('entity_type', 'action', 'entity_code', 'created_at')[:50]
    )
    return {
        'report_code': report_code,
        'count': AuditLog.objects.count(),
        'summary': {
            'total_events': AuditLog.objects.count(),
            'latest_event_at': rows[0]['created_at'].isoformat() if rows else None,
        },
        'rows': rows,
    }


def _production_costing(period_start, period_end, report_code):
    orders = (
        ProductionOrder.objects.filter(order_date__gte=period_start, order_date__lte=period_end)
        .select_related('product')
        .order_by('-order_date', '-id')
    )
    rows = []
    total_issue_cost = Decimal('0')
    total_output_qty = Decimal('0')
    for order in orders:
        issue_cost = Decimal(str(
            ProductionIssue.objects.filter(production_order=order, status='POSTED').aggregate(total=Sum('total_amount')).get('total') or 0
        ))
        output_qty = Decimal(str(
            ProductionReceipt.objects.filter(production_order=order, status='POSTED').aggregate(total=Sum('total_qty')).get('total') or 0
        ))
        actual_unit_cost = (issue_cost / output_qty).quantize(Decimal('0.01')) if output_qty > 0 else Decimal('0')
        estimated_unit_cost = Decimal(str(order.unit_cost_estimate or 0))
        rows.append({
            'order_code': order.code,
            'product_code': getattr(order.product, 'code', ''),
            'product_name': getattr(order.product, 'name', ''),
            'planned_qty': float(order.planned_qty or 0),
            'produced_qty': float(output_qty),
            'estimated_unit_cost': float(estimated_unit_cost),
            'actual_material_cost': float(issue_cost),
            'actual_unit_cost': float(actual_unit_cost),
            'variance_per_unit': float((actual_unit_cost - estimated_unit_cost).quantize(Decimal('0.01'))),
        })
        total_issue_cost += issue_cost
        total_output_qty += output_qty
    return {
        'report_code': report_code,
        'period_start': period_start.isoformat(),
        'period_end': period_end.isoformat(),
        'summary': {
            'orders': len(rows),
            'total_actual_material_cost': float(total_issue_cost),
            'total_output_qty': float(total_output_qty),
            'avg_actual_unit_cost': float((total_issue_cost / total_output_qty).quantize(Decimal('0.01'))) if total_output_qty > 0 else 0,
        },
        'rows': rows,
    }


def _profit_report(period_start, period_end, report_code):
    orders = (
        SalesOrder.objects.filter(status='POSTED', order_date__gte=period_start, order_date__lte=period_end)
        .prefetch_related('lines')
        .order_by('-order_date', '-id')
    )
    rows = []
    total_revenue = Decimal('0')
    total_cost = Decimal('0')
    total_profit = Decimal('0')
    for order in orders:
        revenue = Decimal(str(order.total or 0))
        cost = Decimal('0')
        for line in order.lines.all():
            snapshot = line.product_snapshot or {}
            unit_cost = Decimal(str(snapshot.get('cost_price') or 0))
            qty = Decimal(str(line.qty or 0))
            cost += unit_cost * qty
        gross_profit = revenue - cost
        margin_pct = (gross_profit / revenue * Decimal('100')).quantize(Decimal('0.01')) if revenue > 0 else Decimal('0')
        rows.append({
            'order_code': order.code,
            'order_date': order.order_date.isoformat(),
            'customer_name': getattr(order.customer, 'name', '') if getattr(order, 'customer_id', None) else '',
            'revenue': float(revenue),
            'cost_of_goods_sold': float(cost),
            'gross_profit': float(gross_profit),
            'gross_margin_pct': float(margin_pct),
        })
        total_revenue += revenue
        total_cost += cost
        total_profit += gross_profit
    return {
        'report_code': report_code,
        'period_start': period_start.isoformat(),
        'period_end': period_end.isoformat(),
        'summary': {
            'orders': len(rows),
            'total_revenue': float(total_revenue),
            'total_cost_of_goods_sold': float(total_cost),
            'total_gross_profit': float(total_profit),
            'gross_margin_pct': float((total_profit / total_revenue * Decimal('100')).quantize(Decimal('0.01'))) if total_revenue > 0 else 0,
        },
        'rows': rows,
    }


def build_custom_report_result(*, report_code, report_type, period_start, period_end):
    report_code = str(report_code or '').strip().upper()
    report_type = str(report_type or '').strip().upper()

    if report_code == 'AUDIT_TRAIL':
        return _audit_trail(report_code)
    if report_code == 'PRODUCTION_COSTING':
        return _production_costing(period_start, period_end, report_code)
    if report_code == 'PROFIT_REPORT':
        return _profit_report(period_start, period_end, report_code)
    if report_code == 'EMPLOYEE_PERFORMANCE':
        return _employee_performance(period_end, report_code)
    if report_code == 'SALES_SUMMARY' or report_type == CustomReportDefinition.TYPE_SALES:
        return _sales_summary(period_start, period_end, report_code)
    if report_code == 'PURCHASE_SUMMARY' or report_type == CustomReportDefinition.TYPE_PURCHASE:
        return _purchase_summary(period_start, period_end, report_code)
    if report_code == 'INVENTORY_HEALTH' or report_type == CustomReportDefinition.TYPE_INVENTORY:
        return _inventory_health(period_start, period_end, report_code)
    if report_type == CustomReportDefinition.TYPE_PRODUCTION:
        return _production_summary(period_start, period_end, report_code)
    if report_type == CustomReportDefinition.TYPE_FINANCIAL:
        return _financial_summary(period_start, period_end, report_code)
    if report_type == CustomReportDefinition.TYPE_WORKFORCE:
        return _employee_performance(period_end, report_code)

    return {
        'report_code': report_code,
        'period_start': period_start.isoformat(),
        'period_end': period_end.isoformat(),
        'summary': {'generated': True},
        'rows': [],
    }


def execute_custom_report_definition(report, *, actor=None, period_start=None, period_end=None, trigger_type=CustomReportRun.TRIGGER_MANUAL, request_payload=None):
    request_payload = request_payload or {}
    default_start = report.period_start or (timezone.localdate() - timedelta(days=30))
    default_end = report.period_end or timezone.localdate()
    period_start = _parse_date(period_start, default_start)
    period_end = _parse_date(period_end, default_end)

    if period_end < period_start:
        raise ValueError('period_end phai lon hon hoac bang period_start.')

    started_at = time.perf_counter()
    try:
        result = build_custom_report_result(
            report_code=report.code,
            report_type=report.report_type,
            period_start=period_start,
            period_end=period_end,
        )
        duration_ms = int((time.perf_counter() - started_at) * 1000)
        row_count = _result_row_count(result)
        summary = _result_summary(result)
        stored_result = _trim_result_for_storage(result)
        run = CustomReportRun.objects.create(
            report=report,
            trigger_type=trigger_type,
            status=CustomReportRun.STATUS_SUCCESS,
            period_start=period_start,
            period_end=period_end,
            request_payload=_json_ready(request_payload),
            result_payload=stored_result,
            summary=summary,
            row_count=row_count,
            duration_ms=duration_ms,
            generated_by=actor,
        )

        report.period_start = period_start
        report.period_end = period_end
        report.last_generated_at = run.generated_at
        report.last_generated_by = actor or report.last_generated_by
        report.last_run_status = run.status
        report.last_run_error = ''
        report.last_run_summary = summary
        report.run_count = int(report.run_count or 0) + 1
        if not report.is_system and report.status == CustomReportDefinition.STATUS_DRAFT:
            report.status = CustomReportDefinition.STATUS_GENERATED
        report.updated_by = actor or report.updated_by
        report.save()
        _refresh_next_run_from_schedule(report)

        response_payload = _json_ready(result)
        response_payload.update({
            'id': report.id,
            'code': report.code,
            'name': report.name,
            'report_type': report.report_type,
            'status': report.status,
            'generated_by_name': getattr(actor, 'full_name', None) or getattr(actor, 'username', None),
            'generated_at': run.generated_at.isoformat(),
            'run_id': run.id,
            'row_count': row_count,
        })
        return response_payload
    except Exception as exc:
        duration_ms = int((time.perf_counter() - started_at) * 1000)
        CustomReportRun.objects.create(
            report=report,
            trigger_type=trigger_type,
            status=CustomReportRun.STATUS_FAILED,
            period_start=period_start,
            period_end=period_end,
            request_payload=_json_ready(request_payload),
            result_payload={},
            summary={},
            row_count=0,
            duration_ms=duration_ms,
            generated_by=actor,
            error_message=str(exc),
        )
        report.last_run_status = CustomReportRun.STATUS_FAILED
        report.last_run_error = str(exc)
        report.updated_by = actor or report.updated_by
        report.save(update_fields=['last_run_status', 'last_run_error', 'updated_by', 'updated_at'])
        raise


def run_scheduled_custom_report_job(report_id):
    report = CustomReportDefinition.objects.filter(pk=report_id).first()
    if not report:
        return {'success': False, 'error': 'Report not found.'}
    result = execute_custom_report_definition(
        report,
        actor=None,
        trigger_type=CustomReportRun.TRIGGER_SCHEDULED,
        request_payload={'source': 'scheduler'},
    )
    _refresh_next_run_from_schedule(report)
    return {'success': True, 'report_id': report.id, 'run_id': result.get('run_id')}
