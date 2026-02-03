from django.contrib import admin
from .models import ProductCategory, ProductUnit, ProductWave, ProductBoxType, Product


class ProductCategoryAdmin(admin.ModelAdmin):
    """Quản lý danh mục sản phẩm với tree view"""

    list_display = ['code', 'name', 'parent', 'children_count', 'is_active', 'created_at']
    list_filter = ['is_active', 'parent', 'created_at']
    search_fields = ['code', 'name', 'description']
    ordering = ['code']
    list_per_page = 50
    readonly_fields = ['created_at', 'updated_at']

    fieldsets = [
        ('Thông tin cơ bản', {
            'fields': ['code', 'name', 'parent', 'description']
        }),
        ('Trạng thái', {
            'fields': ['is_active']
        }),
        ('Thông tin hệ thống', {
            'fields': ['created_at', 'updated_at'],
            'classes': ['collapse']
        })
    ]

    def children_count(self, obj):
        return obj.children.filter(is_active=True).count()
    children_count.short_description = 'Số danh mục con'

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
    """Quản lý đơn vị tính"""

    list_display = ['code', 'name', 'is_active', 'created_at']
    list_filter = ['is_active', 'created_at']
    search_fields = ['code', 'name']
    ordering = ['code']
    list_per_page = 50
    readonly_fields = ['created_at', 'updated_at']

    fieldsets = [
        ('Thông tin đơn vị', {
            'fields': ['code', 'name', 'is_active']
        }),
        ('Thông tin hệ thống', {
            'fields': ['created_at', 'updated_at'],
            'classes': ['collapse']
        })
    ]

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
    list_display = ['code', 'name', 'is_active', 'created_at']
    list_filter = ['is_active']
    search_fields = ['code', 'name']
    ordering = ['code']

    fieldsets = (
        ('Thông tin cơ bản', {
            'fields': ('code', 'name', 'description')
        }),
        ('Trạng thái', {
            'fields': ('is_active',)
        }),
    )


@admin.register(ProductBoxType)
class ProductBoxTypeAdmin(admin.ModelAdmin):
    list_display = ['code', 'name', 'is_active', 'created_at']
    list_filter = ['is_active']
    search_fields = ['code', 'name']
    ordering = ['code']

    fieldsets = (
        ('Thông tin cơ bản', {
            'fields': ('code', 'name', 'description')
        }),
        ('Trạng thái', {
            'fields': ('is_active',)
        }),
    )


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
            'Mã SP',
            'Tên SP',
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

    actions = ['activate_selected', 'deactivate_selected', 'discontinue_selected', 'export_to_excel']
