# Complete API Reference

## Base URL
```
http://localhost:8000/api
```

## Authentication
```
Header: Authorization: Bearer {token}
```

---

## Purchase Returns API

### List Purchase Returns
```
GET /purchasing/returns/

Query Parameters:
- page: int (default: 1)
- page_size: int (default: 20)
- q: string (search by code, supplier)
- status: string (DRAFT, SUBMITTED, APPROVED, POSTED, CANCELLED)
- ordering: string (code, -created_at, return_date)

Response (200):
{
  "count": 42,
  "next": "http://...",
  "previous": null,
  "results": [
    {
      "id": 1,
      "code": "RET-001",
      "return_date": "2024-03-15",
      "status": "DRAFT",
      "supplier": 5,
      "supplier_name": "ABC Corp",
      "purchase_order": null,
      "purchase_order_code": null,
      "subtotal": "500000.00",
      "tax_total": "0.00",
      "total": "500000.00",
      "return_reason": "Defective units",
      "return_notes": "Quality issue",
      "submitted_by": null,
      "submitted_at": null,
      "approved_by": null,
      "approved_at": null,
      "posted_by": null,
      "posted_at": null,
      "cancelled_by": null,
      "cancelled_at": null,
      "lines": [
        {
          "id": 1,
          "line_number": 1,
          "product": 123,
          "product_code": "SKU-001",
          "product_name": "Widget A",
          "qty": "10.0000",
          "unit_price": "50000.00",
          "tax_pct": "0.00",
          "note": "Return defective batch"
        }
      ],
      "created_at": "2024-03-15T10:00:00Z",
      "updated_at": "2024-03-15T10:00:00Z"
    }
  ]
}
```

### Get Single Purchase Return
```
GET /purchasing/returns/{id}/

Response (200):
Same as item in list
```

### Create Purchase Return
```
POST /purchasing/returns/

Body:
{
  "return_date": "2024-03-15",
  "supplier": 5,
  "purchase_order": null,
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

Response (201):
{
  "id": 1,
  "code": "RET-001",  # Auto-generated
  ...
}

Errors:
- 400: Validation error (missing fields, invalid data)
- 403: Permission denied
- 422: Unprocessable entity (invalid supplier, product, etc.)
```

### Update Purchase Return
```
PATCH /purchasing/returns/{id}/

Body:
{
  "return_date": "2024-03-16",
  "lines": [...]
}

Response (200):
Updated return object

Notes:
- Only DRAFT returns can be updated
- Line items are replaced entirely (full replacement)
```

### Delete Purchase Return
```
DELETE /purchasing/returns/{id}/

Response (204): No content

Notes:
- Only DRAFT returns can be deleted
```

### Submit Return for Approval
```
POST /purchasing/returns/{id}/submit_return/

Response (200):
{
  "status": "Chờ duyệt"
}

Notes:
- Requires permission: can_manage_purchasing_data
- Status must be DRAFT
- Creates AuditLog entry
```

### Approve Return
```
POST /purchasing/returns/{id}/approve_return/

Response (200):
{
  "status": "Đã duyệt"
}

Notes:
- Status must be SUBMITTED
- Creates AuditLog entry
```

### Post Return (Finalize)
```
POST /purchasing/returns/{id}/post_return/

Response (200):
{
  "status": "Đã vào sổ"
}

Notes:
- Status must be APPROVED
- Automatically reverses inventory for all line items
- Atomic transaction - all or nothing
- Creates AuditLog entry
```

### Cancel Return
```
POST /purchasing/returns/{id}/cancel_return/

Body:
{
  "reason": "Error in submission"  # Optional
}

Response (200):
{
  "status": "Đã hủy"
}

Notes:
- Can cancel from any status
- Creates AuditLog entry
```

---

## Stock Alerts API

### List Stock Alerts
```
GET /inventory/stock-alerts/

Query Parameters:
- page: int (default: 1)
- page_size: int (default: 20)
- q: string (search by product code, name)
- alert_type: string (LOW_STOCK, OUT_OF_STOCK)
- status: string (ACTIVE, ACKNOWLEDGED, RESOLVED)
- ordering: string (-triggered_at, product__code)

Response (200):
{
  "count": 15,
  "results": [
    {
      "id": 1,
      "product": 123,
      "product_code": "SKU-001",
      "product_name": "Widget A",
      "alert_type": "LOW_STOCK",
      "status": "ACTIVE",
      "triggered_at": "2024-03-15T08:00:00Z",
      "acknowledged_at": null,
      "acknowledged_by": null,
      "acknowledged_by_name": null,
      "current_qty": "5.0000",
      "min_stock": "10.0000"
    }
  ]
}
```

### Acknowledge Alert
```
POST /inventory/stock-alerts/{id}/acknowledge_alert/

Response (200):
{
  "status": "Đã xác nhận"
}

Notes:
- Status must be ACTIVE
- Updates acknowledged_at and acknowledged_by
```

### Check Low Stock (Trigger Alerts)
```
POST /inventory/stock-alerts/check_low_stock/

Response (200):
{
  "created": 3  # Number of new alerts created
}

Notes:
- Scans all products
- Creates alerts for products below min_stock
- Skips if alert already exists in ACTIVE status
- Should be run daily via scheduled task
```

---

## Warehouse Transfer API

