# 📋 PHASE 3 - COMPREHENSIVE IMPLEMENTATION ROADMAP

## 🎯 Tổng Quan Phase 3

**Mục Tiêu:** Hoàn thành 5 chức năng nguy hiểm để ERP sẵn sàng live
**Thời Gian Ước Tính:** 4-5 tuần (20-25 ngày làm việc)
**Ưu Tiên:** CẦN PHẢI LÀM trước khi deploy production

---

## 📅 LỊCH TRÌNH CHI TIẾT

### **TUẦN 1-2: PHIẾU XUẤT GIAO HÀNG (SHIPMENTS)**
**Thời Gian:** 5-7 ngày
**Tầm Quan Trọng:** 🔴 NGUY HIỂM

#### **Backend (2-3 ngày)**
1. **Models** ✅ (Done - models_shipment.py)
   - OutboundShipment (code, status, customer, shipment_date, etc.)
   - ShipmentLine (product, qty_shipped, qty_received, etc.)
   - Status: DRAFT → SUBMITTED → APPROVED → PACKED → IN_TRANSIT → DELIVERED

2. **Migrations**
   - Create migration file
   - Apply migrations

3. **Serializers** (tạo shipment_serializers.py)
   - ShipmentLineSerializer
   - OutboundShipmentSerializer
   - Nested lines + related data

4. **Views/ViewSet** (tạo shipment_views.py)
   - CRUD operations
   - Custom actions:
     - submit_shipment (DRAFT → SUBMITTED)
     - approve_shipment (SUBMITTED → APPROVED)
     - pack_shipment (APPROVED → PACKED)
     - send_shipment (PACKED → IN_TRANSIT)
     - confirm_delivery (IN_TRANSIT → DELIVERED)
     - cancel_shipment

5. **URL Registration**
   - Register route: router.register(r'sales/shipments', ShipmentViewSet)

#### **Frontend (2-3 ngày)**
1. **API Functions** (src/api/sales.ts)
   - getShipments
   - getShipment
   - createShipment
   - updateShipment
   - deleteShipment
   - submit/approve/pack/send/confirm/cancel actions

2. **Types** (src/types/sales.ts)
   - OutboundShipmentStatus type
   - ShipmentLine interface
   - OutboundShipment interface

3. **List Page** (src/pages/Sales/ShipmentList.tsx)
   - Table: code, customer, shipment_date, status, qty, actions
   - Filters: by status, customer, date range
   - Search: by code, customer name
   - Export to CSV
   - Action buttons: View, Edit (DRAFT only), Delete (DRAFT only)

4. **Form Modal** (src/pages/Sales/ShipmentFormModal.tsx)
   - Create/Edit shipment
   - Customer selection
   - Lines nested table with inline editor
   - Shipment details (date, address, carrier, tracking)

5. **Detail Modal**
   - View shipment with all info
   - Timeline showing status changes
   - Lines table with quantities

---

### **TUẦN 1-2: SỔ CÁI TỔNG HỢP (GENERAL LEDGER)**
**Thời Gian:** 5-7 ngày (Parallel với Shipments)
**Tầm Quan Trọng:** 🔴 NGUY HIỂM

#### **Backend (2-3 ngày)**
1. **Models** (tạo finance/models_ledger.py)
   - GeneralLedgerEntry
     - Fields: account, debit_amount, credit_amount, journal_number
     - Links: journal_batch, document_reference, created_by
     - Indexed by: account, posting_date, document_type

2. **Serializers**
   - GeneralLedgerEntrySerializer
   - With account_name, balance_after

3. **Views/ViewSet**
   - List GLs (filtered by account, date range)
   - Get GL detail
   - Post journal entries (from other modules)
   - Reverse entries (for corrections)
   - Custom actions:
     - trial_balance (endpoint)
     - account_balance (endpoint)

#### **Frontend (2-3 ngày)**
1. **GL List Page**
   - Table: Account, Debit, Credit, Balance, Date, Reference
   - Filters: by account, date range, document type
   - Drill-down: click account to see details

