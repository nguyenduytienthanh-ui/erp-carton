# ERP Pro: 5 Critical Business Features Documentation

## Overview

This document describes the implementation of 5 critical business features for the ERP Pro system. Each feature includes backend API, frontend UI, and complete workflow management.

---

## Table of Contents

1. [Order Confirmation](#order-confirmation)
2. [Purchase Returns](#purchase-returns)
3. [Low Stock Alerts](#low-stock-alerts)
4. [Warehouse Transfer](#warehouse-transfer)
5. [Bank Reconciliation](#bank-reconciliation)
6. [API Reference](#api-reference)
7. [Frontend Components](#frontend-components)

---

## Order Confirmation

### Overview
Allows sales staff to confirm customer orders after they are submitted. Tracks confirmation date and user.

### Business Flow
```
DRAFT → SUBMITTED → CONFIRMED
```

### Database Schema

**SalesOrder Fields:**
```python
confirmed_by = ForeignKey(User)  # User who confirmed
confirmed_at = DateTimeField()   # Confirmation timestamp
```

### API Endpoints

**Confirm Order:**
```
POST /api/sales/orders/{id}/confirm_order/

Response:
{
  "status": "Xác nhận",
  "confirmed_at": "2024-03-15T10:30:00Z"
}
```

### Frontend Usage

**React Component:**
```tsx
import { useMutation } from '@tanstack/react-query';
import { salesApi } from '../../api/sales';

const { mutate: confirmOrder } = useMutation({
  mutationFn: (id) => salesApi.confirmOrder(id),
  onSuccess: () => messageApi.success('Đã xác nhận đơn hàng'),
});

<Button onClick={() => confirmOrder(orderId)}>Xác nhận</Button>
```

### Permissions Required
- `can_access_sales_orders`

---

## Purchase Returns

### Overview
Complete purchase return workflow including creating, submitting, approving, and posting return documents. Includes automatic inventory reversal.

### Business Flow
```
DRAFT → SUBMITTED → APPROVED → POSTED
              ↓
           CANCELLED (can cancel from DRAFT)
```

### Database Schema

**PurchaseReturn Model:**
```python
class PurchaseReturn(SearchTextModelMixin):
    code = CharField(max_length=50, unique=True)
    return_date = DateField()
    status = CharField(choices=PurchaseReturnStatus)
    purchase_order = ForeignKey(PurchaseOrder, null=True)
    supplier = ForeignKey(Supplier)
    subtotal = DecimalField()
    tax_total = DecimalField()
    total = DecimalField()
    return_reason = CharField()
    return_notes = TextField()
    
    submitted_by = ForeignKey(User)
    submitted_at = DateTimeField(null=True)
    approved_by = ForeignKey(User)
    approved_at = DateTimeField(null=True)
    posted_by = ForeignKey(User)
    posted_at = DateTimeField(null=True)
    cancelled_by = ForeignKey(User)
    cancelled_at = DateTimeField(null=True)
```

**PurchaseReturnLine Model:**
```python
class PurchaseReturnLine:
    line_number = IntegerField()
    product = ForeignKey(Product)
    qty = DecimalField()
    unit_price = DecimalField()
    tax_pct = DecimalField()
    note = TextField()
```

### API Endpoints

**List Returns:**
```
GET /api/purchasing/returns/?page=1&page_size=20&status=DRAFT

Response:
{
  "count": 42,
  "next": "...",
  "results": [
    {
      "id": 123,
      "code": "RET-001",
      "return_date": "2024-03-15",
      "status": "DRAFT",
      "supplier_name": "ABC Corp",
      "total": "500000",
      "lines": [...]
    }
  ]
}
```

**Create Return:**
```
POST /api/purchasing/returns/

{
  "return_date": "2024-03-15",
  "supplier": 5,
  "return_reason": "Defective units",
  "return_notes": "Quality issue",
  "lines": [
    {
      "line_number": 1,
      "product": 123,
      "qty": "10",
      "unit_price": "50000",
      "tax_pct": "0",
      "note": "Return defective batch"
    }
  ]
}
```

**Submit Return for Approval:**
```
POST /api/purchasing/returns/{id}/submit_return/

Response: { "status": "Chờ duyệt" }
```

**Approve Return:**
```
POST /api/purchasing/returns/{id}/approve_return/

Response: { "status": "Đã duyệt" }
```

**Post Return (Reverse Inventory):**
```
POST /api/purchasing/returns/{id}/post_return/

Note: Automatically reverses inventory for all line items
Response: { "status": "Đã vào sổ" }
```

**Cancel Return:**
```
POST /api/purchasing/returns/{id}/cancel_return/

{
  "reason": "Error in submission"
}

Response: { "status": "Đã hủy" }
```

### Frontend Usage

**List Component:**
```tsx
const returnsQuery = useQuery({
  queryKey: ['purchasing-returns', { page, filters }],
  queryFn: () => purchasingApi.getPurchaseReturns({ page, ...filters }),
});

<Table dataSource={returnsQuery.data?.results} />
```

**Create/Edit Modal:**
```tsx
<PurchaseReturnFormModal
  open={formOpen}
  data={editReturn}
  onClose={() => setFormOpen(false)}
  onSuccess={() => refetch()}
/>
```

### Permissions Required
- `can_manage_purchasing_data`

### CSV Export Format
```
Mã trả, Ngày trả, NCC, Trạng thái, Tổng tiền
RET-001, 2024-03-15, ABC Corp, Nháp, 500,000
```

---

## Low Stock Alerts

### Overview
Automatically detects and tracks inventory items below minimum stock levels. Supports manual acknowledgment and resolution.

### Business Flow
```
TRIGGERED (auto)
    ↓
ACTIVE (new alert)
    ↓
ACKNOWLEDGED (staff confirmed)
    ↓
RESOLVED (restocked or ignored)
```

### Database Schema

**StockAlert Model:**
```python
class StockAlert(models.Model):
    product = ForeignKey(Product)
    alert_type = CharField(choices=[
        ('LOW_STOCK', 'Tồn kho thấp'),
        ('OUT_OF_STOCK', 'Hết hàng')
    ])
    status = CharField(choices=[
        ('ACTIVE', 'Đang hoạt động'),
        ('ACKNOWLEDGED', 'Đã xác nhận'),
        ('RESOLVED', 'Đã giải quyết')
    ])
    triggered_at = DateTimeField(auto_now_add=True)
    acknowledged_at = DateTimeField(null=True)
    acknowledged_by = ForeignKey(User, null=True)
    current_qty = DecimalField()
    min_stock = DecimalField()
```

### API Endpoints

**List Alerts:**
```
GET /api/inventory/stock-alerts/?status=ACTIVE

Response:
{
  "count": 15,
  "results": [
    {
      "id": 1,
      "product_code": "SKU-001",
      "product_name": "Widget A",
      "alert_type": "LOW_STOCK",
      "status": "ACTIVE",
      "current_qty": "5",
      "min_stock": "10",
      "triggered_at": "2024-03-15T08:00:00Z"
    }
  ]
}
```

**Acknowledge Alert:**
```
POST /api/inventory/stock-alerts/{id}/acknowledge_alert/

Response: { "status": "Đã xác nhận" }
```

**Check & Trigger Low Stock:**
```
POST /api/inventory/stock-alerts/check_low_stock/

Response: { "created": 3 }
# Creates new alerts for 3 products below min_stock
```

### Frontend Usage

**Filter Alerts:**
```tsx
<Select
  placeholder="Trạng thái"
  value={statusFilter}
  onChange={setStatusFilter}
  options={[
    { value: 'ACTIVE', label: 'Đang hoạt động' },
    { value: 'ACKNOWLEDGED', label: 'Đã xác nhận' },
    { value: 'RESOLVED', label: 'Đã giải quyết' }
  ]}
/>
```

**Acknowledge Alert:**
```tsx
const { mutate: acknowledge } = useMutation({
  mutationFn: (id) => inventoryApi.acknowledgeAlert(id),
  onSuccess: () => {
    messageApi.success('Đã xác nhận cảnh báo');
    refetch();
  },
});

<Button onClick={() => acknowledge(alertId)}>Xác nhận</Button>
```

### Permissions Required
- `can_manage_inventory_data`

### Monitoring
- Check low stock status: Dashboard → Stock Alerts
- Daily automated check recommended via Django management command

---

## Warehouse Transfer

### Overview
Manages inter-warehouse inventory transfers with tracking of sent and received quantities.

### Business Flow
```
DRAFT (create) → SUBMITTED (approve) → IN_TRANSIT (post) → RECEIVED (confirm receipt)
```

### Database Schema

**WarehouseTransfer Model:**
```python
class WarehouseTransfer(models.Model):
    code = CharField(max_length=50, unique=True)
    transfer_date = DateField()
    status = CharField(choices=[
        ('DRAFT', 'Nháp'),
        ('SUBMITTED', 'Chờ xác nhận'),
        ('IN_TRANSIT', 'Đang vận chuyển'),
        ('RECEIVED', 'Đã nhận'),
        ('CANCELLED', 'Đã hủy')
    ])
    from_warehouse = ForeignKey(Warehouse)
    to_warehouse = ForeignKey(Warehouse)
    reference = CharField()  # SO#, PO#, etc.
    note = TextField()
    
    submitted_by = ForeignKey(User)
    submitted_at = DateTimeField(null=True)
    posted_by = ForeignKey(User)
    posted_at = DateTimeField(null=True)
    received_by = ForeignKey(User)
    received_at = DateTimeField(null=True)
```

**WarehouseTransferLine Model:**
```python
class WarehouseTransferLine:
    line_number = IntegerField()
    product = ForeignKey(Product)
    qty = DecimalField()  # Qty sent
    received_qty = DecimalField()  # Qty received
    note = TextField()
```

### API Endpoints

**Create Transfer:**
```
POST /api/inventory/warehouse-transfers/

{
  "transfer_date": "2024-03-15",
  "from_warehouse": 1,
  "to_warehouse": 2,
  "reference": "SO-001",
  "note": "Rebalance inventory",
  "lines": [
    {
      "line_number": 1,
      "product": 100,
      "qty": "50"
    }
  ]
}
```

**Submit Transfer:**
```
POST /api/inventory/warehouse-transfers/{id}/submit_transfer/

Response: { "status": "Chờ xác nhận" }
```

**Post Transfer (Mark In Transit):**
```
POST /api/inventory/warehouse-transfers/{id}/post_transfer/

Response: { "status": "Đang vận chuyển" }
# Deducts qty from source warehouse
```

**Receive Transfer:**
```
POST /api/inventory/warehouse-transfers/{id}/receive_transfer/

Response: { "status": "Đã nhận" }
# Adds received_qty to destination warehouse
# Line items can have partial received_qty
```

### Frontend Usage

**Edit Transfer Lines:**
```tsx
<NestedLinesTable
  products={products}
  onChange={(lines) => form.setFieldValue('lines', lines)}
/>
```

### Permissions Required
- `can_manage_inventory_data`

### CSV Export Format
```
Mã chuyển, Ngày, Từ kho, Đến kho, Trạng thái
WH-001, 2024-03-15, KHO-01, KHO-02, Đang vận chuyển
```

---

## Bank Reconciliation

### Overview
Compares bank statement balance with accounting records (book balance). Calculates and displays delta automatically.

### Business Flow
```
DRAFT (create) → APPROVED (review) → POSTED (final)
```

### Database Schema

**BankReconciliation Model:**
```python
class BankReconciliation(models.Model):
    code = CharField(max_length=50, unique=True)
    statement_date = DateField()
    bank_account = ForeignKey(BankAccount)
    statement_balance = DecimalField()  # From bank statement
    book_balance = DecimalField()  # From accounting records
    delta = DecimalField()  # Auto-calc: statement - book
    status = CharField(choices=[
        ('DRAFT', 'Nháp'),
        ('APPROVED', 'Đã duyệt'),
        ('POSTED', 'Đã post')
    ])
    reference = CharField()  # Statement#
    note = TextField()
```

### API Endpoints

**Create Reconciliation:**
```
POST /api/finance/bank-reconciliations/

{
  "statement_date": "2024-03-15",
  "bank_account": 5,
  "statement_balance": "1000000",
  "book_balance": "950000",
  "reference": "STM-2024-03-15",
  "note": "March reconciliation"
}
```

**Approve Reconciliation:**
```
POST /api/finance/bank-reconciliations/{id}/approve/

Response: { "status": "Đã duyệt" }
```

**Post Reconciliation:**
```
POST /api/finance/bank-reconciliations/{id}/post/

Response: { "status": "Đã post" }
# Generates GL entries if delta > 0
```

### Frontend Display

**Delta Color Coding:**
- Green (✓): Delta = 0 (balanced)
- Red (⚠): Delta ≠ 0 (difference to investigate)

### Permissions Required
- `can_manage_finance_data`

### CSV Export Format
```
Mã, Ngày BĐS, Tài khoản, Sao kê, Sổ, Chênh lệch, Trạng thái
REC-001, 2024-03-15, TK-01, 1000000, 950000, 50000, Nháp
```

---

## API Reference

### Common Parameters

**Pagination:**
```
?page=1&page_size=20
```

**Search:**
```
?q=search_term
```

**Filter:**
```
?status=DRAFT
?alert_type=LOW_STOCK
```

**Sort:**
```
?ordering=code
?ordering=-created_at
```

### Common Responses

**Success (201/200):**
```json
{
  "id": 1,
  "code": "ABC-001",
  "status": "DRAFT",
  ...
}
```

**Error (400/422):**
```json
{
  "error": "Validation error",
  "details": {
    "return_date": ["This field is required"]
  }
}
```

**Error (403):**
```json
{
  "error": "Permission denied",
  "message": "You don't have permission to perform this action"
}
```

**Error (404):**
```json
{
  "error": "Not found",
  "message": "Resource not found"
}
```

---

## Frontend Components

### List Pages

Each list page includes:
- **Search Input** - Real-time search with debounce
- **Filter Dropdowns** - Status, type, etc.
- **Table Display** - Paginated with sort
- **Action Buttons** - View, Edit, Delete, Workflow actions
- **CSV Export** - Download current filtered data
- **Empty State** - Contextual messages

### Form Modals

**Common Features:**
- Input validation with error messages
- Loading state during submission
- Nested line items with inline editor
- Add/Remove line buttons
- Cancel/Save actions
- Success toast notification

### Detail Modals

**Features:**
- Loading skeleton while fetching
- Error handling with retry option
- Read-only display
- Related items in nested table
- Close button

---

## Troubleshooting

### Common Issues

**Permission Denied**
- Check user role has permission for module
- Verify in Admin → Module Permissions

**Validation Errors**
- Review form field requirements
- Check date format (YYYY-MM-DD)
- Verify decimal input format

**API Timeout**
- Check network connection
- Try again after 30 seconds
- Contact IT if persists

**Inventory Not Updated**
- Verify transfer/return status is POSTED
- Check warehouse selection is correct
- Run daily stock recount

---

## Performance Considerations

- List pages load first 20 records by default
- Search has 650ms debounce to reduce requests
- CSV export limited to current page (avoid exporting 10k+ rows)
- Detail modals load on demand (not cached)

---

## Security

- All endpoints require authentication
- Permission checks enforced at view level
- Audit logging tracks all changes
- No sensitive data in CSV export
- API responses sanitized

---

## Support & Contact

For questions or issues:
1. Check this documentation
2. Review API error messages
3. Contact development team
4. Submit GitHub issue with details

Last Updated: March 15, 2024
