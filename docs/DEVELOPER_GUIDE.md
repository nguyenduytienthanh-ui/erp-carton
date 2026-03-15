# Developer Guide: 5 Critical Business Features

## Quick Start

### Backend Setup

1. **Apply Migrations:**
```bash
python manage.py migrate
```

2. **Test API Endpoints:**
```bash
# Create purchase return
curl -X POST http://localhost:8000/api/purchasing/returns/ \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "return_date": "2024-03-15",
    "supplier": 1,
    "return_reason": "Quality issue",
    "lines": []
  }'
```

### Frontend Setup

1. **Install Dependencies:**
```bash
cd frontend
npm install
```

2. **Start Dev Server:**
```bash
npm run dev
```

3. **Access Pages:**
- Purchase Returns: http://localhost:5173/purchase-returns
- Stock Alerts: http://localhost:5173/stock-alerts
- Warehouse Transfer: http://localhost:5173/warehouse-transfers
- Bank Reconciliation: http://localhost:5173/bank-reconciliation

---

## Architecture Overview

### Backend Structure

```
backend/
├── purchasing/
│   ├── models.py (PurchaseReturn, PurchaseReturnLine)
│   ├── serializers.py (PurchaseReturnSerializer)
│   └── views.py (PurchaseReturnViewSet)
├── inventory/
│   ├── models.py (StockAlert, WarehouseTransfer, WarehouseTransferLine)
│   ├── serializers.py (Serializers for alerts & transfers)
│   └── views.py (ViewSets for alerts & transfers)
├── finance/
│   ├── models.py (BankReconciliation)
│   └── migrations/ (auto-generated)
└── core/
    └── urls.py (RegisteredRouters)
```

### Frontend Structure

```
frontend/src/
├── pages/
│   ├── Purchasing/
│   │   ├── PurchaseReturnList.tsx
│   │   └── PurchaseReturnFormModal.tsx
│   ├── Inventory/
│   │   ├── StockAlertList.tsx
│   │   ├── WarehouseTransferList.tsx
│   │   └── WarehouseTransferFormModal.tsx
│   └── Finance/
│       └── BankReconciliationList.tsx
├── api/
│   ├── purchasing.ts
│   ├── inventory.ts
│   └── finance.ts
├── types/
│   ├── purchasing.ts
│   ├── inventory.ts
│   └── finance.ts
└── utils/
    └── csvExport.ts
```

---

## Adding a New Feature (Template)

### 1. Backend Model

```python
# models.py
class NewFeature(SearchTextModelMixin):
    code = models.CharField(max_length=50, unique=True)
    status = models.CharField(
        max_length=20,
        choices=NewFeatureStatus.CHOICES,
        default=NewFeatureStatus.DRAFT
    )
    # Add fields...
    
    class Meta:
        ordering = ['-created_at']
        indexes = [models.Index(fields=['status', '-created_at'])]
```

### 2. Serializer

```python
# serializers.py
class NewFeatureSerializer(serializers.ModelSerializer):
    status_display = serializers.CharField(source='get_status_display', read_only=True)
    
    class Meta:
        model = NewFeature
        fields = ['id', 'code', 'status', 'status_display', ...]
    
    def create(self, validated_data):
        # Auto-generate code if needed
        return NewFeature.objects.create(**validated_data)
```

### 3. ViewSet

```python
# views.py
class NewFeatureViewSet(viewsets.ModelViewSet):
    queryset = NewFeature.objects.all()
    serializer_class = NewFeatureSerializer
    filter_backends = [DjangoFilterBackend, filters.SearchFilter]
    filterset_fields = ['status']
    search_fields = ['code', 'name']
    
    @action(detail=True, methods=['post'])
    def submit(self, request, pk=None):
        obj = self.get_object()
        if obj.status != NewFeatureStatus.DRAFT:
            raise ValidationError('Cannot submit non-draft items')
        obj.status = NewFeatureStatus.SUBMITTED
        obj.save()
        return Response({'status': 'submitted'})
```

### 4. URL Registration

```python
# urls.py
router.register(r'new-features', NewFeatureViewSet, basename='new-feature')
```

### 5. Frontend API

```typescript
// api/new.ts
export const newFeatureApi = {
  getFeatures: async (params?: Record<string, unknown>) => {
    const response = await axiosInstance.get('api/new-features/', { params });
    return response.data;
  },
  submitFeature: async (id: number) => {
    const response = await axiosInstance.post(`api/new-features/${id}/submit/`);
    return response.data;
  },
};
```

### 6. Frontend Types

```typescript
// types/new.ts
export type NewFeatureStatus = 'DRAFT' | 'SUBMITTED' | 'APPROVED';

export interface NewFeature {
  id: number;
  code: string;
  status: NewFeatureStatus;
  // Add fields...
}
```

### 7. Frontend List Page

```tsx
// pages/NewFeatureList.tsx
export default function NewFeatureList() {
  const { data: features } = useQuery({
    queryKey: ['new-features'],
    queryFn: () => newFeatureApi.getFeatures(),
  });
  
  return (
    <Table dataSource={features?.results} columns={[...]} />
  );
}
```

---

## Key Patterns

### 1. Error Handling