2. **Trial Balance Page**
   - Shows all accounts with debit/credit totals
   - Verifies debit = credit

3. **Account Detail View**
   - Running balance ledger
   - All transactions for account
   - Date range filter

---

### **TUẦN 3-4: CÔNG NỢ PHẢI THU (ACCOUNTS RECEIVABLE)**
**Thời Gian:** 3-4 ngày
**Tầm Quan Trọng:** 🔴 NGUY HIỂM

#### **Backend (1-2 ngày)**
1. **Models**
   - ReceivableDocument (invoice, statement)
   - ReceivableLineItem
   - Status: POSTED, PARTIAL_PAID, PAID, OVERDUE, WRITTEN_OFF

2. **Views/ViewSet**
   - List receivables
   - Aging analysis endpoint
   - Custom actions:
     - receive_payment (mark as paid/partial)
     - write_off
     - reverse_write_off

#### **Frontend (1-2 ngày)**
1. **AR List Page**
   - Table: Customer, Invoice, Amount, Paid, Outstanding, Days Overdue
   - Aging bucket view (0-30, 30-60, 60-90, 90+)
   - Filter: by customer, status, date range

2. **Customer Account View**
   - All invoices for customer
   - Payment history
   - Account balance

---

### **TUẦN 3-4: CÔNG NỢ PHẢI TRẢ (ACCOUNTS PAYABLE)**
**Thời Gian:** 3-4 ngày
**Tầm Quan Trọng:** 🔴 NGUY HIỂM

#### **Backend (1-2 ngày)**
1. **Models**
   - PayableDocument (bill, statement)
   - PayableLineItem
   - Status: POSTED, PARTIAL_PAID, PAID, OVERDUE

2. **Views/ViewSet**
   - List payables
   - Aging analysis
   - Custom actions:
     - record_payment
     - reverse_payment

#### **Frontend (1-2 ngày)**
1. **AP List Page**
   - Table: Supplier, Bill, Amount, Paid, Outstanding, Days Overdue
   - Aging analysis
   - Filter by supplier, status

2. **Payment Schedule**
   - Show upcoming payments
   - Payment history

---

### **TUẦN 5+: LỆNH SẢN XUẤT (PRODUCTION ORDERS)**
**Thời Gian:** 5-7 ngày
**Tầm Quan Trọng:** 🔴 NGUY HIỂM

#### **Backend (2-3 ngày)**
1. **Models**
   - ProductionOrder (routing, BOM, status)
   - ProductionOrderLine
   - BOMComponent (Bill of Materials)
   - Status: PLANNED, IN_PROGRESS, COMPLETED, CANCELLED

2. **Views/ViewSet**
   - CRUD operations
   - Custom actions: start, complete, cancel

#### **Frontend (2-3 ngày)**
1. **Production Order List**
2. **Production Order Form**
3. **BOM Management**
4. **Work Order Tracking**

---

## 📊 IMPLEMENTATION CHECKLIST

### ✅ Shipments (5-7 days)
- [ ] Backend: Models, Serializers, ViewSet
- [ ] Backend: Migrations & URL registration
- [ ] Frontend: API functions
- [ ] Frontend: TypeScript types
- [ ] Frontend: List page with CRUD
- [ ] Frontend: Form modal
- [ ] Frontend: Detail modal
- [ ] Testing: Full workflow
- [ ] Documentation

### ✅ General Ledger (5-7 days)
- [ ] Backend: Models, Serializers, ViewSet
- [ ] Frontend: GL list page
- [ ] Frontend: Trial balance page
- [ ] Frontend: Account detail view
- [ ] Testing & validation
- [ ] Documentation

### ✅ Accounts Receivable (3-4 days)
- [ ] Backend: Models, Serializers, ViewSet
- [ ] Frontend: AR list page
- [ ] Frontend: Aging analysis
- [ ] Frontend: Customer account view
- [ ] Testing
- [ ] Documentation

