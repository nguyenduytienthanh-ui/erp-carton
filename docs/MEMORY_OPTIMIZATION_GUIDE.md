# Hướng dẫn Tối ưu hóa Bộ nhớ (Memory Optimization)

## Vấn đề đã gặp phải

Giao diện người dùng (frontend) tiêu tốn **RAM quá cao** (84%, ~1,974 MB) chỉ với một session đơn giản. 

### Nguyên nhân chính:

1. **Polling Intervals quá tần suất** - Nhiều API queries polling data quá thường xuyên
2. **Stale Time quá ngắn** - Data được coi là "stale" quá nhanh, gây refetch không cần thiết
3. **Background refetch** - Queries tiếp tục refetch ngay cả khi app ẩn

## Giải pháp đã áp dụng (MainLayout.tsx)

### 1. Tăng Header Notifications Polling Interval
```typescript
// Trước: 15 giây
activeMs: 15_000,

// Sau: 30 giây
activeMs: 30_000,
```

### 2. Tăng Stale Time cho Notifications
```typescript
// Trước: 5 giây
staleTime: 5_000,

// Sau: 15 giây
staleTime: 15_000,
```

### 3. Tối ưu Finance Queries
```typescript
// Polling mỗi 60 giây
activeMs: 60_000,

// Stale time từ 30s → 60s
staleTime: 60_000,
```

### 4. Tối ưu Workforce Queries
```typescript
// Polling mỗi 60 giây
activeMs: 60_000,

// Stale time từ 30s → 60s
staleTime: 60_000,
```

### 5. Tối ưu Operations Log Meta
```typescript
// Polling từ 60s → 120s
refetchInterval: 60_000,

// Stale time từ 30s → 60s
staleTime: 60_000,
```

### 6. Tối ưu RBAC History Meta
```typescript
// Polling từ 120s → 240s (4 phút)
refetchInterval: 240_000,

// Stale time từ 60s → 120s
staleTime: 120_000,
```

## Kết quả dự kiến

- **Giảm số lần API call**: ~50-60% ít hơn
- **Giảm bộ nhớ sử dụng**: ~30-40% tùy vào kích thước data
- **Hiệu suất tương tự**: User không cảm nhận sự khác biệt (data vẫn update kịp thời)

## Best Practices cho Polling

### ✅ Nên làm

1. **Sử dụng `refetchIntervalInBackground: false`** - Tránh polling khi tab ẩn
   ```typescript
   refetchIntervalInBackground: false,
   ```

2. **Chọn polling interval phù hợp**:
   - Real-time critical (notifications): 30-60s
   - Important data (finance, workforce): 60-120s  
   - Non-critical meta data: 120-300s

3. **Tăng `staleTime`** - Giảm refetch không cần thiết
   ```typescript
   staleTime: 15_000, // 15 giây
   refetchInterval: 30_000, // 30 giây
   ```

4. **Disable polling khi không cần**
   ```typescript
   enabled: canViewOpsLog, // Chỉ poll nếu user có quyền
   ```

### ❌ Tránh

1. ❌ Polling interval quá ngắn (< 10 giây)
   - Tạo load server
   - Tiêu tốn bandwidth
   - Gây lag frontend

2. ❌ Để `refetchIntervalInBackground: true` cho tất cả queries
   - App sẽ polling ngay cả khi user đang dùng tab khác
   - Lãng phí CPU và bandwidth

3. ❌ Quá nhiều queries polling cùng lúc
   - Kiểm tra xem có thể batch API calls không
   - Xem xét dùng WebSocket thay vì polling

4. ❌ Stale time quá ngắn
   - Gây refetch quá thường xuyên
   - Data có thể còn valid nhưng vẫn request lại

## Monitoring Bộ nhớ

### Chrome DevTools
1. **Mở DevTools**: `F12`
2. **Vào tab "Memory"**
3. **Chọn "Heap snapshots"** để xem memory usage
4. **So sánh trước/sau tối ưu**

### Node.js Backend
```bash
# Monitor memory usage
node --inspect backend/manage.py runserver

# Hoặc dùng process manager
pm2 monit
```

## Cần kiểm tra thêm

1. **TaskPanel component** - Có polling riêng?
2. **Workflow Pipeline** - Có live update quá tần suất?
3. **List pages** - Có infinite scroll + auto-fetch?
4. **WebSocket connections** - Có connection leak?

## Tài liệu liên quan

- [React Query Documentation](https://tanstack.com/query/latest)
- [Performance Optimization Guide](./PERFORMANCE_GUIDE.md) *(cần tạo)*
- [API Design Guide](./API_DESIGN_GUIDE.md) *(cần tạo)*
