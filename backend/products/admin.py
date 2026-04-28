from django.contrib import admin
from .models import (
    Operation,
    ProductCategory,
    ProductUnit,
    ProductWave,
    ProductBoxType,
    Product,
    ProductOperation,
    ProductRoutingStep,
    ProductBundle,
    ProductBundleComponent,
)


class ProductCategoryAdmin(admin.ModelAdmin):
    """Quản lý danh mục sản phẩm (Master Data chuẩn)"""

    list_display = ['code', 'name', 'parent', 'children_count', 'is_active', 'sort_order', 'created_at']
    list_filter = ['is_active', 'parent', 'created_at']
    search_fields = ['code', 'name', 'description']
    ordering = ['sort_order', 'code']
    list_per_page = 50
    readonly_fields = ['created_at', 'updated_at', 'created_by', 'updated_by', 'deleted_at', 'deleted_by']
    date_hierarchy = 'created_at'

    fieldsets = [
        ('Thông tin cơ bản', {
            'fields': ['code', 'name', 'parent', 'description', 'sort_order']
        }),
        ('Trạng thái', {
            'fields': ['is_active']
        }),
        ('Thông tin hệ thống', {
            'fields': ['created_at', 'updated_at', 'created_by', 'updated_by', 'deleted_at', 'deleted_by'],
            'classes': ['collapse']
        })
    ]

    def get_queryset(self, request):
        qs = super().get_queryset(request)
        return qs.filter(deleted_at__isnull=True)

    def children_count(self, obj):
        return obj.children.filter(is_active=True, deleted_at__isnull=True).count()
    children_count.short_description = 'Số danh mục con'

    def save_model(self, request, obj, form, change):
        if not change:
            obj.created_by = request.user
        obj.updated_by = request.user
        super().save_model(request, obj, form, change)

    @admin.action(description='Kích hoạt các danh mục đã chọn')
    def activate_selected(self, request, queryset):
        count = queryset.update(is_active=True)
        self.message_user(request, f"Đã kích hoạt {count} danh mục")

    @admin.action(description='Vô hiệu hóa các danh mục đã chọn')
    def deactivate_selected(self, request, queryset):
        count = queryset.update(is_active=False)
        self.message_user(request, f"Đã vô hiệu hóa {count} danh mục")

    actions = ['activate_selected', 'deactivate_selected']


admin.site.register(ProductCategory, ProductCategoryAdmin)


class ProductUnitAdmin(admin.ModelAdmin):
    """Quản lý đơn vị tính (Master Data chuẩn)"""

    list_display = ['code', 'name', 'is_active', 'sort_order', 'created_at']
    list_filter = ['is_active', 'created_at']
    search_fields = ['code', 'name']
    ordering = ['sort_order', 'code']
    list_per_page = 50
    readonly_fields = ['created_at', 'updated_at', 'created_by', 'updated_by', 'deleted_at', 'deleted_by']
    date_hierarchy = 'created_at'

    fieldsets = [
        ('Thông tin đơn vị', {
            'fields': ['code', 'name', 'is_active', 'sort_order']
        }),
        ('Thông tin hệ thống', {
            'fields': ['created_at', 'updated_at', 'created_by', 'updated_by', 'deleted_at', 'deleted_by'],
            'classes': ['collapse']
        })
    ]

    def get_queryset(self, request):
        return super().get_queryset(request).filter(deleted_at__isnull=True)

    def save_model(self, request, obj, form, change):
        if not change:
            obj.created_by = request.user
        obj.updated_by = request.user
        super().save_model(request, obj, form, change)

    @admin.action(description='Kích hoạt các đơn vị đã chọn')
    def activate_selected(self, request, queryset):
        count = queryset.update(is_active=True)
        self.message_user(request, f"Đã kích hoạt {count} đơn vị")

    @admin.action(description='Vô hiệu hóa các đơn vị đã chọn')
    def deactivate_selected(self, request, queryset):
        count = queryset.update(is_active=False)
        self.message_user(request, f"Đã vô hiệu hóa {count} đơn vị")

    actions = ['activate_selected', 'deactivate_selected']