**Backend:**
```python
from rest_framework.exceptions import ValidationError, PermissionDenied

if not user.has_perm('can_manage_data'):
    raise PermissionDenied('No permission')

if obj.status != 'DRAFT':
    raise ValidationError('Invalid state transition')
```

**Frontend:**
```typescript
const { mutate } = useMutation({
  mutationFn: api.submitFeature,
  onError: (error) => {
    messageApi.error(getToastMessage(error));
  },
});
```

### 2. Atomic Transactions

```python
from django.db import transaction

@transaction.atomic
def post_feature(feature):
    feature.status = 'POSTED'
    feature.save()
    # Update related records
    update_inventory(feature)
    # Automatic rollback on error
```

### 3. Audit Logging

```python
from core.models import AuditLog

AuditLog.objects.create(
    user=request.user,
    action='SUBMIT',
    model_name='PurchaseReturn',
    object_id=obj.id,
)
```

### 4. Search & Filter

```python
class SearchTextModelMixin(models.Model):
    search_text = models.TextField(editable=False, db_index=True)
    
    def save(self, *args, **kwargs):
        self.search_text = ' '.join([
            self.code, 
            getattr(self, 'name', ''),
        ])
        super().save(*args, **kwargs)

# Query
items = Item.objects.filter(
    Q(search_text__icontains=query) |
    Q(status=status)
)
```

### 5. Pagination

```typescript
const params = {
  page: currentPage,
  page_size: 20,
  q: searchQuery,
  status: filter,
};

const { data } = useQuery({
  queryKey: ['items', params],
  queryFn: () => api.getItems(params),
});
```

---

## Testing Workflow

### Manual Testing Checklist

- [ ] Create new item (DRAFT)
- [ ] Edit item (verify only DRAFT editable)
- [ ] Delete item (verify only DRAFT deletable)
- [ ] Submit for approval
- [ ] Approve item
- [ ] Post/finalize item
- [ ] Verify related data updated (inventory, GL entries)
- [ ] Export to CSV
- [ ] Test permission denied (wrong user role)
- [ ] Test validation errors (missing fields)
- [ ] Test empty state (no records)
- [ ] Test search/filter
- [ ] Test pagination

### Automated Testing (Example)

```python
# tests.py
from django.test import TestCase
from rest_framework.test import APIClient

class PurchaseReturnTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = User.objects.create(username='test')
        self.client.force_authenticate(user=self.user)
    
    def test_create_return(self):
        response = self.client.post('/api/purchasing/returns/', {
            'return_date': '2024-03-15',
            'supplier': 1,
            'return_reason': 'Defective',
            'lines': []
        })
        self.assertEqual(response.status_code, 201)
        self.assertIn('id', response.data)
```

---

## Performance Optimization

### Database

1. **Indexes:**
```python
indexes = [
    models.Index(fields=['status', '-created_at']),
    models.Index(fields=['supplier', 'status']),
]
```

2. **Select Related:**
```python
.select_related('supplier', 'submitted_by')
.prefetch_related('lines')
```

3. **Pagination:**
Always paginate large queries - avoid fetching 10k+ records

### Frontend

1. **React Query:**
```typescript
const { data } = useQuery({
  queryKey: ['items'],
  queryFn: () => api.getItems(),
  staleTime: 5 * 60 * 1000,  // 5 min
  cacheTime: 10 * 60 * 1000,  // 10 min
});
```

2. **Debounce Search:**
```typescript
const { intentSearch } = useSearchFilterIntent({
  searchDebounceMs: 650,  // Wait 650ms before query
});
```

3. **Code Splitting:**
```typescript
const Component = lazy(() => import('./Page'));
```

---

## Deployment Checklist

- [ ] All tests passing
- [ ] Zero linter errors
- [ ] Database migrations applied
- [ ] Environment variables configured
- [ ] API keys/tokens secured
- [ ] CORS headers correct
- [ ] SSL certificates valid
- [ ] Backup before deploy
- [ ] Monitor logs after deploy
- [ ] Performance metrics baseline

---

## Debugging Tips

### Backend
```bash
# Enable query logging
DJANGO_DEBUG_SQL=1 python manage.py runserver

# Check migrations
python manage.py showmigrations

# Django shell
python manage.py shell
>>> from purchasing.models import PurchaseReturn
>>> PurchaseReturn.objects.count()
```

### Frontend
```javascript
// Console debugging
console.log('Query data:', data);

// React DevTools browser extension
// Check component props, state, render count

// Network tab
// View API requests/responses
// Check status codes, timing
```

---

## Common Issues & Solutions

| Issue | Solution |
|-------|----------|
| 403 Permission Denied | Check user role in Admin → Module Permissions |
| 404 Not Found | Verify URL path, check URL router registration |
| 400 Validation Error | Check API request payload, required fields |
| 500 Server Error | Check Django logs, database connection |
| Slow API Response | Check database query count, add indexes |
| Form submit fails | Check error message in console, verify form data |

---

## Resources

- [Django REST Framework Docs](https://www.django-rest-framework.org/)
- [React Query Docs](https://tanstack.com/query/latest)
- [Ant Design Components](https://ant.design/)
- [TypeScript Handbook](https://www.typescriptlang.org/docs/)

---

Last Updated: March 15, 2024
