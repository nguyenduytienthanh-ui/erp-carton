# ⚡ PHASE 3 - QUICK IMPLEMENTATION GUIDE

## 🎯 Template Pattern (Dùng cho tất cả 4 chức năng còn lại)

Vừa hoàn thành **Shipments** thành công! Đây là template có thể reuse cho General Ledger, AR, AP, Production Orders.

---

## 📋 SHIPMENT TEMPLATE (As Reference)

### Backend Structure:
```
1. Models (sales/models.py)
   - OutboundShipment
   - ShipmentLine
   
2. Serializers (sales/serializers.py)
   - ShipmentLineSerializer
   - OutboundShipmentSerializer
   
3. ViewSet (sales/views.py)
   - ShipmentViewSet
   - Custom @action methods (submit, approve, pack, send, confirm_delivery, cancel)
   
4. URLs (core/urls.py)
   - router.register(r'sales/shipments', ShipmentViewSet)
   
5. Tests (optional but recommended)
   - test_shipment_workflow.py
```

### Frontend Structure:
```
1. API (src/api/shipments.ts)
   - CRUD operations
   - Workflow actions
   
2. Types (src/types/shipments.ts)
   - OutboundShipmentStatus
   - ShipmentLine interface
   - OutboundShipment interface
   
3. List Page (src/pages/Sales/ShipmentList.tsx)
   - Search, Filter, Pagination
   - CSV Export
   - Inline Actions
   
4. Form Modal (src/pages/Sales/ShipmentFormModal.tsx)
   - Create/Edit form
   - Nested lines table
   
5. Router (src/AppRouter.tsx)
   - Route already added
   - Just needs to be uncommented/verified
```

---

## 🚀 NEXT 4 MODULES - QUICK CHECKLIST

### MODULE 1: GENERAL LEDGER (Sổ Cái Tổng Hợp)
**Time: 2-3 days**

#### Backend Checklist:
- [ ] Create GeneralLedgerEntry model
  - account (FK to Account)
  - debit_amount, credit_amount
  - posting_date (indexed)
  - reference (document type/id)
  - created_by
  
- [ ] Create Serializers:
  - GeneralLedgerEntrySerializer
  - with account_name, running_balance
  
- [ ] Create ViewSet:
  - List (filtered by account, date range)
  - Trial balance endpoint (SUM debit/credit by account)
  - Account balance endpoint
  - Reverse entry (for corrections)
  
- [ ] Register in core/urls.py:
  ```python
  router.register(r'finance/general-ledger', GeneralLedgerViewSet)
  ```

#### Frontend Checklist:
- [ ] API (src/api/finance.ts)
- [ ] Types (src/types/finance.ts)
- [ ] Pages:
  - GeneralLedgerList (showing entries)
  - TrialBalance (report view)
  - AccountDetail (drill-down view)
- [ ] Add menu items

---

### MODULE 2: ACCOUNTS RECEIVABLE (Công Nợ Phải Thu)
**Time: 2-3 days**

#### Backend Checklist:
- [ ] ReceivableDocument model
  - customer (FK)
  - invoice_number, invoice_date
  - amount, paid_amount, outstanding
  - status (POSTED, PARTIAL_PAID, PAID, OVERDUE, WRITTEN_OFF)
  - due_date
  
- [ ] Serializers + ViewSet
  - List with aging analysis
  - Receive payment action
  - Write-off action
  
- [ ] Register: `router.register(r'finance/receivables', ReceivableViewSet)`

#### Frontend Checklist:
- [ ] API + Types
- [ ] AR List (with aging buckets)
- [ ] Customer Account Detail
- [ ] Receive Payment Modal
- [ ] Aging Report

---

### MODULE 3: ACCOUNTS PAYABLE (Công Nợ Phải Trả)
**Time: 2-3 days**
*(Nearly identical to AR, just swap customer for supplier)*

#### Backend Checklist:
- [ ] PayableDocument model
  - supplier (FK)
  - bill_number, bill_date
  - amount, paid_amount, outstanding
  - status (POSTED, PARTIAL_PAID, PAID, OVERDUE)
  - due_date
  
- [ ] Serializers + ViewSet
- [ ] Register: `router.register(r'finance/payables', PayableViewSet)`

