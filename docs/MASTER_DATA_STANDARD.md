# Chuẩn Master Data (dùng chung)

Tài liệu này mô tả bộ chuẩn đã áp dụng cho danh mục (master data) trong dự án. **Áp chuẩn này cho mọi master mới hoặc master chưa chuẩn hóa.**

---

## 1. Model (DB)

| Yêu cầu | Chi tiết |
|--------|----------|
| **id** | Auto (PK). Tùy chọn UUID nếu cần. |
| **code, name** | Bắt buộc. |
| **description** | Optional. |
| **is_active** | Boolean, default True. |
| **sort_order** | Integer, default 0 (optional). |
| **Scope** | owner, team, visibility (nếu cần). |
| **Audit** | created_by, updated_by (FK User, null=True), created_at, updated_at. |
| **Soft delete** | deleted_at (DateTimeField, null=True), deleted_by (FK User, null=True). |
| **Unique constraint** | **UniqueConstraint(fields=['code'], condition=Q(deleted_at__isnull=True))** — chỉ bản ghi chưa xóa mới bị ràng buộc unique code; bỏ `unique=True` trên field `code`. |
| **Indexes** | code, name, is_active, created_at (và team nếu có). |

**Lưu ý:** Trong `save()` chỉ normalize `code` (trim, uppercase). **Không gán created_by/updated_by trong model.save()** — do ViewSet hoặc admin set trước khi gọi save.

---

## 2. API / ViewSet

- **filter_backends**: DjangoFilterBackend, SearchFilter, OrderingFilter.
- **filterset_class**: FilterSet riêng (CharFilter code/name, BooleanFilter is_active, **DateFilter created_at range timezone-aware**).
- **search_fields**, **ordering_fields**, **ordering**.
- **get_queryset()**: mặc định `filter(deleted_at__isnull=True)`.
- **perform_create**: `serializer.save(created_by=request.user, updated_by=request.user)`.
- **perform_update**: `serializer.save(updated_by=request.user)`.
- **perform_destroy**: soft delete (set deleted_at, deleted_by), không xóa vật lý.
- **Bulk actions**: bulk_activate, bulk_deactivate, bulk_delete (soft).
- **Pagination**: dùng DEFAULT_PAGINATION_CLASS (PageNumberPagination).
- **Export**: ExportExcelMixin + export_template_entity_type; get_export_headers/get_export_row hoặc ExportTemplate (columns/headers).

---

## 3. FilterSet (django-filter)

- **CharFilter**: code, name (lookup icontains).
- **BooleanFilter**: is_active.
- **Date range**: created_at__gte, created_at__lte — **timezone-aware** (parse YYYY-MM-DD → start/end of day theo `get_current_timezone()` khi USE_TZ=True).

---

## 4. Export (null-safe)

- **\_get_attr_path(obj, path)**: path dạng `field` hoặc `field__nested__name`. Bất kỳ bước nào None (FK null) → return `''`. Giá trị cuối **str(obj)** cho Excel.

---

## 5. Permissions

- **check_action_permission(user, resource, action, strict=None)**.
- **PERMISSION_STRICT_DEFAULT** (settings): `False` = không cấu hình permission thì cho qua; `True` = strict (không cấu hình = từ chối).
- Gọi với `strict=True` khi cần strict từng action.

---

## 6. Audit log (bulk)

- **Một thao tác bulk = 1 dòng AuditLog**: entity_id=0, new_values={'ids': [...], 'count': N, ...}. Không tạo N dòng cho N bản ghi.

---

## 7. Admin (Django Admin)

- list_display, list_filter, search_fields.
- **readonly_fields**: created_at, updated_at, created_by, updated_by, deleted_at, deleted_by.
- **date_hierarchy** = 'created_at'.
- **get_queryset()**: filter deleted_at__isnull=True.
- **save_model()**: gán created_by/updated_by khi create, updated_by khi update.
- **Actions**: activate, deactivate, export; bulk assign owner/team (nếu có scope).

---

## 8. Serializer

- **read_only_fields**: id, created_at, updated_at, created_by, updated_by, deleted_at, deleted_by (và các SerializerMethodField).
- Validate unique (theo scope nếu có).

---

## Danh sách master đã áp chuẩn

| App | Model | Ghi chú |
|-----|--------|---------|
| products | ProductCategory, ProductUnit, ProductWave, ProductBoxType | Đủ chuẩn. |
| products | Product | Transactional master; có scope, ImportLog, AuditLog; không soft-delete. |
| core | Team, Role | Đủ chuẩn (soft-delete, audit, unique code + condition, filters, bulk, export). |

---

## Khi thêm master mới

1. Tạo model theo **§1** (UniqueConstraint condition deleted_at, indexes, audit, soft delete).
2. Thêm FilterSet với **DateFilter timezone-aware** (§3).
3. ViewSet: filterset + search + ordering + get_queryset exclude deleted + perform_create/update/destroy + bulk + export (§2).
4. Serializer: read_only audit + optional scope validation (§8).
5. Admin: readonly audit, date_hierarchy, get_queryset exclude deleted, save_model set audit (§7).
6. Permission: dùng check_action_permission với strict nếu cần (§5).
7. Bulk audit: 1 dòng per bulk action (§6).

Tham chiếu code: `products.models` (ProductCategory, ProductUnit, ProductWave, ProductBoxType), `products.filters`, `products.views`, `core.mixins`, `core.permissions`.