### ✅ Accounts Payable (3-4 days)
- [ ] Backend: Models, Serializers, ViewSet
- [ ] Frontend: AP list page
- [ ] Frontend: Aging analysis
- [ ] Frontend: Payment schedule
- [ ] Testing
- [ ] Documentation

### ✅ Production Orders (5-7 days)
- [ ] Backend: Models, Serializers, ViewSet
- [ ] Frontend: Production order list
- [ ] Frontend: Production order form
- [ ] Frontend: BOM management
- [ ] Frontend: Work order tracking
- [ ] Testing
- [ ] Documentation

---

## 🎯 IMPLEMENTATION SEQUENCE (Recommended)

### **Option A: Sequential (Safer)**
1. Shipments (Week 1-2)
2. General Ledger (Week 2-3)
3. Accounts Receivable (Week 3-4)
4. Accounts Payable (Week 4-5)
5. Production Orders (Week 5-6)

**Pros:** One thing at a time, clear focus
**Cons:** Takes longer

### **Option B: Parallel (Faster)**
1. **Team 1:** Shipments + General Ledger (Week 1-2)
2. **Team 2:** Accounts Receivable + Payable (Week 2-3)
3. **Team 3:** Production Orders (Week 3-4)

**Pros:** Faster delivery
**Cons:** Requires parallel execution

---

## 📚 CODE PATTERNS & EXAMPLES

### Backend Pattern (Models)
```python
# Features to include:
- Code field (unique, indexed)
- Status choices enum
- Workflow fields (submitted_by, approved_by, etc.)
- Timestamps (created_at, updated_at)
- Audit trail fields
- Related ForeignKeys with cascade/protect as appropriate
- Index on frequently filtered fields
```

### Backend Pattern (ViewSet)
```python
# Include:
- CRUD permissions check
- FilterBackend + SearchFilter
- Custom @action methods for workflow
- Atomic transactions for state changes
- AuditLog creation
- Serializer context for related data
```

### Frontend Pattern (List Page)
```typescript
// Include:
- Search input (with debounce)
- Filter dropdowns (status, related entity)
- Table with columns + actions
- Pagination
- CSV export
- Empty state with contextual message
- Create button
- Detail modal
```

### Frontend Pattern (Form Modal)
```typescript
// Include:
- Form.useForm() for state management
- Nested lines table with inline editor
- Validation on submit
- Loading state during save
- Success/error toast messages
- Related data selection (dropdowns)
```

---

## 🔧 TECHNICAL CONSIDERATIONS

### Database
- Add proper indexes for frequently filtered fields
- Use atomic transactions for multi-step operations
- Implement audit logging for compliance

### API
- Use nested serializers for related data
- Implement pagination for large datasets
- Add filtering & search on list endpoints
- Use DRF permission classes
- Implement rate limiting if needed

### Frontend
- Use React Query for data fetching
- Implement error boundaries
- Add loading skeletons
- Use form validation
- Export to CSV for reports

---

## ⏱️ TIMELINE SUMMARY

```
Week 1: Shipments (Mon-Fri)
Week 2: General Ledger (Mon-Wed) + Accounts Receivable (Thu-Fri)
Week 3: Accounts Payable (Mon-Wed) + Production Orders (Thu-Fri)
Week 4: Production Orders complete + Testing & bug fixes
Week 5: Final testing, documentation, deployment prep

Total: 4-5 weeks
```

---

## 🎓 LEARNING RESOURCES

### For Each Module:
1. Analyze existing similar modules (Purchase Returns, Stock Alerts)
2. Follow established patterns in codebase
3. Implement step-by-step (backend first, then frontend)
4. Test thoroughly before moving to next module
5. Document as you go

---

## 📞 NEXT STEPS

1. **Choose execution model:** Sequential or Parallel?
2. **Start with Shipments** (most critical, good template)
3. **Follow patterns** from existing modules
4. **Test early** to catch issues
5. **Document as you go** for team knowledge

---

**Ready to proceed with Shipments implementation?**

Let me know and I can create detailed step-by-step guides for each module!

Generated: March 15, 2026