#### Frontend Checklist:
- [ ] Same structure as AR but for suppliers

---

### MODULE 4: PRODUCTION ORDERS (Lệnh Sản Xuất)
**Time: 3-4 days**

#### Backend Checklist:
- [ ] ProductionOrder model
  - code, product (FK), quantity
  - start_date, end_date
  - status (PLANNED, IN_PROGRESS, COMPLETED, CANCELLED)
  - BOM (Bill of Materials) management
  
- [ ] ProductionOrderLine (for BOM components)
  - component_product, required_qty, issued_qty
  
- [ ] ViewSet with actions:
  - start_production
  - issue_material
  - complete_production
  
- [ ] Register: `router.register(r'production/orders', ProductionOrderViewSet)`

#### Frontend Checklist:
- [ ] Production Order List
- [ ] Production Order Form with BOM
- [ ] Material Issue Form
- [ ] Progress Tracking

---

## 💡 IMPLEMENTATION STRATEGY

### Option A: Sequential (Recommended for one person)
```
Day 1-2: General Ledger (backend + frontend)
Day 3-4: Accounts Receivable (backend + frontend)
Day 5-6: Accounts Payable (backend + frontend)
Day 7-8: Production Orders (backend + frontend)
```

### Option B: Focus Areas
```
Finance First (Days 1-5): GL + AR + AP
Then Production (Days 6-8)
```

---

## 🔧 CODE PATTERNS TO REUSE

### Backend Serializer Pattern (Copy from Shipments):
```python
class ItemLineSerializer(serializers.ModelSerializer):
    related_name = serializers.CharField(source='related.name', read_only=True)
    # ... fields
    class Meta:
        model = ItemLine
        fields = [...]
        read_only_fields = [...]

class ItemSerializer(serializers.ModelSerializer):
    lines = ItemLineSerializer(many=True, required=False)
    # ... nested logic in create/update
    class Meta:
        model = Item
        fields = [...]
```

### ViewSet Action Pattern (Copy from Shipments):
```python
@action(detail=True, methods=['post'])
def workflow_action(self, request, pk=None):
    """Change status"""
    obj = self.get_object()
    
    try:
        with transaction.atomic():
            obj.status = NewStatus
            obj.save()
            AuditLog.objects.create(...)
        return Response(self.get_serializer(obj).data)
    except Exception as e:
        return Response({'error': str(e)}, status=400)
```

### Frontend List Page Pattern (Copy from ShipmentList.tsx):
```typescript
- useQuery for data fetching
- useMutation for actions (create, update, delete, workflow)
- Search + Filter dropdowns
- Status Tag with color mapping
- CSV export
- Detail Modal
- Form Modal (create/edit)
```

---

## ⚠️ KEY POINTS TO REMEMBER

1. **Models**: Always have indexed fields for status, dates, and foreign keys
2. **Serializers**: Include read_only related names for display
3. **ViewSet**: Check permissions, use transactions for state changes
4. **Frontend**: Use React Query for caching and state management
5. **Validation**: Validate business logic (e.g., can only approve if SUBMITTED)
6. **Error Handling**: Use getToastMessage for consistent UX
7. **Audit Logging**: Track all important actions

---

## 📊 EXPECTED TIMELINE

```
✅ Shipments: DONE (Dec 13)
├─ GL: Day 1-2 (Dec 14-15)
├─ AR: Day 3-4 (Dec 16-17)
├─ AP: Day 5-6 (Dec 18-19)
└─ Production: Day 7-8 (Dec 20-21)

Total Phase 3: ~3-4 weeks (including testing)
```

---

## 🎯 SUCCESS CRITERIA

✅ All 5 critical modules implemented
✅ Full CRUD operations working
✅ Workflow actions functional
✅ CSV export for all modules
✅ Menu items integrated
✅ Frontend-Backend integration complete
✅ Error handling consistent
✅ At least 80% code coverage

---

## 📞 NEXT STEPS

1. Review Shipment implementation (done ✅)
2. Start General Ledger following this template
3. Follow same pattern for AR, AP, Production
4. Test each module before moving to next
5. Commit after each module completion
6. Create PRs for review

**Ready to proceed?**

Generated: March 15, 2026
