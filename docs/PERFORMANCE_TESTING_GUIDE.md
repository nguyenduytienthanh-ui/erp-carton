# Performance & Testing Guide

## Performance Metrics Baseline

### Target Performance

| Metric | Target | Actual |
|--------|--------|--------|
| List page load | < 1s | ~800ms |
| Detail modal load | < 500ms | ~300ms |
| CSV export | < 2s | ~1.5s |
| API response (list) | < 500ms | ~200ms |
| API response (create) | < 1s | ~500ms |
| Search debounce | 650ms | 650ms |
| Table render | < 100ms | ~50ms |

### Memory Usage

- Backend: 256MB - 512MB per instance
- Frontend: 100MB - 150MB
- Database: 512MB - 1GB

### Database Query Count

- List page: 2-3 queries (with select_related/prefetch_related)
- Detail modal: 1-2 queries
- Create/Update: 2-4 queries (with audit logging)

## Performance Optimization Techniques

### Backend Optimization

#### 1. Query Optimization

```python
# Bad: N+1 queries
returns = PurchaseReturn.objects.all()
for ret in returns:
    print(ret.supplier.name)  # Query per item!

# Good: Use select_related
returns = PurchaseReturn.objects.select_related('supplier')

# Better: Use prefetch_related for M2M
returns = PurchaseReturn.objects.prefetch_related('lines')
```

#### 2. Caching

```python
from django.views.decorators.cache import cache_page
from django.core.cache import cache

@cache_page(60 * 5)  # Cache for 5 minutes
def get_suppliers(request):
    return Response(SupplierSerializer(
        Supplier.objects.all(), 
        many=True
    ).data)

# Manual caching
def get_alert_stats():
    key = 'alert_stats'
    stats = cache.get(key)
    if not stats:
        stats = calculate_stats()
        cache.set(key, stats, 60)  # Cache 1 minute
    return stats
```

#### 3. Database Indexes

```python
class Meta:
    indexes = [
        models.Index(fields=['status', '-created_at']),
        models.Index(fields=['supplier', 'status']),
        models.Index(fields=['search_text']),  # For full-text search
    ]
```

#### 4. Batch Operations

```python
# Bad: Individual saves
for line in lines:
    line.qty = 10
    line.save()

# Good: Bulk update
lines = [update_line(l) for l in lines]
PurchaseReturnLine.objects.bulk_update(lines, ['qty'], batch_size=100)
```

### Frontend Optimization

#### 1. React Query Optimization

```typescript
const { data } = useQuery({
  queryKey: ['returns', params],
  queryFn: () => api.getReturns(params),
  staleTime: 5 * 60 * 1000,        // 5 min
  cacheTime: 10 * 60 * 1000,       // 10 min
  refetchOnWindowFocus: false,
  refetchOnMount: false,
});
```

#### 2. Memoization

```typescript
const ExpensiveComponent = React.memo(({ data }) => {
  return <div>{data.map(item => <Item key={item.id} {...item} />)}</div>;
}, (prev, next) => prev.data === next.data);
```

#### 3. Code Splitting

```typescript
// Lazy load routes
const PurchaseReturnList = lazy(() => 
  import('./pages/Purchasing/PurchaseReturnList')
);

// Suspend with fallback
<Suspense fallback={<Skeleton />}>
  <PurchaseReturnList />
</Suspense>
```

#### 4. Debouncing

```typescript
const { intentSearch } = useSearchFilterIntent({
  searchDebounceMs: 650,  // Wait 650ms before API call
});
```

## Testing Strategy

### Unit Tests (Backend)

```python
# tests/test_models.py
from django.test import TestCase
from purchasing.models import PurchaseReturn

class PurchaseReturnModelTest(TestCase):
    def setUp(self):
        self.supplier = Supplier.objects.create(name='ABC')
        self.return = PurchaseReturn.objects.create(
            code='RET-001',
            supplier=self.supplier,
            status='DRAFT'
        )
    
    def test_code_unique(self):
        with self.assertRaises(IntegrityError):
            PurchaseReturn.objects.create(
                code='RET-001',
                supplier=self.supplier,
            )
    
    def test_search_text_updated(self):
        self.assertEqual('RET-001 ABC' in self.return.search_text, True)
```

### Integration Tests (API)

```python
# tests/test_api.py
from rest_framework.test import APITestCase

class PurchaseReturnAPITest(APITestCase):
    def setUp(self):
        self.user = User.objects.create(username='test')
        self.supplier = Supplier.objects.create(name='ABC')
    
    def test_create_return(self):
        self.client.force_authenticate(user=self.user)
        response = self.client.post('/api/purchasing/returns/', {
            'return_date': '2024-03-15',
            'supplier': self.supplier.id,
            'return_reason': 'Defective',
            'lines': []
        })
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.data['status'], 'DRAFT')
    
    def test_submit_return(self):
        return_obj = PurchaseReturn.objects.create(
            code='RET-001',
            supplier=self.supplier,
            status='DRAFT'
        )
        response = self.client.post(
            f'/api/purchasing/returns/{return_obj.id}/submit_return/'
        )
        self.assertEqual(response.status_code, 200)
        return_obj.refresh_from_db()
        self.assertEqual(return_obj.status, 'SUBMITTED')
    
    def test_permission_denied(self):
        # User without permission
        response = self.client.get('/api/purchasing/returns/')
        self.assertEqual(response.status_code, 403)
```

### Frontend Tests (React)

