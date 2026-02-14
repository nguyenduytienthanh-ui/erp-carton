"""Admin SalesOrder: Header + TabularInline lines, readonly theo status, actions workflow."""
from django.contrib import admin
from django.utils import timezone
from django.db.models import Q

from core.models import ApprovalHistory, AuditLog
from core.mixins import get_client_ip
from sales.models import SalesOrder, SalesOrderLine, SalesOrderPostingLog, SalesOrderStatus
from sales.services import get_next_sales_order_code, post_sales_order


class SalesOrderLineInline(admin.TabularInline):
    model = SalesOrderLine
    extra = 0
    fields = ['line_number', 'product', 'uom', 'qty', 'unit_price', 'discount_pct', 'tax_pct', 'line_total', 'note']


@admin.register(SalesOrder)
class SalesOrderAdmin(admin.ModelAdmin):
    list_display = ['code', 'order_date', 'customer', 'status', 'total', 'posted_at', 'post_number', 'created_at']
    list_filter = ['status', 'order_date', 'team']
    search_fields = ['code', 'reference', 'notes']
    date_hierarchy = 'order_date'
    inlines = [SalesOrderLineInline]
    raw_id_fields = ['customer', 'owner', 'team']
    readonly_fields = [
        'code', 'subtotal', 'discount_total', 'tax_total', 'total', 'version',
        'submitted_by', 'submitted_at', 'approved_by', 'approved_at',
        'rejected_by', 'rejected_at', 'reject_reason',
        'posted_by', 'posted_at', 'post_number',
        'voided_by', 'voided_at', 'void_reason',
        'created_by', 'created_at', 'updated_by', 'updated_at',
    ]
    fieldsets = [
        ('Thông tin chung', {'fields': ['code', 'doc_type', 'order_date', 'status', 'reference', 'customer', 'notes']}),
        ('Tiền tệ & Số tiền', {'fields': ['currency', 'exchange_rate', 'subtotal', 'discount_total', 'tax_total', 'total']}),
        ('Duyệt', {'fields': ['submitted_by', 'submitted_at', 'approved_by', 'approved_at', 'rejected_by', 'rejected_at', 'reject_reason']}),
        ('Vào sổ', {'fields': ['posted_by', 'posted_at', 'post_number', 'posted_snapshot']}),
        ('Hủy', {'fields': ['voided_by', 'voided_at', 'void_reason']}),
        ('Phân quyền & Audit', {'fields': ['owner', 'team', 'version', 'created_by', 'created_at', 'updated_by', 'updated_at']}),
    ]

    def get_readonly_fields(self, request, obj=None):
        ro = list(super().get_readonly_fields(request, obj))
        if obj and obj.status != SalesOrderStatus.DRAFT:
            ro = ro + ['order_date', 'reference', 'customer', 'currency', 'exchange_rate', 'notes']
        return ro

    def get_queryset(self, request):
        return super().get_queryset(request).select_related('customer', 'owner', 'team').prefetch_related('lines', 'lines__product')

    def save_model(self, request, obj, form, change):
        if not change:
            if not obj.code:
                obj.code = get_next_sales_order_code(obj.order_date or timezone.now().date())
            obj.created_by = request.user
        obj.updated_by = request.user
        super().save_model(request, obj, form, change)

    def save_formset(self, request, form, formset, change):
        instances = formset.save(commit=False)
        for inst in instances:
            if hasattr(inst, 'sales_order_id') and inst.sales_order_id:
                inst.save()
        formset.save_m2m()
        if change and instances:
            order = form.instance
            order.recalc_totals()

    @admin.action(description='Gửi duyệt')
    def submit_selected(self, request, queryset):
        for order in queryset.filter(status=SalesOrderStatus.DRAFT):
            order.status = SalesOrderStatus.SUBMITTED
            order.submitted_by = request.user
            order.submitted_at = timezone.now()
            order.save(update_fields=['status', 'submitted_by', 'submitted_at', 'updated_at'])
            ApprovalHistory.objects.create(entity_type='SalesOrder', entity_id=order.id, entity_code=order.code, action='SUBMIT', user=request.user, level=1)
        self.message_user(request, 'Đã gửi duyệt.')

    @admin.action(description='Duyệt')
    def approve_selected(self, request, queryset):
        for order in queryset.filter(status=SalesOrderStatus.SUBMITTED):
            order.status = SalesOrderStatus.APPROVED
            order.approved_by = request.user
            order.approved_at = timezone.now()
            order.save(update_fields=['status', 'approved_by', 'approved_at', 'updated_at'])
            ApprovalHistory.objects.create(entity_type='SalesOrder', entity_id=order.id, entity_code=order.code, action='APPROVE', user=request.user, level=1)
        self.message_user(request, 'Đã duyệt.')

    @admin.action(description='Vào sổ (idempotent)')
    def post_selected(self, request, queryset):
        for order in queryset.filter(status=SalesOrderStatus.APPROVED):
            ok, _ = post_sales_order(order, request.user, request)
            if ok:
                self.message_user(request, f'Đã vào sổ {order.code}.')
            else:
                self.message_user(request, f'{order.code}: {_}', level='warning')

    actions = ['submit_selected', 'approve_selected', 'post_selected']


@admin.register(SalesOrderLine)
class SalesOrderLineAdmin(admin.ModelAdmin):
    list_display = ['sales_order', 'line_number', 'product', 'qty', 'unit_price', 'line_total']
    list_filter = ['sales_order']
    raw_id_fields = ['sales_order', 'product']


@admin.register(SalesOrderPostingLog)
class SalesOrderPostingLogAdmin(admin.ModelAdmin):
    list_display = ['sales_order', 'post_number', 'posted_by', 'posted_at']
    list_filter = ['posted_at']
    readonly_fields = ['sales_order', 'posted_by', 'posted_at', 'post_number', 'snapshot_saved']
