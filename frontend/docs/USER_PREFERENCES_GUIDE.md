# USER PREFERENCES - HƯỚNG DẪN SỬ DỤNG

## 🎯 Mục đích
Lưu cấu hình người dùng - **CHUNG cho MỌI component/page**.

**Sử dụng được ở:**
- ✅ List pages (columns, filters, sort)
- ✅ Form pages (tabs, sections)
- ✅ Dashboard (widgets, layout)
- ✅ Settings (theme, language)
- ✅ Calendar (view mode)
- ✅ BẤT KỲ đâu cần lưu config!

## 🏗️ Kiến trúc

### Backend
- **Model:** `UserPreferences` (1 model cho TẤT CẢ)
- **API:** `/api/preferences/{page}/`

### Frontend
- **Hook:** `useUserPreferences(page)`

## 📝 Cách sử dụng

### Bước 1: Import
```typescript
import { useUserPreferences } from '../../hooks/useUserPreferences';
```

### Bước 2: Khai báo (tên page bất kỳ)
```typescript
// List
const { config, saveConfig } = useUserPreferences('products-list');

// Form
const { config, saveConfig } = useUserPreferences('products-form');

// Dashboard
const { config, saveConfig } = useUserPreferences('dashboard');

// Bất kỳ
const { config, saveConfig } = useUserPreferences('my-page');
```

### Bước 3: Load config
```typescript
useEffect(() => {
  if (config?.columns) setColumns(config.columns);
  if (config?.theme) setTheme(config.theme);
  // Load bất kỳ field nào
}, [config]);
```

### Bước 4: Save config
```typescript
await saveConfig({ 
  ...config, 
  anyField: anyValue 
});
```

## ✅ Examples

### List với columns
```typescript
const ProductList = () => {
  const { config, saveConfig } = useUserPreferences('products-list');
  const [columns, setColumns] = useState<string[]>([]);
  
  useEffect(() => {
    if (config?.columns) setColumns(config.columns);
  }, [config]);
  
  const toggleColumn = async (col: string) => {
    const newCols = columns.includes(col)
      ? columns.filter(c => c !== col)
      : [...columns, col];
    setColumns(newCols);
    await saveConfig({ ...config, columns: newCols });
  };
};
```

### Form với tabs
```typescript
const ProductForm = () => {
  const { config, saveConfig } = useUserPreferences('products-form');
  const [tab, setTab] = useState(0);
  
  useEffect(() => {
    if (config?.activeTab !== undefined) {
      setTab(config.activeTab);
    }
  }, [config]);
  
  const changeTab = async (newTab: number) => {
    setTab(newTab);
    await saveConfig({ ...config, activeTab: newTab });
  };
};
```

### Settings với theme
```typescript
const Settings = () => {
  const { config, saveConfig } = useUserPreferences('settings');
  
  const changeTheme = async (theme: string) => {
    document.body.className = theme;
    await saveConfig({ ...config, theme });
  };
};
```

## 🚫 Lỗi thường gặp

### ❌ Tạo model/hook riêng
```typescript
// SAI!
const useProductConfig = () => { ... }
```

### ❌ Không check null
```typescript
// SAI!
setColumns(config.columns);  // config có thể null!
```

### ✅ Đúng
```typescript
// ĐÚNG!
if (config?.columns) setColumns(config.columns);
```

## 🎯 Use Cases

### Nhớ filter
```typescript
const { config, saveConfig } = useUserPreferences('products-list');

useEffect(() => {
  if (config?.lastFilter) applyFilter(config.lastFilter);
}, [config]);

const handleFilter = async (filter: any) => {
  await saveConfig({ ...config, lastFilter: filter });
};
```

### Nhớ view mode
```typescript
const { config, saveConfig } = useUserPreferences('orders-view');

const changeView = async (view: 'list' | 'grid' | 'calendar') => {
  await saveConfig({ ...config, viewMode: view });
};
```

### Nhớ expanded sections
```typescript
const { config, saveConfig } = useUserPreferences('search');

const toggleSection = async (section: string) => {
  const expanded = config?.expandedSections || [];
  const newExpanded = expanded.includes(section)
    ? expanded.filter(s => s !== section)
    : [...expanded, section];
  await saveConfig({ ...config, expandedSections: newExpanded });
};
```

## 🔧 Troubleshooting

- Config không load → Check user login, page name
- Config không save → Check await, Network tab
- Lỗi undefined → Luôn check `config?.field`

## 📚 Tham khảo
- Pattern doc: `frontend/docs/PATTERNS.md`
- Hook: `frontend/src/hooks/useUserPreferences.ts`