admin.site.register(ProductUnit, ProductUnitAdmin)


@admin.register(ProductWave)
class ProductWaveAdmin(admin.ModelAdmin):
    list_display = ['code', 'name', 'is_active', 'sort_order', 'created_at']
    list_filter = ['is_active']
    search_fields = ['code', 'name']
    ordering = ['sort_order', 'code']
    readonly_fields = ['created_at', 'updated_at', 'created_by', 'updated_by', 'deleted_at', 'deleted_by']
    date_hierarchy = 'created_at'

    fieldsets = (
        ('Thông tin cơ bản', {'fields': ('code', 'name', 'description', 'sort_order')}),
        ('Trạng thái', {'fields': ('is_active',)}),
        ('Hệ thống', {'fields': ('created_at', 'updated_at', 'created_by', 'updated_by', 'deleted_at', 'deleted_by'), 'classes': ('collapse',)}),
    )

    def get_queryset(self, request):
        return super().get_queryset(request).filter(deleted_at__isnull=True)

    def save_model(self, request, obj, form, change):
        if not change:
            obj.created_by = request.user
        obj.updated_by = request.user
        super().save_model(request, obj, form, change)


@admin.register(ProductBoxType)
class ProductBoxTypeAdmin(admin.ModelAdmin):
    list_display = ['code', 'name', 'is_active', 'sort_order', 'created_at']
    list_filter = ['is_active']
    search_fields = ['code', 'name']
    ordering = ['sort_order', 'code']
    readonly_fields = ['created_at', 'updated_at', 'created_by', 'updated_by', 'deleted_at', 'deleted_by']
    date_hierarchy = 'created_at'

    fieldsets = (
        ('Thông tin cơ bản', {'fields': ('code', 'name', 'description', 'sort_order')}),
        ('Trạng thái', {'fields': ('is_active',)}),
        ('Hệ thống', {'fields': ('created_at', 'updated_at', 'created_by', 'updated_by', 'deleted_at', 'deleted_by'), 'classes': ('collapse',)}),
    )

    def get_queryset(self, request):
        return super().get_queryset(request).filter(deleted_at__isnull=True)

    def save_model(self, request, obj, form, change):
        if not change:
            obj.created_by = request.user
        obj.updated_by = request.user
        super().save_model(request, obj, form, change)


@admin.register(Operation)
class OperationAdmin(admin.ModelAdmin):
    list_display = ['code', 'name', 'sequence', 'default_unit', 'is_active', 'updated_at']
    list_filter = ['is_active', 'default_unit']
    search_fields = ['code', 'name', 'description']
    ordering = ['sequence', 'code']
    readonly_fields = ['created_at', 'updated_at']


@admin.register(ProductOperation)
class ProductOperationAdmin(admin.ModelAdmin):
    list_display = [
        'product',
        'operation_code',
        'operation_name',
        'sequence',
        'standard_rate_per_hour',
        'is_active',
        'updated_at',
    ]
    list_filter = ['operation', 'is_active']
    search_fields = ['product__code', 'product__name', 'operation_code', 'operation_name', 'note']
    ordering = ['product__code', 'sequence', 'operation_code']
    readonly_fields = ['operation_code', 'operation_name', 'created_at', 'updated_at', 'created_by', 'updated_by']
    autocomplete_fields = ['product', 'operation']

    def save_model(self, request, obj, form, change):
        if not change:
            obj.created_by = request.user
        obj.updated_by = request.user
        super().save_model(request, obj, form, change)


