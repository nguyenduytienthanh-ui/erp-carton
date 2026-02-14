# DESIGN PATTERNS - ERP CARTON

## 📋 Table of Contents
1. [User Preferences Pattern](#user-preferences-pattern)
2. [Usage Examples](#usage-examples)

---

## User Preferences Pattern

### Tổng quan
Hệ thống lưu cấu hình người dùng - **GENERIC HOÀN TOÀN** cho bất kỳ component nào.

**Triết lý thiết kế:**
- 1 model cho TẤT CẢ
- 1 hook cho TẤT CẢ
- Config structure linh hoạt (JSON)
- Áp dụng được mọi nơi

### Backend Architecture

#### Model
```python
# backend/core/models.py
class UserPreferences(models.Model):
    user = ForeignKey(User)
    page = CharField(max_length=50)  # Tên bất kỳ
    config = JSONField()             # Config tùy biến
```

#### API Endpoints
```
GET    /api/preferences/{page}/   → Lấy config
POST   /api/preferences/{page}/   → Lưu config
DELETE /api/preferences/{page}/   → Xóa config
```

### Frontend Hook

```typescript
// frontend/src/hooks/useUserPreferences.ts
export const useUserPreferences = (page: string) => {
  return { config, saveConfig, deleteConfig, isLoading };
};
```

---

## Usage Examples

### 1. List Components - Columns & Filters
```typescript
const ProductList = () => {
  const { config, saveConfig } = useUserPreferences('products-list');
  const [visibleColumns, setVisibleColumns] = useState<string[]>([]);
  
  useEffect(() => {
    if (config?.columns) setVisibleColumns(config.columns);
  }, [config]);
  
  const handleColumnToggle = async (col: string) => {
    const newCols = visibleColumns.includes(col)
      ? visibleColumns.filter(c => c !== col)
      : [...visibleColumns, col];
    setVisibleColumns(newCols);
    await saveConfig({ ...config, columns: newCols });
  };
};
```

### 2. Form Components - Tabs
```typescript
const ProductForm = () => {
  const { config, saveConfig } = useUserPreferences('products-form');
  const [activeTab, setActiveTab] = useState(0);
  
  useEffect(() => {
    if (config?.activeTab !== undefined) {
      setActiveTab(config.activeTab);
    }
  }, [config]);
  
  const handleTabChange = async (tab: number) => {
    setActiveTab(tab);
    await saveConfig({ ...config, activeTab: tab });
  };
};
```

### 3. Dashboard - Layout & Widgets
```typescript
const Dashboard = () => {
  const { config, saveConfig } = useUserPreferences('dashboard');
  
  const handleLayoutChange = async (layout: any) => {
    await saveConfig({ ...config, layout });
  };
  
  const handleWidgetToggle = async (widgetId: string) => {
    const newWidgets = config?.widgets || [];
    const updated = newWidgets.includes(widgetId)
      ? newWidgets.filter(w => w !== widgetId)
      : [...newWidgets, widgetId];
    await saveConfig({ ...config, widgets: updated });
  };
};
```

### 4. Settings - Theme & Language
```typescript
const Settings = () => {
  const { config, saveConfig } = useUserPreferences('settings');
  
  const handleThemeChange = async (theme: string) => {
    document.body.className = theme;
    await saveConfig({ ...config, theme });
  };
  
  const handleLanguageChange = async (lang: string) => {
    i18n.changeLanguage(lang);
    await saveConfig({ ...config, language: lang });
  };
};
```

---

## Config Structures

### List Pages
```typescript
{
  columns: string[];
  filters: Record<string, any>;
  sort: { field: string; order: 'asc' | 'desc' };
  pageSize: number;
}
```

### Form Pages
```typescript
{
  activeTab: number;
  expandedSections: string[];
  showHints: boolean;
}
```

### Dashboard
```typescript
{
  widgets: string[];
  layout: Array<{id: string, x: number, y: number}>;
}
```

### Settings
```typescript
{
  theme: 'light' | 'dark';
  language: 'vi' | 'en';
  notifications: boolean;
}
```

---

## ⚠️ Common Mistakes

**❌ SAI:**
```typescript
// Tạo model riêng
class ProductListPreferences(models.Model): ...

// Tạo hook riêng
const useProductConfig = () => { ... }
```

**✅ ĐÚNG:**
```typescript
// Dùng chung cho mọi thứ
const { config } = useUserPreferences('any-page');

// Check before use
if (config?.field) useField(config.field);
```

---

## Benefits

- ✅ 1 model → Maintain 1 chỗ
- ✅ 1 API → Đơn giản
- ✅ 1 hook → Reuse mọi nơi
- ✅ Config tự do → Không giới hạn
- ✅ Mở rộng dễ → Thêm page không cần backend