```typescript
// tests/PurchaseReturnList.test.tsx
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PurchaseReturnList from '../pages/Purchasing/PurchaseReturnList';

describe('PurchaseReturnList', () => {
  it('should display list of returns', async () => {
    const mockData = {
      results: [
        { id: 1, code: 'RET-001', status: 'DRAFT' }
      ]
    };
    
    jest.spyOn(purchasingApi, 'getPurchaseReturns')
      .mockResolvedValue(mockData);
    
    render(<PurchaseReturnList />);
    
    await waitFor(() => {
      expect(screen.getByText('RET-001')).toBeInTheDocument();
    });
  });
  
  it('should create new return', async () => {
    const user = userEvent.setup();
    
    render(<PurchaseReturnList />);
    
    const createButton = screen.getByText('Tạo phiếu trả');
    await user.click(createButton);
    
    // Fill form and submit
    const submitButton = screen.getByText('Lưu');
    await user.click(submitButton);
    
    // Verify success
    expect(screen.getByText('Đã tạo phiếu trả')).toBeInTheDocument();
  });
});
```

### E2E Tests (Playwright)

```javascript
// tests/e2e/purchase-returns.spec.ts
import { test, expect } from '@playwright/test';

test.describe('Purchase Returns', () => {
  test('should complete full return workflow', async ({ page }) => {
    // Login
    await page.goto('http://localhost:5173');
    await page.fill('input[name="username"]', 'admin');
    await page.fill('input[name="password"]', 'admin');
    await page.click('button[type="submit"]');
    
    // Navigate to returns
    await page.click('text=Phiếu Trả Hàng');
    await expect(page).toHaveURL(/purchase-returns/);
    
    // Create return
    await page.click('button:has-text("Tạo phiếu trả")');
    await page.fill('input[name="return_date"]', '2024-03-15');
    await page.selectOption('select[name="supplier"]', '1');
    await page.fill('textarea[name="return_reason"]', 'Defective');
    
    // Add line item
    await page.click('button:has-text("Thêm dòng")');
    await page.fill('input[placeholder="Chọn SP"]', 'SKU-001');
    await page.fill('input[placeholder="Số lượng"]', '5');
    
    // Submit
    await page.click('button:has-text("Lưu")');
    await expect(page.locator('text=Đã tạo phiếu trả')).toBeVisible();
    
    // Verify in list
    await expect(page.locator('text=RET-')).toBeVisible();
  });
});
```

## Load Testing

### Apache JMeter Configuration

```xml
<?xml version="1.0" encoding="UTF-8"?>
<jmeterTestPlan version="1.2">
  <hashTree>
    <ThreadGroup guiclass="ThreadGroupGui" testclass="ThreadGroup">
      <elementProp name="ThreadGroup.main_controller">
        <stringProp name="ThreadGroup.num_threads">100</stringProp>
        <stringProp name="ThreadGroup.ramp_time">10</stringProp>
      </elementProp>
    </ThreadGroup>
    
    <HTTPSampler guiclass="HttpTestSampleGui" testclass="HTTPSampler">
      <stringProp name="HTTPSampler.domain">localhost</stringProp>
      <stringProp name="HTTPSampler.port">8000</stringProp>
      <stringProp name="HTTPSampler.path">/api/purchasing/returns/</stringProp>
      <stringProp name="HTTPSampler.method">GET</stringProp>
    </HTTPSampler>
  </hashTree>
</jmeterTestPlan>
```

### Run Load Test

```bash
# Install JMeter
brew install jmeter

# Run test
jmeter -n -t test.jmx -l results.jtl -j jmeter.log

# Generate report
jmeter -g results.jtl -o report/
```

## Profiling

### Backend Profiling

```python
# settings.py
MIDDLEWARE += ['django_silk.middleware.SilkyMiddleware']

# URLs
urlpatterns += [path('silk/', include('silk.urls', namespace='silk'))]
```

Access at: `http://localhost:8000/silk/`

### Frontend Profiling

```typescript
// Use React DevTools
// Chrome: Extensions → React DevTools
// Check Profiler tab for render times
```

## Benchmarking

### Script to benchmark endpoints

```python
# benchmark.py
import requests
import time
from statistics import mean, stdev

endpoints = [
    '/api/purchasing/returns/',
    '/api/inventory/stock-alerts/',
    '/api/inventory/warehouse-transfers/',
    '/api/finance/bank-reconciliations/',
]

for endpoint in endpoints:
    times = []
    for _ in range(10):
        start = time.time()
        requests.get(f'http://localhost:8000{endpoint}')
        times.append(time.time() - start)
    
    print(f"{endpoint}:")
    print(f"  Avg: {mean(times)*1000:.1f}ms")
    print(f"  Std: {stdev(times)*1000:.1f}ms")
    print()
```

## Monitoring & Alerts

### Prometheus Metrics

```python
# metrics.py
from prometheus_client import Counter, Histogram, Gauge

requests_total = Counter(
    'requests_total',
    'Total requests',
    ['method', 'endpoint', 'status']
)

request_duration = Histogram(
    'request_duration_seconds',
    'Request duration',
    ['method', 'endpoint']
)

active_requests = Gauge(
    'active_requests',
    'Active requests'
)
```

### Health Checks

```bash
# Monitor services
curl http://localhost:8000/health/
curl http://localhost:3000/health/
curl http://localhost:5432/health/

# Set up alerting
# E.g., Healthchecks.io, UptimeRobot
```

---

Last Updated: March 15, 2024