@admin.register(ProductRoutingStep)
class ProductRoutingStepAdmin(admin.ModelAdmin):
    list_display = [
        'product',
        'step_no',
        'display_order',
        'operation_code',
        'operation_name',
        'step_type',
        'standard_rate_per_hour',
        'is_required',
        'allow_parallel',
        'is_active',
        'updated_at',
    ]
    list_filter = ['step_type', 'is_required', 'allow_parallel', 'is_active', 'operation']
    search_fields = ['product__code', 'product__name', 'operation_code', 'operation_name', 'group_code', 'note']
    ordering = ['product__code', 'step_no', 'display_order', 'id']
    readonly_fields = ['operation_code', 'operation_name', 'created_at', 'updated_at']
    autocomplete_fields = ['product', 'operation', 'product_operation']


@admin.register(Product)
class ProductAdmin(admin.ModelAdmin):
    """Quản lý sản phẩm thùng carton"""

    list_display = [
        'code',
        'name',
        'size_order',
        'size_production',
        'wave',
        'box_type',
        'category',
        'unit',
        'sale_price',
        'status',
        'created_at',
    ]

    list_filter = [
        'status',
        'category',
        'unit',
        'wave',
        'box_type',
        'waterproof',
        'is_set',
        'created_at',
    ]

    search_fields = [
        'code',
        'name',
        'film_code',
        'mold_code',
        'description',
    ]

    ordering = ['-created_at']
    list_per_page = 50

    fieldsets = (
        ('Thông tin cơ bản', {
            'fields': ('code', 'name', 'category', 'unit', 'description', 'status')
        }),
        ('Kích thước & Loại', {
            'fields': ('size_order', 'size_production', 'wave', 'box_type')
        }),
        ('Giá & Số lượng', {
            'fields': ('cost_price', 'sale_price', 'min_stock', 'delivery_tolerance')
        }),
        ('Hoa hồng', {
            'fields': ('commission_per_unit', 'commission_percent'),
            'classes': ('collapse',)
        }),
        ('Công đoạn sản xuất (cái/giờ)', {
            'fields': (
                'process_xa', 'process_in', 'process_boi', 'process_can_mang',
                'process_be', 'process_chap', 'process_dong', 'process_dan', 'process_khac'
            ),
            'classes': ('collapse',)
        }),
        ('In ấn', {
            'fields': ('film_code', 'film_file_url', 'color_count'),
            'classes': ('collapse',)
        }),
        ('Bế & Chống thấm', {
            'fields': ('mold_code', 'mold_file_url', 'waterproof'),
            'classes': ('collapse',)
        }),
        ('BOM - Thùng mẹ/con', {
            'fields': ('is_set', 'parent', 'component_quantity'),
            'classes': ('collapse',)
        }),
        ('Ghi chú', {
            'fields': ('note_other', 'note'),
            'classes': ('collapse',)
        }),
        ('Phân quyền', {
            'fields': ('owner', 'team', 'is_active'),
            'classes': ('collapse',)
        }),
        ('Thông tin hệ thống', {
            'fields': ('created_at', 'updated_at', 'created_by', 'updated_by'),
            'classes': ('collapse',)
        }),
    )

    readonly_fields = ['created_at', 'updated_at', 'created_by', 'updated_by']

    autocomplete_fields = ['category', 'unit', 'wave', 'box_type', 'parent', 'owner', 'team']

    def save_model(self, request, obj, form, change):
        from core.models import NumberSequence

        if not change:
            obj.created_by = request.user
            if not obj.code:
                seq = NumberSequence.objects.filter(entity_type='Product', is_active=True).first()
                if not seq:
                    seq = NumberSequence.objects.create(
                        entity_type='Product',
                        prefix='PROD',
                        padding=3,
                        format_template='{prefix}-{number}',
                        is_active=True,
                    )
                obj.code = seq.get_next_number()
        obj.updated_by = request.user
        super().save_model(request, obj, form, change)

    @admin.action(description='Kích hoạt và chuyển status thành ACTIVE')
    def activate_selected(self, request, queryset):
        count = queryset.update(is_active=True, status='ACTIVE')
        self.message_user(request, f"Đã kích hoạt {count} sản phẩm")

    @admin.action(description='Vô hiệu hóa')
    def deactivate_selected(self, request, queryset):
        count = queryset.update(is_active=False)
        self.message_user(request, f"Đã vô hiệu hóa {count} sản phẩm")

    @admin.action(description='Ngừng sản xuất (status=DISCONTINUED)')
    def discontinue_selected(self, request, queryset):
        count = queryset.update(status='DISCONTINUED')
        self.message_user(request, f"Đã ngừng sản xuất {count} sản phẩm")

    @admin.action(description='Gán owner = tôi')
    def bulk_assign_owner_me(self, request, queryset):
        count = queryset.update(owner=request.user)
        self.message_user(request, f"Đã gán owner cho {count} sản phẩm")

    @admin.action(description='Gán team = nhóm của tôi')
    def bulk_assign_team_mine(self, request, queryset):
        team = request.user.teams.first()
        if not team:
            self.message_user(request, "Bạn chưa thuộc nhóm nào", level='ERROR')
            return
        count = queryset.update(team=team)
        self.message_user(request, f"Đã gán team {team.name} cho {count} sản phẩm")

    @admin.action(description='Export sang Excel')
    def export_to_excel(self, request, queryset):
        from core.utils import export_to_excel

        fields = [
            'code',
            'name',
            'category__code',
            'category__name',
            'unit__code',
            'unit__name',
            'cost_price',
            'sale_price',
            'min_stock',
            'status',
            'owner__username',
            'team__name',
            'created_at',
        ]
        headers = [
            'Mã hàng',
            'Tên hàng',
            'Mã danh mục',
            'Tên danh mục',
            'Mã đơn vị',
            'Tên đơn vị',
            'Giá vốn',
            'Giá bán',
            'Tồn TT',
            'Trạng thái',
            'Owner',
            'Team',
            'Ngày tạo',
        ]

        filename = 'Danh_sach_san_pham.xlsx'
        return export_to_excel(queryset, fields, headers, filename)

    actions = [
        'activate_selected', 'deactivate_selected', 'discontinue_selected',
        'bulk_assign_owner_me', 'bulk_assign_team_mine',
        'export_to_excel',
    ]