### List Warehouse Transfers
```
GET /inventory/warehouse-transfers/

Query Parameters:
- page: int
- page_size: int
- q: string (search by code, reference)
- status: string (DRAFT, SUBMITTED, IN_TRANSIT, RECEIVED, CANCELLED)
- from_warehouse: int (filter by source)
- to_warehouse: int (filter by destination)

Response (200):
{
  "count": 42,
  "results": [
    {
      "id": 1,
      "code": "WH-001",
      "transfer_date": "2024-03-15",
      "status": "IN_TRANSIT",
      "from_warehouse": 1,
      "from_warehouse_code": "KHO-01",
      "to_warehouse": 2,
      "to_warehouse_code": "KHO-02",
      "reference": "SO-001",
      "note": "Rebalance inventory",
      "submitted_by": 5,
      "submitted_at": "2024-03-15T09:00:00Z",
      "posted_by": 5,
      "posted_at": "2024-03-15T10:00:00Z",
      "received_by": null,
      "received_at": null,
      "lines": [
        {
          "id": 1,
          "line_number": 1,
          "product": 100,
          "product_code": "SKU-001",
          "product_name": "Widget A",
          "qty": "50.0000",
          "received_qty": "0.0000",
          "note": ""
        }
      ],
      "created_at": "2024-03-15T08:30:00Z"
    }
  ]
}
```

### Create Warehouse Transfer
```
POST /inventory/warehouse-transfers/

Body:
{
  "transfer_date": "2024-03-15",
  "from_warehouse": 1,
  "to_warehouse": 2,
  "reference": "SO-001",
  "note": "Rebalance",
  "lines": [
    {
      "line_number": 1,
      "product": 100,
      "qty": "50"
    }
  ]
}

Response (201): Created transfer
```

### Submit Transfer
```
POST /inventory/warehouse-transfers/{id}/submit_transfer/

Response (200):
{
  "status": "Chờ xác nhận"
}

Notes:
- Status must be DRAFT
- Validates all lines have products and quantities
```

### Post Transfer
```
POST /inventory/warehouse-transfers/{id}/post_transfer/

Response (200):
{
  "status": "Đang vận chuyển"
}

Notes:
- Status must be SUBMITTED
- Deducts qty from source warehouse
- Atomic transaction
```

### Receive Transfer
```
POST /inventory/warehouse-transfers/{id}/receive_transfer/

Body (optional):
{
  "lines": [
    {
      "id": 1,
      "received_qty": "45"  # Partial receipt allowed
    }
  ]
}

Response (200):
{
  "status": "Đã nhận"
}

Notes:
- Status must be IN_TRANSIT
- Updates received_qty for each line
- Adds qty to destination warehouse
```

---

## Bank Reconciliation API

### List Bank Reconciliations
```
GET /finance/bank-reconciliations/

Query Parameters:
- page: int
- page_size: int
- q: string (search)
- status: string (DRAFT, APPROVED, POSTED)
- bank_account: int (filter by account)

Response (200):
{
  "count": 10,
  "results": [
    {
      "id": 1,
      "code": "REC-001",
      "statement_date": "2024-03-15",
      "bank_account": 5,
      "bank_account_code": "TK-01",
      "bank_account_name": "Main Account",
      "statement_balance": "1000000.00",
      "book_balance": "950000.00",
      "delta": "50000.00",  # Difference to investigate
      "status": "DRAFT",
      "reference": "STM-2024-03",
      "note": "March reconciliation",
      "created_at": "2024-03-15T10:00:00Z"
    }
  ]
}
```

### Create Bank Reconciliation
```
POST /finance/bank-reconciliations/

Body:
{
  "statement_date": "2024-03-15",
  "bank_account": 5,
  "statement_balance": "1000000",
  "book_balance": "950000",
  "reference": "STM-2024-03",
  "note": "March reconciliation"
}

Response (201):
{
  "id": 1,
  "code": "REC-001",  # Auto-generated
  "delta": "50000.00",  # Auto-calculated
  ...
}
```

### Approve Reconciliation
```
POST /finance/bank-reconciliations/{id}/approve/

Response (200):
{
  "status": "Đã duyệt"
}

Notes:
- Status must be DRAFT
```

### Post Reconciliation
```
POST /finance/bank-reconciliations/{id}/post/

Response (200):
{
  "status": "Đã post"
}

Notes:
- Status must be APPROVED
- If delta > 0, generates GL entry for difference
```

---

## Error Responses

### 400 Bad Request
```json
{
  "error": "Validation error",
  "details": {
    "return_date": ["This field is required"],
    "supplier": ["Invalid supplier ID"]
  }
}
```

### 403 Forbidden
```json
{
  "error": "Permission denied",
  "message": "You don't have permission to manage purchasing data"
}
```

### 404 Not Found
```json
{
  "error": "Not found",
  "message": "Purchase return not found"
}
```

### 422 Unprocessable Entity
```json
{
  "error": "Validation error",
  "message": "Supplier does not exist or is inactive"
}
```

### 500 Server Error
```json
{
  "error": "Server error",
  "message": "An unexpected error occurred. Please try again later."
}
```

---

## Rate Limiting

```
X-RateLimit-Limit: 1000
X-RateLimit-Remaining: 999
X-RateLimit-Reset: 1234567890

429 Too Many Requests:
{
  "error": "Rate limit exceeded",
  "retry_after": 60
}
```

---

## Pagination

All list endpoints support standard pagination:

```
{
  "count": 100,           # Total items
  "next": "...?page=2",   # Next page URL
  "previous": null,       # Previous page URL
  "results": [...]        # Items on current page
}
```

---

## Filtering Examples

### Date Range
```
GET /purchasing/returns/?created_at__gte=2024-01-01&created_at__lte=2024-12-31
```

### Multiple Status
```
GET /inventory/stock-alerts/?status=ACTIVE&status=ACKNOWLEDGED
```

### Search
```
GET /purchasing/returns/?q=RET
GET /purchasing/returns/?q=ABC%20Corp
```

### Combined
```
GET /purchasing/returns/?page=1&page_size=50&status=DRAFT&q=RET&ordering=-return_date
```

---

Last Updated: March 15, 2024
