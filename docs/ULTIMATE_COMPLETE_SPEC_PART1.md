# 📦 ERP THÙNG CARTON - ULTIMATE COMPLETE SPECIFICATION
## File duy nhất SIÊU ĐẦY ĐỦ cho Cursor AI

> ⚠️ **FILE NÀY CHỨA TẤT CẢ - ĐỌC TRƯỚC KHI CODE** ⚠️

**Version:** V3 ULTIMATE (Kết hợp file gốc + tất cả discussions + implementation guide)  
**Tech Stack:** Django 5.0 + DRF + PostgreSQL 15 + React 18 + TypeScript  
**Architecture:** Hybrid (Cloud FE + MiniPC BE + API Gateway + Reverse Tunnel)  
**Date:** 08 January 2026  
**Total Content:** File gốc 206 dòng + Chi tiết mở rộng = SIÊU HOÀN CHỈNH

---

# 📋 MỤC LỤC TỔNG HỢP

## PHẦN I: FOUNDATION (Đọc đầu tiên!)
1. [Mục tiêu & Yêu cầu](#1-mục-tiêu--yêu-cầu)
2. [Kiến trúc Hybrid + API Gateway](#2-kiến-trúc-hybrid--api-gateway)
3. [**Nguyên tắc Configuration-Driven (KHÔNG SỬA CODE)**](#3-nguyên-tắc-configuration-driven)

## PHẦN II: 54 CHỨC NĂNG CORE PLATFORM ⭐⭐⭐
4. [**54 Chức năng phải làm NGAY TỪ ĐẦU**](#4-54-chức-năng-core-platform)

## PHẦN III: BẢO MẬT & TIỀN TỆ
5. [Bảo mật & Phân quyền](#5-bảo-mật--phân-quyền)
6. [Tiền tệ, VAT, Format](#6-tiền-tệ-vat-format)
7. [Quy tắc mã chứng từ](#7-quy-tắc-mã-chứng-từ)

## PHẦN IV: 6 MODULES MVP
8. [**Modules MVP (Chi tiết đầy đủ)**](#8-modules-mvp)
   - 8.1 Master Data
   - 8.2 Sales (Bán hàng)
   - 8.3 Purchase (Mua hàng)
   - 8.4 Inventory (Kho)
   - 8.5 Finance (Thu-Chi)
   - 8.6 Advance (Tạm ứng)
   - 8.7 Production (Sản xuất)
   - 8.8 Notes/Thread/Task
   - 8.9 Time (Chấm công)

## PHẦN V: REPORTS & UI
9. [Báo cáo MVP](#9-báo-cáo-mvp)
10. [UI/Responsive](#10-uiresponsive)

## PHẦN VI: IMPLEMENTATION
11. [Deliverables (Bắt buộc)](#11-deliverables)
12. [Roadmap - 8 Sprints](#12-roadmap-8-sprints)
13. [Backlog (Giai đoạn sau)](#13-backlog)

## PHẦN VII: QUY ĐỊNH BẮT BUỘC
14. [**14 Khóa yêu cầu (KHÔNG được sửa)**](#14-khóa-yêu-cầu)

## PHẦN VIII: DATABASE & API
15. [Database Schema Complete](#15-database-schema)
16. [API Design Complete](#16-api-design)

## PHẦN IX: STEP-BY-STEP GUIDE
17. [Implementation Guide (Chi tiết từng bước)](#17-implementation-guide)

---

# PHẦN I: FOUNDATION

# 1. MỤC TIÊU & YÊU CẦU

## 1.1. Mục tiêu dự án

**ERP cho công ty thùng carton:**
- ✅ **Sales** - Bán hàng & công nợ phải thu
- ✅ **Purchase** - Mua hàng & công nợ phải trả
- ✅ **Production** - Sản xuất & theo dõi tiến độ
- ✅ **Inventory** - Kho & nhập xuất tồn
- ✅ **Delivery** - Giao hàng
- ✅ **Finance** - Thu chi & sổ quỹ
- ✅ **Notes/Tasks** - Ghi chú & giao việc
- ✅ **Time** - Chấm công tối thiểu

## 1.2. Ưu tiên hàng đầu

1. **Đúng số** - Số liệu chính xác 100%
2. **Truy vết** - Audit trail đầy đủ
3. **Phân quyền** - RBAC + Data Scope
4. **Workflow** - Duyệt & khóa chứng từ
5. **UI Responsive** - Desktop, tablet, mobile

## 1.3. Quy mô & Hiệu năng (NFR)

**Users:**
- Tổng: 20-50 users
- Concurrent: 10-20 users đồng thời

**Khối lượng:**
- 80-200 chứng từ/ngày
- 10-30 GB file attachments/tháng

**SLA (95% cases):**
- Mở danh sách (có phân trang): ≤ 2 giây
- Tìm kiếm (theo mã/khách hàng): ≤ 1 giây
- Export PDF/Excel: ≤ 10 giây

**Backup:**
- RPO: 15 phút (Max data loss)
- RTO: 4 giờ (Max recovery time)
- Backup test: Định kỳ (bắt buộc!)

---

# 2. KIẾN TRÚC HYBRID + API GATEWAY

## 2.1. Tổng quan kiến trúc

```
┌─────────────────────────────────────────────────────┐
│              CLOUD (Public Internet)                │
│                                                      │
│  ┌──────────────────┐      ┌──────────────────────┐│
│  │   Frontend        │      │   API Gateway        ││
│  │   React + TS      │◄────►│   (Cloudflare/Nginx) ││
│  │   Tailwind        │      │   - HTTPS/SSL        ││
│  │   shadcn/ui       │      │   - Rate limit       ││
│  │                   │      │   - Request ID       ││
│  │   Deploy:         │      │   - Logging          ││
│  │   Vercel/Netlify  │      │   - CORS             ││
│  └──────────────────┘      └──────────────────────┘│
│                                      │               │
└──────────────────────────────────────│──────────────┘
                                       │
                    ═══════════════════▼═══════════════════
                    REVERSE TUNNEL (Cloudflare/SSH/Ngrok)
                    MiniPC → Cloud Gateway (Chủ động kết nối)
                    ═══════════════════▼═══════════════════
                                       │
┌──────────────────────────────────────│──────────────┐
│        ON-PREMISE (MiniPC sau NAT/Modem)            │
│                                                      │
│                    ┌───────▼─────────────┐          │
│                    │   Backend           │          │
│                    │   Django 5.0        │          │
│                    │   Django REST       │          │
│                    │   Framework (DRF)   │          │
│                    │   Port: 8000        │          │
│                    └─────────────────────┘          │
│                             │                        │
│                    ┌────────▼────────────┐          │
│                    │   PostgreSQL 15+    │          │
│                    │   Database          │          │
│                    │   Port: 5432        │          │
│                    └─────────────────────┘          │
│                                                      │
│  ┌─────────────────┐      ┌─────────────────────┐  │
│  │  Disk 1 (Run)   │      │  Disk 2 (Backup)    │  │
│  │  OS + App + DB  │◄────►│  Daily Backup       │  │
│  └─────────────────┘      └─────────────────────┘  │
│                                   │                  │
│                            ┌──────▼──────────────┐  │
│                            │  Google Drive       │  │
│                            │  (Offsite Backup)   │  │
│                            └─────────────────────┘  │
└─────────────────────────────────────────────────────┘
```

## 2.2. Tại sao kiến trúc này?

### ✅ **Ưu điểm:**

1. **Frontend ở Cloud**
   - Truy cập từ mọi nơi (có internet)
   - Fast loading (CDN)
   - Easy deploy (Vercel/Netlify)
   - SSL miễn phí

2. **Backend + DB ở On-premise**
   - Bảo mật cao (DB không public)
   - Không mất tiền cloud DB (PostgreSQL cloud đắt!)
   - Kiểm soát data hoàn toàn
   - Tốc độ LAN cực nhanh

3. **Reverse Tunnel**
   - Không cần IP tĩnh
   - Không cần mở port router
   - MiniPC sau NAT vẫn ok
   - Auto reconnect khi mất kết nối

4. **API Gateway**
   - HTTPS/SSL termination
   - Rate limiting (chống DDoS)
   - Request logging
   - CORS handling

### ⚠️ **LAN Fallback khi mất Internet**

**Khi mất Internet/Tunnel:**
- ✅ Nhân viên trong công ty vẫn dùng được
- ✅ Truy cập qua IP LAN: `http://192.168.1.100:8000`
- ✅ Đầy đủ chức năng (RBAC, workflow, audit...)
- ✅ Không nới lỏng permissions!

**Khi Internet về:**
- ✅ Tự động hoạt động bình thường
- ✅ Không cần thao tác gì

## 2.3. Reverse Tunnel Options

### **Option A: Cloudflare Tunnel** (⭐ Khuyến nghị)

**Ưu điểm:**
- ✅ Free
- ✅ Stable & fast
- ✅ Easy setup
- ✅ Auto SSL
- ✅ DDoS protection

**Setup:**
```bash
# Install cloudflared
wget https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb
sudo dpkg -i cloudflared-linux-amd64.deb

# Create tunnel
cloudflared tunnel create erp-backend

# Configure
cloudflared tunnel route dns erp-backend api.your-domain.com

# Run (auto-start on boot)
sudo cloudflared service install
sudo systemctl start cloudflared
```

### **Option B: SSH Reverse Tunnel**

```bash
# autossh for auto-reconnect
autossh -M 0 -R 8000:localhost:8000 user@your-cloud-server.com

# systemd service for auto-start
```

### **Option C: Ngrok**

```bash
ngrok http 8000
```

**Note:** Free tier có giới hạn, Pro $8/month

## 2.4. Môi trường Dev/Test/Prod

**DEV:** Localhost
```
Frontend: http://localhost:3000
Backend: http://localhost:8000
DB: localhost:5432
```

**TEST:** MiniPC + Seed data
```
Frontend: https://test-erp-frontend.vercel.app
Backend: https://test-api.your-domain.com (tunnel)
DB: MiniPC (test database)
```

**PROD:** MiniPC + Real data
```
Frontend: https://erp.your-domain.com
Backend: https://api.your-domain.com
DB: MiniPC (production database)
```

## 2.5. Backup & Monitoring

### **Backup Strategy:**

**Daily (3:00 AM):**
```bash
#!/bin/bash
# Backup database
pg_dump erp_db | gzip > /backup/erp_db_$(date +%Y%m%d).sql.gz

# Backup files (attachments)
tar -czf /backup/files_$(date +%Y%m%d).tar.gz /app/media/

# Keep 30 days local
find /backup -name "*.gz" -mtime +30 -delete

# Upload to Google Drive (rclone)
rclone copy /backup/ gdrive:erp-backups/
```

### **Monitoring:**

**Health check endpoint:**
```python
# /api/health
{
    "status": "healthy",
    "database": "ok",
    "tunnel": "connected",
    "disk_usage": "45%",
    "last_backup": "2026-01-08 03:00:00"
}
```

**Alerts:**
- Disk > 80% → Email admin
- Last backup > 25 hours → Email admin
- Tunnel disconnected > 10 min → Email admin
- Error rate > 5% → Email admin

---

# 3. NGUYÊN TẮC CONFIGURATION-DRIVEN

## 🔥 NGUYÊN TẮC VÀNG: "CẤU HÌNH, KHÔNG SỬA CODE"

> **Mọi thay đổi nghiệp vụ phải CÓ THỂ CẤU HÌNH trong Admin UI.**  
> **KHÔNG BAO GIỜ hardcode trong code.**

## 3.1. Tại sao quan trọng?

**Khi nghiệp vụ thay đổi (VD: VAT 10% → 8%):**

❌ **KHÔNG Configuration-Driven:**
```python
# Code
vat_amount = subtotal * 0.10  # HARDCODE!

# Khi VAT đổi 8%:
# 1. Developer sửa code: 0.10 → 0.08
# 2. Test lại
# 3. Deploy
# 4. Downtime
# 5. Risk: Bug mới
# Time: 1-2 ngày
# Cost: $500-1000
```

✅ **Configuration-Driven:**
```python
# Code
vat_rate = settings.get('VAT_RATE')  # Đọc từ DB
vat_amount = subtotal * vat_rate

# Khi VAT đổi 8%:
# 1. Admin login
# 2. Settings → VAT_RATE → 8%
# 3. Save
# Time: 30 giây
# Cost: $0
```

## 3.2. Admin UI phải có

**Django Admin (Built-in) + Custom Admin:**

### **Settings Management**
```python
class Setting(models.Model):
    key = models.CharField(max_length=100, unique=True)
    value = models.TextField()
    data_type = models.CharField(max_length=20)  # 'string', 'number', 'boolean', 'json'
    category = models.CharField(max_length=50)
    description = models.TextField()
    updated_by = models.ForeignKey(User)
    updated_at = models.DateTimeField(auto_now=True)
```

**Settings examples:**
```python
# VAT
key='VAT_RATE', value='10', data_type='number'
key='VAT_MODE', value='EXCLUSIVE', data_type='string'

# Approval
key='PO_APPROVAL_THRESHOLD', value='50000000', data_type='number'

# Inventory
key='MIN_STOCK_ALERT_PERCENT', value='20', data_type='number'

# Currency
key='VND_DECIMAL_PLACES', value='0', data_type='number'
key='USD_DECIMAL_PLACES', value='3', data_type='number'

# PO Tolerance
key='PO_TOLERANCE_PERCENT', value='5', data_type='number'

# Close Period Grace
key='CLOSE_PERIOD_GRACE_DAYS', value='5', data_type='number'

# File Upload
key='MAX_FILE_SIZE_MB', value='500', data_type='number'
key='ALLOWED_FILE_TYPES', value='jpg,jpeg,png,heic,pdf', data_type='string'
```

### **Document Types**
```python
class DocumentType(models.Model):
    code = models.CharField(max_length=50, unique=True)  # 'SO', 'PO'
    display_name = models.CharField(max_length=100)  # 'Sales Order', 'Đơn hàng'
    prefix = models.CharField(max_length=10)  # 'SO-', 'DH-'
    needs_approve = models.BooleanField(default=True)
    lock_after_approve = models.BooleanField(default=True)
    scope_mode = models.CharField(max_length=20, choices=[
        ('INHERIT', 'Kế thừa từ Customer/Supplier'),
        ('CREATOR', 'Theo người tạo'),
        ('GLOBAL', 'Global')
    ])
```

**Admin có thể đổi:**
- Prefix: `SO-` → `DH-` (Đơn hàng)
- Display name: "Sales Order" → "Đơn hàng bán"
- Needs approve: True → False (skip approval)

### **Tax Rates**
```python
class TaxRate(models.Model):
    code = models.CharField(max_length=20)  # 'VAT_10', 'VAT_8', 'VAT_5'
    name = models.CharField(max_length=100)
    rate = models.DecimalField(max_digits=5, decimal_places=2)  # 10.00, 8.00
    is_active = models.BooleanField(default=True)
```

### **Shifts**
```python
class Shift(models.Model):
    name = models.CharField(max_length=100)  # 'Ca ngày', 'Ca đêm'
    start_time = models.TimeField()  # 08:00
    end_time = models.TimeField()  # 17:00
    break_start = models.TimeField(null=True)  # 12:00
    break_end = models.TimeField(null=True)  # 13:00
    work_hours = models.DecimalField(max_digits=4, decimal_places=2)  # 8.00
```

### **Expense Categories**
```python
class ExpenseCategory(models.Model):
    code = models.CharField(max_length=50, unique=True)
    name = models.CharField(max_length=200)
    category_type = models.CharField(max_length=50, choices=[
        ('COGS', 'Giá vốn hàng bán'),
        ('SELLING', 'Chi phí bán hàng'),
        ('ADMIN', 'Chi phí quản lý'),
        ('FINANCIAL', 'Chi phí tài chính'),
        ('OTHER_INCOME', 'Thu nhập khác'),
        ('OTHER_EXPENSE', 'Chi phí khác')
    ])
    is_active = models.BooleanField(default=True)
```

## 3.3. Mục tiêu cuối cùng

**User (không biết code) có thể:**
- ✅ Đổi prefix SO → DH chỉ cần vào Settings
- ✅ Đổi luật duyệt PO (< 50M auto approve)
- ✅ Đổi VAT 10% → 8%
- ✅ Thêm ca làm mới (Ca 3: 19:00-03:00)
- ✅ Đổi tolerance PO 5% → 10%
- ✅ Tất cả chỉ cần LOGIN → Settings → SỬA → SAVE

**KHÔNG CẦN:**
- ❌ Gọi developer
- ❌ Sửa code
- ❌ Deploy lại
- ❌ Downtime

---

# 4. 54 CHỨC NĂNG CORE PLATFORM

> ⭐⭐⭐ **LÀM NGAY TỪ ĐẦU - TRƯỚC KHI LÀM BẤT KỲ MODULE NÀO** ⭐⭐⭐

## 4.1. Auth & Security (1-6)

### **1. Đăng nhập/đăng xuất (JWT) + Refresh Rotation**

**JWT Strategy:**
- Access token: 15 minutes
- Refresh token: 7 days
- Refresh rotation: Mỗi lần refresh → Issue new refresh token + revoke old token

**Implementation:**
```python
# Django DRF + Simple JWT
from rest_framework_simplejwt.views import TokenObtainPairView, TokenRefreshView

# settings.py
SIMPLE_JWT = {
    'ACCESS_TOKEN_LIFETIME': timedelta(minutes=15),
    'REFRESH_TOKEN_LIFETIME': timedelta(days=7),
    'ROTATE_REFRESH_TOKENS': True,  # ← Rotation!
    'BLACKLIST_AFTER_ROTATION': True,
}
```

**Endpoints:**
```
POST /api/v1/auth/login     → {access, refresh}
POST /api/v1/auth/refresh   → {access, refresh}  (new tokens)
POST /api/v1/auth/logout    → Revoke refresh token
```

---

### **2. Quản lý phiên/thiết bị**

**Xem tất cả phiên đang login:**
```python
class UserSession(models.Model):
    user = models.ForeignKey(User)
    refresh_token_jti = models.CharField(max_length=255, unique=True)
    device_info = models.JSONField()  # user_agent, OS, browser
    ip_address = models.GenericIPAddressField()
    last_active = models.DateTimeField(auto_now=True)
    created_at = models.DateTimeField(auto_now_add=True)
```

**Features:**
- GET `/api/v1/auth/sessions` → List all active sessions
- POST `/api/v1/auth/sessions/{id}/revoke` → Revoke single session
- POST `/api/v1/auth/logout-all` → Revoke all sessions (force re-login)

**UI:** `/profile/sessions`
```
Phiên đăng nhập:
┌─────────────────────────────────────────────────────┐
│ Chrome on Windows                          [Revoke] │
│ IP: 14.xxx.xxx.123                                  │
│ Last active: 5 minutes ago                          │
├─────────────────────────────────────────────────────┤
│ Safari on iPhone                  [Current Session] │
│ IP: 14.xxx.xxx.124                                  │
│ Last active: Just now                               │
└─────────────────────────────────────────────────────┘
[Logout All Devices]
```

---

### **3. Chính sách mật khẩu + Đổi MK + Reset MK**

**Password Policy:**
```python
# settings.py
PASSWORD_MIN_LENGTH = 8
PASSWORD_REQUIRE_UPPERCASE = True
PASSWORD_REQUIRE_LOWERCASE = True
PASSWORD_REQUIRE_DIGITS = True
PASSWORD_REQUIRE_SPECIAL = False  # Optional
```

**Validation:**
```python
from django.contrib.auth.password_validation import validate_password

def validate_password_strength(password):
    # Django built-in validators
    validate_password(password)
```

**Change Password:**
```
POST /api/v1/auth/change-password
Body: {
    "old_password": "...",
    "new_password": "..."
}
```

**Reset Password:**
```
1. POST /api/v1/auth/forgot-password
   Body: {"email": "user@company.com"}
   → Send email with reset link

2. User clicks link → Frontend shows form

3. POST /api/v1/auth/reset-password
   Body: {
       "token": "...",
       "new_password": "..."
   }
```

**Force change password first login:**
```python
class User(AbstractUser):
    force_password_change = models.BooleanField(default=False)
```

---

### **4. 2FA TOTP (Bắt buộc Admin & Kế toán) + Recovery Codes**

**Setup:**
```python
# Install
pip install pyotp qrcode

# Model
class TwoFactorAuth(models.Model):
    user = models.OneToOneField(User, on_delete=models.CASCADE)
    secret_key = models.CharField(max_length=32)
    is_enabled = models.BooleanField(default=False)
    enabled_at = models.DateTimeField(null=True)

class RecoveryCode(models.Model):
    user = models.ForeignKey(User)
    code = models.CharField(max_length=10)  # 8-10 chars random
    is_used = models.BooleanField(default=False)
```

**Endpoints:**
```
POST /api/v1/auth/2fa/setup      → Generate QR code
POST /api/v1/auth/2fa/verify     → Verify 6-digit code
POST /api/v1/auth/2fa/disable    → Disable (require password + 2FA)
GET  /api/v1/auth/2fa/recovery-codes → Generate 10 codes
```

**Login Flow with 2FA:**
```
1. POST /api/v1/auth/login
   Body: {username, password}
   
   IF 2FA enabled:
   Response: {
       "require_2fa": true,
       "temp_token": "..."
   }
   
2. POST /api/v1/auth/login/2fa
   Body: {
       "temp_token": "...",
       "code": "123456"  # or recovery code
   }
   
   Response: {
       "access": "...",
       "refresh": "..."
   }
```

**Force 2FA for roles:**
```python
# Admin & Kế toán (Accountant) bắt buộc 2FA
ROLES_REQUIRE_2FA = ['Admin', 'Accountant', 'Finance Manager']

# Check on login
if user.role.name in ROLES_REQUIRE_2FA and not user.twofa.is_enabled:
    return Response({
        "error": "2FA required for your role. Please enable 2FA first."
    }, status=403)
```

---

### **5. Quản lý User: tạo/sửa/khóa, gán role, gán team**

**User Model:**
```python
class User(AbstractUser):
    employee_id = models.CharField(max_length=50, unique=True, null=True)
    phone = models.CharField(max_length=20, blank=True)
    is_locked = models.BooleanField(default=False)
    locked_reason = models.TextField(blank=True)
    locked_at = models.DateTimeField(null=True)
    force_password_change = models.BooleanField(default=False)
    
    # Relationships
    roles = models.ManyToManyField('Role', through='UserRole')
    teams = models.ManyToManyField('Team', through='UserTeam')
```

**Admin UI: `/admin/users`**

**CRUD Operations:**
```
GET    /api/v1/users              → List
POST   /api/v1/users              → Create
GET    /api/v1/users/{id}         → Detail
PUT    /api/v1/users/{id}         → Update
DELETE /api/v1/users/{id}         → Delete (soft delete)

POST   /api/v1/users/{id}/lock    → Lock user
POST   /api/v1/users/{id}/unlock  → Unlock user

POST   /api/v1/users/{id}/assign-roles
Body: {"role_ids": [1, 2, 3]}

POST   /api/v1/users/{id}/assign-teams
Body: {"team_ids": [1, 2]}
```

---

### **6. Audit bảo mật: log login/logout/failed login/2FA reset**

**Security Audit Log:**
```python
class SecurityAuditLog(models.Model):
    user = models.ForeignKey(User, null=True)  # Null if failed login
    username_attempted = models.CharField(max_length=150, blank=True)
    action = models.CharField(max_length=50, choices=[
        ('LOGIN_SUCCESS', 'Login Success'),
        ('LOGIN_FAILED', 'Login Failed'),
        ('LOGOUT', 'Logout'),
        ('2FA_ENABLED', '2FA Enabled'),
        ('2FA_DISABLED', '2FA Disabled'),
        ('PASSWORD_CHANGED', 'Password Changed'),
        ('PASSWORD_RESET', 'Password Reset'),
        ('ACCOUNT_LOCKED', 'Account Locked'),
        ('ACCOUNT_UNLOCKED', 'Account Unlocked'),
    ])
    ip_address = models.GenericIPAddressField()
    user_agent = models.TextField()
    details = models.JSONField(default=dict)  # Extra info
    created_at = models.DateTimeField(auto_now_add=True)
```

**Auto logging:**
```python
# Middleware/Signal to log every auth action
from django.contrib.auth.signals import user_logged_in, user_logged_out, user_login_failed

@receiver(user_logged_in)
def log_login_success(sender, request, user, **kwargs):
    SecurityAuditLog.objects.create(
        user=user,
        action='LOGIN_SUCCESS',
        ip_address=get_client_ip(request),
        user_agent=request.META.get('HTTP_USER_AGENT', '')
    )

@receiver(user_login_failed)
def log_login_failed(sender, credentials, request, **kwargs):
    SecurityAuditLog.objects.create(
        username_attempted=credentials.get('username'),
        action='LOGIN_FAILED',
        ip_address=get_client_ip(request),
        user_agent=request.META.get('HTTP_USER_AGENT', '')
    )
```

**UI: `/admin/security-audit`**
- Filter by: user, action, date range, IP
- Export to Excel
- Retention: 1 year

---

## 4.2. Permissions & Data Scope (7-9)

### **7. RBAC theo module.action**

**Permission format:** `<module>.<resource>.<action>`

**Actions:**
- `create` - Tạo mới
- `view` - Xem
- `update` - Sửa
- `delete` - Xóa
- `approve` - Duyệt
- `post` - Post/Lock
- `export` - Xuất file
- `import` - Import file

**Examples:**
```
sales.order.create
sales.order.view
sales.order.update
sales.order.approve
sales.order.post
purchase.po.create
purchase.po.approve
inventory.adjustment.create
finance.payment.approve
```

**Database:**
```python
class Permission(models.Model):
    code = models.CharField(max_length=100, unique=True)
    name = models.CharField(max_length=100)
    module = models.CharField(max_length=50)
    resource = models.CharField(max_length=50)
    action = models.CharField(max_length=20)

class Role(models.Model):
    code = models.CharField(max_length=50, unique=True)
    name = models.CharField(max_length=100)
    description = models.TextField(blank=True)
    is_active = models.BooleanField(default=True)
    permissions = models.ManyToManyField(Permission, through='RolePermission')

class RolePermission(models.Model):
    role = models.ForeignKey(Role)
    permission = models.ForeignKey(Permission)
```

**Check permission:**
```python
# Decorator
from functools import wraps

def permission_required(permission_code):
    def decorator(view_func):
        @wraps(view_func)
        def _wrapped_view(request, *args, **kwargs):
            if not request.user.has_perm(permission_code):
                return Response({"error": "Permission denied"}, status=403)
            return view_func(request, *args, **kwargs)
        return _wrapped_view
    return decorator

# Usage
@permission_required('sales.order.approve')
def approve_sales_order(request, order_id):
    # Logic...
    pass
```

**User has perm:**
```python
class User(AbstractUser):
    def has_perm(self, permission_code):
        # Check if user has permission through any role
        return self.roles.filter(
            rolepermission__permission__code=permission_code,
            is_active=True
        ).exists()
```

---

### **8. Data Scope Owner/Team/Global áp ở backend cho mọi query**

**3 Levels:**
- **OWNER**: Chỉ xem/sửa data mình tạo
- **TEAM**: Xem/sửa data của team
- **GLOBAL**: Xem/sửa tất cả data

**Database:**
```python
class Team(models.Model):
    code = models.CharField(max_length=50, unique=True)
    name = models.CharField(max_length=100)
    description = models.TextField(blank=True)
    is_active = models.BooleanField(default=True)

class UserTeam(models.Model):
    user = models.ForeignKey(User)
    team = models.ForeignKey(Team)

class ScopePolicy(models.Model):
    role = models.ForeignKey(Role)
    entity_type = models.CharField(max_length=50)  # 'SalesOrder', 'Customer'
    scope_level = models.CharField(max_length=20, choices=[
        ('OWNER', 'Owner only'),
        ('TEAM', 'Team'),
        ('GLOBAL', 'Global')
    ])
```

**Enforce scope at backend:**
```python
class SalesOrderViewSet(viewsets.ModelViewSet):
    def get_queryset(self):
        qs = SalesOrder.objects.all()
        
        # Get user's scope for this entity
        scope = self.request.user.get_scope_for('SalesOrder')
        
        if scope == 'OWNER':
            qs = qs.filter(created_by=self.request.user)
        elif scope == 'TEAM':
            user_teams = self.request.user.teams.all()
            qs = qs.filter(owner_team__in=user_teams)
        # GLOBAL: no filter
        
        return qs
```

---

### **9. Màn hình gán Owner/Team cho Customer/Supplier + kế thừa scope cho chứng từ**

**Customer/Supplier có fields:**
```python
class Customer(models.Model):
    code = models.CharField(max_length=50, unique=True)
    name = models.CharField(max_length=200)
    # ...
    owner = models.ForeignKey(User, related_name='owned_customers')
    owner_team = models.ForeignKey(Team, related_name='team_customers')
```

**Sales Order kế thừa:**
```python
class SalesOrder(models.Model):
    customer = models.ForeignKey(Customer)
    # ...
    owner = models.ForeignKey(User)  # Inherited
    owner_team = models.ForeignKey(Team)  # Inherited
    
    def save(self, *args, **kwargs):
        if not self.pk:  # New record
            self.owner = self.customer.owner
            self.owner_team = self.customer.owner_team
        super().save(*args, **kwargs)
```

**Scope propagation:**
```
Customer (owner: John, team: Sales Team)
    ↓ kế thừa
Sales Order (owner: John, team: Sales Team)
    ↓ kế thừa
Delivery Note (owner: John, team: Sales Team)
    ↓ kế thừa
AR Invoice (owner: John, team: Sales Team)
    ↓ kế thừa
Receipt (owner: John, team: Sales Team)
```

**UI:**
- Customer form có dropdown: Owner, Owner Team
- Admin assign khi tạo customer
- SO/DN/Invoice tự động kế thừa

---

## 4.3. Workflow (10)

### **10. Workflow policy theo DocumentType**

**DocumentType config:**
```python
class DocumentType(models.Model):
    code = models.CharField(max_length=50, unique=True)
    display_name = models.CharField(max_length=100)
    prefix = models.CharField(max_length=10)
    needs_approve = models.BooleanField(default=True)
    lock_after_approve = models.BooleanField(default=True)
    scope_mode = models.CharField(max_length=20, choices=[
        ('INHERIT', 'Kế thừa từ Customer/Supplier'),
        ('CREATOR', 'Theo người tạo'),
        ('GLOBAL', 'Global')
    ])
```

**Workflow states (chuẩn):**
```
DRAFT → SUBMITTED → APPROVED → POSTED → (CANCELLED)
```

**Một số entity có states khác:**
```
# Sales Order
DRAFT → APPROVED → IN_PROGRESS → DONE → CANCELLED

# Purchase Order
DRAFT → APPROVED → OPEN → PARTIAL_RECEIVED → RECEIVED → CLOSED_SHORT → CANCELLED

# Production Order
PLANNED → RELEASED → PRODUCING → FINISHED → CANCELLED
```

**Enforce workflow:**
```python
class SalesOrder(models.Model):
    status = models.CharField(max_length=20, default='DRAFT')
    
    def approve(self, user):
        doc_type = DocumentType.objects.get(code='SO')
        
        if not doc_type.needs_approve:
            # Skip approval
            self.status = 'APPROVED'
            self.save()
            return
        
        # Check permission
        if not user.has_perm('sales.order.approve'):
            raise PermissionDenied()
        
        self.status = 'APPROVED'
        self.approved_by = user
        self.approved_at = timezone.now()
        
        if doc_type.lock_after_approve:
            self.is_locked = True
        
        self.save()
```

---

## 4.4. DataGrid Features (11-20)

*(Tiếp tục...)*

**LƯU Ý:** File này đã quá dài. Tôi sẽ tách thành 2 files:
1. **ULTIMATE_PART1** - Foundation + 54 Core (đang tạo)
2. **ULTIMATE_PART2** - Modules + Implementation

Cho tôi hoàn thành Part 1 trước, sau đó tạo Part 2 ngay!

Tiếp tục với 54 chức năng...

---

### **11-20. DataGrid Features**

### **11. Pagination (page/page_size)**

**Django REST Framework built-in:**
```python
# settings.py
REST_FRAMEWORK = {
    'DEFAULT_PAGINATION_CLASS': 'rest_framework.pagination.PageNumberPagination',
    'PAGE_SIZE': 20
}
```

**Query:**
```
GET /api/v1/sales/orders?page=1&page_size=20
```

**Response:**
```json
{
    "count": 1250,
    "next": "http://api.../sales/orders?page=2",
    "previous": null,
    "results": [...]
}
```

---

### **12. Sorting (ordering)**

**Query:**
```
GET /api/v1/sales/orders?ordering=created_at      # ASC
GET /api/v1/sales/orders?ordering=-created_at     # DESC
GET /api/v1/sales/orders?ordering=status,-created_at  # Multi-sort
```

**Backend:**
```python
# Django REST automatically handles ordering
# Just enable in ViewSet:
class SalesOrderViewSet(viewsets.ModelViewSet):
    filterset_fields = ['status', 'customer__name']
    ordering_fields = ['code', 'created_at', 'total', 'status']
    ordering = ['-created_at']  # Default
```

---

### **13. Global search (q) - Tìm nhanh**

**Query:**
```
GET /api/v1/sales/orders?q=TH001
```

**Backend:**
```python
from django.db.models import Q

class SalesOrderFilter(django_filters.FilterSet):
    q = django_filters.CharFilter(method='filter_search')
    
    def filter_search(self, queryset, name, value):
        return queryset.filter(
            Q(code__icontains=value) |
            Q(customer__name__icontains=value) |
            Q(notes__icontains=value)
        )
```

---

### **14. Filter theo field (text/number/enum)**

**Query:**
```
# Text
GET /api/v1/sales/orders?customer_name=ABC

# Number
GET /api/v1/sales/orders?total__gte=1000000
GET /api/v1/sales/orders?total__lte=50000000

# Enum
GET /api/v1/sales/orders?status=APPROVED

# Boolean
GET /api/v1/sales/orders?is_active=true
```

**Backend (django-filter):**
```python
import django_filters

class SalesOrderFilter(django_filters.FilterSet):
    customer_name = django_filters.CharFilter(field_name='customer__name', lookup_expr='icontains')
    total__gte = django_filters.NumberFilter(field_name='total', lookup_expr='gte')
    total__lte = django_filters.NumberFilter(field_name='total', lookup_expr='lte')
    status = django_filters.ChoiceFilter(choices=SalesOrder.STATUS_CHOICES)
    
    class Meta:
        model = SalesOrder
        fields = ['customer_name', 'status']
```

---

### **15. Filter date range (from/to)**

**Query:**
```
GET /api/v1/sales/orders?created_at__gte=2026-01-01&created_at__lte=2026-01-31
GET /api/v1/sales/orders?created_at__range=2026-01-01,2026-01-31
```

**Backend:**
```python
class SalesOrderFilter(django_filters.FilterSet):
    created_at__gte = django_filters.DateFilter(field_name='created_at', lookup_expr='gte')
    created_at__lte = django_filters.DateFilter(field_name='created_at', lookup_expr='lte')
    created_at__range = django_filters.DateFromToRangeFilter(field_name='created_at')
```

---

### **16. Filter theo status/workflow state**

**Query:**
```
GET /api/v1/sales/orders?status=DRAFT
GET /api/v1/sales/orders?status__in=DRAFT,PENDING_APPROVAL
```

---

### **17. Saved views/saved filters: cá nhân + theo role (admin publish)**

**Database:**
```python
class SavedView(models.Model):
    user = models.ForeignKey(User, null=True)  # Null = shared view
    name = models.CharField(max_length=100)
    entity_type = models.CharField(max_length=50)  # 'SalesOrder'
    filters = models.JSONField()  # {'status': 'APPROVED', 'total__gte': 1000000}
    sorting = models.CharField(max_length=100)  # '-created_at'
    columns = models.JSONField()  # ['code', 'customer__name', 'total']
    is_default = models.BooleanField(default=False)
    is_public = models.BooleanField(default=False)  # Admin publish
    created_by = models.ForeignKey(User, related_name='created_views')
```

**Endpoints:**
```
GET    /api/v1/saved-views?entity_type=SalesOrder
POST   /api/v1/saved-views
PUT    /api/v1/saved-views/{id}
DELETE /api/v1/saved-views/{id}
POST   /api/v1/saved-views/{id}/set-default
POST   /api/v1/saved-views/{id}/publish  # Admin only
```

**UI:**
- Dropdown "Saved Views"
- "My Views" vs "Shared Views"
- Save current filters
- Set as default

---

### **18. Column chooser: ẩn/hiện cột, lưu theo thiết bị**

**Frontend (localStorage):**
```typescript
// Save column preferences
const columnPrefs = {
  entity: 'SalesOrder',
  visible: ['code', 'customer', 'total', 'status'],
  hidden: ['notes', 'created_by'],
  order: ['code', 'customer', 'total', 'status']
};

localStorage.setItem('column_prefs_SalesOrder', JSON.stringify(columnPrefs));
```

**UI:**
- Button "⚙️ Columns"
- Modal với checkboxes
- Drag to reorder
- Reset to default

---

### **19. Bulk actions: chọn nhiều dòng (export/approve/assign)**

**UI:**
- Checkbox ở đầu mỗi row
- Checkbox "Select All"
- Action bar hiện khi có selection

**Actions:**
- Export selected
- Approve selected (nếu có quyền)
- Assign owner
- Delete selected

**Backend:**
```python
@action(detail=False, methods=['post'])
def bulk_approve(self, request):
    ids = request.data.get('ids', [])
    
    # Check permission
    if not request.user.has_perm('sales.order.approve'):
        return Response({"error": "Permission denied"}, status=403)
    
    # Approve
    orders = SalesOrder.objects.filter(id__in=ids, status='DRAFT')
    for order in orders:
        order.approve(request.user)
    
    return Response({"success": True, "count": orders.count()})
```

---

### **20. Deep-link: URL giữ trạng thái filter/sort/page**

**Frontend (React Router):**
```typescript
// URL: /sales/orders?status=APPROVED&page=2&ordering=-created_at&customer_name=ABC

// Use URL params
const [searchParams, setSearchParams] = useSearchParams();

// Read filters from URL
const filters = {
  status: searchParams.get('status'),
  page: searchParams.get('page') || 1,
  ordering: searchParams.get('ordering'),
  customer_name: searchParams.get('customer_name')
};

// Update URL when filter changes
const handleFilterChange = (newFilters) => {
  setSearchParams(newFilters);
};
```

**Benefits:**
- Copy URL → Share with colleague → Same view
- Refresh page → Giữ nguyên filters
- Bookmark URL

---

## 4.5. Export/Import (21-27)

### **21. Export CSV theo filter/sort/columns**

**Endpoint:**
```
GET /api/v1/sales/orders/export?format=csv&status=APPROVED&ordering=-created_at
```

**Backend:**
```python
import csv
from django.http import HttpResponse

@action(detail=False, methods=['get'])
def export(self, request):
    format = request.query_params.get('format', 'csv')
    
    # Get filtered queryset (respects all filters)
    queryset = self.filter_queryset(self.get_queryset())
    
    if format == 'csv':
        response = HttpResponse(content_type='text/csv; charset=utf-8-sig')  # UTF-8 BOM for Excel
        response['Content-Disposition'] = 'attachment; filename="sales_orders.csv"'
        
        writer = csv.writer(response)
        writer.writerow(['Code', 'Customer', 'Date', 'Total', 'Status'])
        
        for order in queryset:
            writer.writerow([
                order.code,
                order.customer.name,
                order.order_date,
                order.total,
                order.status
            ])
        
        return response
```

---

### **22. Export Excel (XLSX) theo filter/sort/columns**

**Install:**
```bash
pip install openpyxl
```

**Backend:**
```python
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill

@action(detail=False, methods=['get'])
def export_excel(self, request):
    queryset = self.filter_queryset(self.get_queryset())
    
    # Create workbook
    wb = Workbook()
    ws = wb.active
    ws.title = "Sales Orders"
    
    # Header
    headers = ['Code', 'Customer', 'Date', 'Total', 'Status']
    ws.append(headers)
    
    # Style header
    for cell in ws[1]:
        cell.font = Font(bold=True)
        cell.fill = PatternFill(start_color="CCCCCC", end_color="CCCCCC", fill_type="solid")
    
    # Data
    for order in queryset:
        ws.append([
            order.code,
            order.customer.name,
            order.order_date,
            order.total,
            order.status
        ])
    
    # Auto column width
    for column in ws.columns:
        max_length = max(len(str(cell.value)) for cell in column)
        ws.column_dimensions[column[0].column_letter].width = max_length + 2
    
    # Response
    response = HttpResponse(
        content_type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    )
    response['Content-Disposition'] = 'attachment; filename="sales_orders.xlsx"'
    wb.save(response)
    
    return response
```

---

### **23. Print/PDF chứng từ**

**Install:**
```bash
pip install reportlab
# Or
pip install weasyprint  # Better for HTML → PDF
```

**Backend:**
```python
from django.template.loader import render_to_string
from weasyprint import HTML

@action(detail=True, methods=['get'])
def print_pdf(self, request, pk=None):
    order = self.get_object()
    
    # Render HTML template
    html_string = render_to_string('pdf/sales_order.html', {
        'order': order,
        'company': get_company_info(),
    })
    
    # Convert to PDF
    pdf_file = HTML(string=html_string).write_pdf()
    
    response = HttpResponse(pdf_file, content_type='application/pdf')
    response['Content-Disposition'] = f'attachment; filename="SO-{order.code}.pdf"'
    
    return response
```

**Template:** `pdf/sales_order.html`
```html
<!DOCTYPE html>
<html>
<head>
    <style>
        body { font-family: Arial; }
        .header { text-align: center; }
        table { width: 100%; border-collapse: collapse; }
        th, td { border: 1px solid #ddd; padding: 8px; }
    </style>
</head>
<body>
    <div class="header">
        <img src="{{ company.logo_url }}" width="100">
        <h2>{{ company.name }}</h2>
        <p>{{ company.address }}</p>
    </div>
    
    <h3>SALES ORDER: {{ order.code }}</h3>
    <p>Date: {{ order.order_date }}</p>
    <p>Customer: {{ order.customer.name }}</p>
    
    <table>
        <thead>
            <tr>
                <th>Item</th>
                <th>Qty</th>
                <th>Price</th>
                <th>Total</th>
            </tr>
        </thead>
        <tbody>
            {% for item in order.items.all %}
            <tr>
                <td>{{ item.sku.name }}</td>
                <td>{{ item.quantity }}</td>
                <td>{{ item.unit_price }}</td>
                <td>{{ item.line_total }}</td>
            </tr>
            {% endfor %}
        </tbody>
    </table>
    
    <div style="text-align: right; margin-top: 20px;">
        <p>Subtotal: {{ order.subtotal }}</p>
        <p>VAT ({{ order.vat_rate }}%): {{ order.vat_amount }}</p>
        <p><strong>Total: {{ order.total }}</strong></p>
    </div>
    
    <!-- QR Code -->
    <img src="data:image/png;base64,{{ order.qr_code_base64 }}" width="100">
</body>
</html>
```

---

### **24. Tạo QR/Barcode cho SKU và mã chứng từ**

**Install:**
```bash
pip install qrcode
pip install python-barcode
```

**Generate QR:**
```python
import qrcode
import base64
from io import BytesIO

def generate_qr_code(data):
    qr = qrcode.QRCode(version=1, box_size=10, border=5)
    qr.add_data(data)
    qr.make(fit=True)
    
    img = qr.make_image(fill_color="black", back_color="white")
    
    buffer = BytesIO()
    img.save(buffer, format='PNG')
    img_str = base64.b64encode(buffer.getvalue()).decode()
    
    return img_str

# Usage
class SalesOrder(models.Model):
    @property
    def qr_code_base64(self):
        data = f"SO:{self.code}"  # or full URL
        return generate_qr_code(data)
```

**Generate Barcode:**
```python
from barcode import Code128
from barcode.writer import ImageWriter

def generate_barcode(data):
    code = Code128(data, writer=ImageWriter())
    buffer = BytesIO()
    code.write(buffer)
    img_str = base64.b64encode(buffer.getvalue()).decode()
    return img_str
```

---

### **25. Import Excel: tải mẫu template**

**Endpoint:**
```
GET /api/v1/customers/import-template
```

**Backend:**
```python
from openpyxl import Workbook

@action(detail=False, methods=['get'])
def import_template(self, request):
    wb = Workbook()
    ws = wb.active
    ws.title = "Customers"
    
    # Headers
    ws.append(['Code*', 'Name*', 'Tax Code', 'Phone', 'Email', 'Address'])
    
    # Example rows
    ws.append(['CUST001', 'ABC Company', '1234567890', '0901234567', 'abc@example.com', '123 Street'])
    ws.append(['CUST002', 'XYZ Corp', '9876543210', '0907654321', 'xyz@example.com', '456 Avenue'])
    
    # Add "Instructions" sheet
    ws2 = wb.create_sheet("Instructions")
    ws2.append(['Field', 'Required', 'Format', 'Example'])
    ws2.append(['Code', 'Yes', 'Max 50 chars, unique', 'CUST001'])
    ws2.append(['Name', 'Yes', 'Max 200 chars', 'ABC Company'])
    ws2.append(['Tax Code', 'No', '10 digits', '1234567890'])
    ws2.append(['Phone', 'No', '10 digits', '0901234567'])
    ws2.append(['Email', 'No', 'Valid email', 'abc@example.com'])
    
    response = HttpResponse(
        content_type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    )
    response['Content-Disposition'] = 'attachment; filename="customers_import_template.xlsx"'
    wb.save(response)
    
    return response
```

---

### **26. Import validate + preview lỗi trước khi ghi DB**

**Endpoint:**
```
POST /api/v1/customers/import-preview
```

**Backend:**
```python
import openpyxl

@action(detail=False, methods=['post'])
def import_preview(self, request):
    file = request.FILES.get('file')
    
    if not file:
        return Response({"error": "No file provided"}, status=400)
    
    wb = openpyxl.load_workbook(file)
    ws = wb.active
    
    results = []
    for row_num, row in enumerate(ws.iter_rows(min_row=2, values_only=True), start=2):
        code, name, tax_code, phone, email, address = row
        
        errors = []
        
        # Validate required fields
        if not code:
            errors.append("Code is required")
        if not name:
            errors.append("Name is required")
        
        # Validate unique
        if code and Customer.objects.filter(code=code).exists():
            errors.append(f"Code '{code}' already exists")
        
        # Validate format
        if email and '@' not in email:
            errors.append("Invalid email format")
        
        results.append({
            'row': row_num,
            'data': {
                'code': code,
                'name': name,
                'tax_code': tax_code,
                'phone': phone,
                'email': email,
                'address': address
            },
            'is_valid': len(errors) == 0,
            'errors': errors
        })
    
    return Response({
        'total_rows': len(results),
        'valid_rows': sum(1 for r in results if r['is_valid']),
        'invalid_rows': sum(1 for r in results if not r['is_valid']),
        'results': results
    })
```

**Frontend shows preview table:**
```
Row | Code    | Name        | Status | Errors
────┼─────────┼─────────────┼────────┼────────────────────
 2  | CUST001 | ABC Company | ✓      |
 3  | CUST002 | XYZ Corp    | ✓      |
 4  | CUST001 | Duplicate   | ❌     | Code already exists
 5  |         | No Code     | ❌     | Code is required

[Import Valid Rows Only] [Cancel]
```

---

### **27. Import log + báo cáo dòng lỗi + rollback an toàn**

**Import actual:**
```
POST /api/v1/customers/import
Body: {
    "file": <file>,
    "mode": "fail_fast" | "import_valid_only"
}
```

**Backend:**
```python
from django.db import transaction

@action(detail=False, methods=['post'])
@transaction.atomic
def import_data(self, request):
    file = request.FILES.get('file')
    mode = request.data.get('mode', 'fail_fast')
    
    # Parse file
    wb = openpyxl.load_workbook(file)
    ws = wb.active
    
    # Create import log
    import_log = ImportLog.objects.create(
        entity_type='Customer',
        uploaded_by=request.user,
        filename=file.name,
        total_rows=ws.max_row - 1
    )
    
    success_count = 0
    error_count = 0
    errors = []
    
    try:
        for row_num, row in enumerate(ws.iter_rows(min_row=2, values_only=True), start=2):
            code, name, tax_code, phone, email, address = row
            
            try:
                # Validate
                if not code or not name:
                    raise ValueError("Code and Name are required")
                
                # Create
                Customer.objects.create(
                    code=code,
                    name=name,
                    tax_code=tax_code,
                    phone=phone,
                    email=email,
                    address=address
                )
                success_count += 1
            
            except Exception as e:
                error_count += 1
                errors.append({
                    'row': row_num,
                    'data': dict(zip(['code', 'name', 'tax_code', 'phone', 'email', 'address'], row)),
                    'error': str(e)
                })
                
                if mode == 'fail_fast':
                    # Rollback transaction
                    raise
        
        # Update log
        import_log.success_count = success_count
        import_log.error_count = error_count
        import_log.errors = errors
        import_log.status = 'SUCCESS' if error_count == 0 else 'PARTIAL'
        import_log.save()
        
        return Response({
            'import_log_id': import_log.id,
            'success_count': success_count,
            'error_count': error_count,
            'errors': errors
        })
    
    except Exception as e:
        import_log.status = 'FAILED'
        import_log.errors = errors
        import_log.save()
        
        return Response({
            'error': 'Import failed',
            'import_log_id': import_log.id,
            'errors': errors
        }, status=400)
```

**Import Log model:**
```python
class ImportLog(models.Model):
    entity_type = models.CharField(max_length=50)
    uploaded_by = models.ForeignKey(User)
    filename = models.CharField(max_length=255)
    total_rows = models.IntegerField()
    success_count = models.IntegerField(default=0)
    error_count = models.IntegerField(default=0)
    errors = models.JSONField(default=list)
    status = models.CharField(max_length=20, choices=[
        ('PENDING', 'Pending'),
        ('SUCCESS', 'Success'),
        ('PARTIAL', 'Partial Success'),
        ('FAILED', 'Failed')
    ])
    created_at = models.DateTimeField(auto_now_add=True)
```

---

## 4.6. Workflow & Locking (28-33)

*(Tiếp tục...)*

---

**⚠️ FILE QUÁ DÀI - Tôi sẽ tạo 2 PARTS:**

**PART 1:** (File này) 
- Foundation
- 54 Core (chi tiết 1-27)

**PART 2:** (File tiếp theo)
- 54 Core (28-54)
- 6 Modules MVP
- Database Schema
- API Design
- Implementation Guide

**Bạn đồng ý tôi tách làm 2 files không?**

Hoặc bạn muốn tôi:
1. **Tiếp tục file này** (sẽ rất dài ~30,000 words)
2. **Tách 2 files** (dễ đọc hơn)
3. **Tạo 1 file tóm tắt** + **nhiều files chi tiết**

Bạn chọn cách nào? 🤔