class ProductBundleComponentInline(admin.TabularInline):
    model = ProductBundleComponent
    extra = 0
    autocomplete_fields = ['component_product']


@admin.register(ProductBundle)
class ProductBundleAdmin(admin.ModelAdmin):
    list_display = [
        'sellable_product',
        'primary_product',
        'pricing_mode',
        'derived_commission_mode',
        'delivery_rule',
        'is_active',
        'updated_at',
    ]
    list_filter = ['pricing_mode', 'delivery_rule', 'is_active', 'updated_at']
    search_fields = ['sellable_product__code', 'sellable_product__name', 'primary_product__code', 'primary_product__name']
    autocomplete_fields = ['sellable_product', 'primary_product', 'created_by', 'updated_by']
    readonly_fields = ['created_at', 'updated_at', 'created_by', 'updated_by']
    inlines = [ProductBundleComponentInline]

    fieldsets = (
        ('Thông tin bộ', {
            'fields': ('sellable_product', 'primary_product', 'is_active', 'delivery_rule', 'note')
        }),
        ('Giá bộ', {
            'fields': ('pricing_mode', 'fixed_cost_price', 'fixed_sale_price')
        }),
        ('Hoa hồng bộ (đi theo cách tính giá)', {
            'fields': ('fixed_commission_per_unit', 'fixed_commission_percent')
        }),
        ('Thông tin hệ thống', {
            'fields': ('created_at', 'updated_at', 'created_by', 'updated_by'),
            'classes': ('collapse',)
        }),
    )

    @admin.display(description='Kiểu HH bộ')
    def derived_commission_mode(self, obj):
        return dict(ProductBundle.COMMISSION_MODE_CHOICES).get(obj.get_commission_mode(), obj.get_commission_mode())

    def save_model(self, request, obj, form, change):
        if not change:
            obj.created_by = request.user
        obj.updated_by = request.user
        obj.commission_mode = obj.get_commission_mode()
        super().save_model(request, obj, form, change)
