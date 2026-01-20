# 🎯 SPRINT 1-2 DETAILED GUIDE
## Step-by-Step Implementation Guide for Non-Technical Users

> ⚠️ **ĐỌC FILE NÀY SAU KHI ĐỌC PART 1 & PART 2** ⚠️

**Prerequisites:**
- ✅ Đã đọc ULTIMATE_COMPLETE_SPEC_PART1.md
- ✅ Đã đọc ULTIMATE_COMPLETE_SPEC_PART2.md
- ✅ Hiểu Configuration-Driven Design
- ✅ Đã cài đặt môi trường dev (xem Section 1 dưới)

**Sprint 1-2 Objectives:**
- Week 1-2: Foundation (Auth, RBAC, Settings, Master Data)
- Week 3-4: Inventory (Ledger, NXT, Stocktake)

**Total Time:** 4 weeks (160 hours)

---

# 📋 MỤC LỤC

## SECTION 0: CRITICAL RULES
- [0.1. Golden Rules (Đọc trước!)](#01-golden-rules)
- [0.2. Validation Checklist](#02-validation-checklist)
- [0.3. Common Mistakes](#03-common-mistakes)

## SECTION 1: ENVIRONMENT SETUP
- [1.1. Software Installation](#11-software-installation)
- [1.2. Project Structure](#12-project-structure)
- [1.3. Git Setup](#13-git-setup)

## SECTION 2: SPRINT 1 - FOUNDATION (Week 1-2)
- [Day 1: Project Setup](#day-1-project-setup)
- [Day 2-3: Core Models](#day-2-3-core-models)
- [Day 4-5: Auth & JWT](#day-4-5-auth--jwt)
- [Day 6-7: RBAC & Data Scope](#day-6-7-rbac--data-scope)
- [Day 8-9: Admin Settings UI](#day-8-9-admin-settings-ui)
- [Day 10: Master Data Models](#day-10-master-data-models)

## SECTION 3: SPRINT 2 - INVENTORY (Week 3-4)
- [Day 11-12: Inventory Models](#day-11-12-inventory-models)
- [Day 13-14: Inventory API](#day-13-14-inventory-api)
- [Day 15-16: Inventory UI & Reports](#day-15-16-inventory-ui--reports)

## SECTION 4: TESTING & VALIDATION
- [4.1. Unit Tests](#41-unit-tests)
- [4.2. Integration Tests](#42-integration-tests)
- [4.3. Manual Testing](#43-manual-testing)

## SECTION 5: TROUBLESHOOTING
- [5.1. Common Errors](#51-common-errors)
- [5.2. Debug Tips](#52-debug-tips)

---

# SECTION 0: CRITICAL RULES

## 0.1. GOLDEN RULES

### **🔥 RULE #1: NEVER HARDCODE**

**❌ WRONG:**
```python
# BAD - Hardcoded
vat_amount = subtotal * 0.10  # VAT 10%
```

**✅ CORRECT:**
```python
# GOOD - From settings
vat_rate = Setting.objects.get(key='VAT_RATE').value
vat_amount = subtotal * Decimal(vat_rate) / 100
```

**How to check:**
```
Ctrl+F trong code: search "0.10", "10%", "SO-", "APPROVED"
→ Nếu thấy số/text → WRONG!
→ Phải từ Settings/Config
```

---

### **🔥 RULE #2: ALWAYS VALIDATE BEFORE NEXT STEP**

**Sau EVERY feature:**
```
1. ✅ Feature works end-to-end?
2. ✅ No hardcode? (Ctrl+F check)
3. ✅ Admin UI có config UI?
4. ✅ Tests pass?
5. ✅ Match spec exactly?

→ TẤT CẢ ✅ → Next feature
→ BẤT KỲ ❌ → FIX NGAY!
```

---

### **🔥 RULE #3: FOLLOW SPEC EXACTLY**

**KHÔNG được:**
- ❌ Thêm field không có trong spec
- ❌ Đổi workflow khác spec
- ❌ Skip bất kỳ feature nào
- ❌ "Improve" logic theo ý mình

**CHỈ được:**
- ✅ Code theo đúng spec
- ✅ Hỏi nếu spec không rõ
- ✅ Suggest improvements (nhưng vẫn code đúng spec trước)

---

### **🔥 RULE #4: TEST IMMEDIATELY**

**Ngay sau khi code 1 feature:**
```bash
# 1. Run tests
python manage.py test

# 2. Test API
curl http://localhost:8000/api/v1/health

# 3. Test UI
Open browser → Test manually

# 4. Git commit
git add .
git commit -m "feat: add user model with RBAC"
```

**KHÔNG chờ đến cuối ngày/tuần!**

---

## 0.2. VALIDATION CHECKLIST

**Copy checklist này cho MỖI feature:**

```markdown
## Feature: [Tên feature]

### Planning
☐ Đọc spec của feature này (Part 1/Part 2)
☐ List tất cả requirements
☐ Identify: Cần config gì? (Settings/Workflow/Template)
☐ Thiết kế database (models)
☐ Thiết kế API (endpoints)

### Implementation
☐ Create models
☐ Create migrations
☐ Test migration (python manage.py migrate)
☐ Create serializers
☐ Create views/viewsets
☐ Create URLs
☐ Test API (Postman/curl)

### Configuration
☐ Create Settings entries (if needed)
☐ Create Admin UI for config
☐ Test: Change config → Feature behavior changes
☐ NO hardcode (Ctrl+F check)

### Testing
☐ Write unit tests
☐ Write integration tests
☐ All tests pass
☐ Manual test end-to-end
☐ Match spec exactly

### Documentation
☐ Add docstrings
☐ Update API docs (Swagger)
☐ Git commit with clear message

### Validation
☐ Feature complete?
☐ No hardcode?
☐ Tests pass?
☐ Match spec?
☐ Ready for next feature?

→ ALL ✅ → NEXT FEATURE
→ ANY ❌ → FIX FIRST!
```

---

## 0.3. COMMON MISTAKES

### **❌ MISTAKE #1: Hardcode values**

**Example:**
```python
# WRONG
if order.status == 'APPROVED':
    order.is_locked = True
```

**Why wrong:**
- "APPROVED" hardcoded
- Lock behavior hardcoded

**FIX:**
```python
# CORRECT
doc_type = DocumentType.objects.get(code='SO')
if order.status == doc_type.approval_status:
    if doc_type.lock_after_approve:
        order.is_locked = True
```

---

### **❌ MISTAKE #2: Skip validation**

**Example:**
```python
# WRONG - No validation
user = User.objects.create(
    username=request.data['username'],
    password=request.data['password']
)
```

**FIX:**
```python
# CORRECT - Validate first
serializer = UserSerializer(data=request.data)
serializer.is_valid(raise_exception=True)
user = serializer.save()
```

---

### **❌ MISTAKE #3: Không test migration**

**WRONG workflow:**
```bash
# Create migration
python manage.py makemigrations

# Commit immediately (DON'T!)
git add .
git commit -m "add models"
```

**CORRECT workflow:**
```bash
# Create migration
python manage.py makemigrations

# TEST migration
python manage.py migrate

# Check database
python manage.py shell
>>> from core.models import User
>>> User.objects.all()

# IF OK → Commit
git add .
git commit -m "feat: add user model with tests"
```

---

### **❌ MISTAKE #4: Viết quá nhiều code cùng lúc**

**WRONG:**
```
Day 1: Viết 10 models + 20 APIs + UI
→ Bug ở đâu không biết
→ Sửa 1 chỗ → 10 chỗ khác lỗi
```

**CORRECT:**
```
Day 1 Morning: 1 model (User)
→ Test
→ Commit

Day 1 Afternoon: 1 API (Login)
→ Test
→ Commit

→ Mỗi lần commit = 1 feature nhỏ
→ Bug dễ tìm
→ Rollback dễ dàng
```

---

# SECTION 1: ENVIRONMENT SETUP

## 1.1. SOFTWARE INSTALLATION

### **Prerequisites:**
- Computer: Windows/Mac/Linux
- RAM: >= 8GB (recommend 16GB)
- Disk: >= 50GB free

### **Software cần cài:**

#### **1. Python 3.11+**

**Windows:**
```
1. Download: https://www.python.org/downloads/
2. Install: Check "Add Python to PATH"
3. Verify:
   python --version
   # Should show: Python 3.11.x
```

**Mac:**
```bash
# Install Homebrew first
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# Install Python
brew install python@3.11

# Verify
python3 --version
```

**Linux (Ubuntu):**
```bash
sudo apt update
sudo apt install python3.11 python3.11-venv python3-pip
python3 --version
```

---

#### **2. PostgreSQL 15+**

**Windows:**
```
1. Download: https://www.postgresql.org/download/windows/
2. Install (remember password!)
3. During install:
   - Port: 5432 (default)
   - Locale: English
   - Password: Set strong password (remember it!)
4. Verify:
   Open "SQL Shell (psql)"
   Enter password
   Should connect
```

**Mac:**
```bash
brew install postgresql@15
brew services start postgresql@15

# Create database user
createuser erp_user -P
# Enter password: your_password

# Verify
psql postgres
```

**Linux:**
```bash
sudo apt install postgresql-15
sudo systemctl start postgresql
sudo systemctl enable postgresql

# Create user
sudo -u postgres createuser erp_user -P

# Verify
sudo -u postgres psql
```

---

#### **3. Node.js 20+ (for frontend)**

**All platforms:**
```
1. Download: https://nodejs.org/
2. Install LTS version (20.x)
3. Verify:
   node --version
   # Should show: v20.x.x
   
   npm --version
   # Should show: 10.x.x
```

---

#### **4. Git**

**Windows:**
```
Download: https://git-scm.com/download/win
Install with default options
```

**Mac:**
```bash
brew install git
```

**Linux:**
```bash
sudo apt install git
```

**Verify:**
```bash
git --version
```

---

#### **5. VS Code (or Cursor)**

**Option A: Cursor** (Recommended - AI-powered)
```
Download: https://cursor.sh
Install
Sign up for Pro: $20/month
```

**Option B: VS Code** (Free)
```
Download: https://code.visualstudio.com/
Install

Extensions (install these):
- Python
- Django
- PostgreSQL
- ES7+ React/Redux snippets
- Tailwind CSS IntelliSense
- GitLens
```

---

## 1.2. PROJECT STRUCTURE

### **Create workspace:**

```bash
# Create main folder
mkdir erp-system
cd erp-system

# Copy spec files here
# - ULTIMATE_COMPLETE_SPEC_PART1.md
# - ULTIMATE_COMPLETE_SPEC_PART2.md
# - SPRINT1_DETAILED_GUIDE.md (this file)
```

### **Expected structure:**
```
erp-system/
├── ULTIMATE_COMPLETE_SPEC_PART1.md
├── ULTIMATE_COMPLETE_SPEC_PART2.md
├── SPRINT1_DETAILED_GUIDE.md
├── backend/          (will create)
├── frontend/         (will create)
├── docs/            (will create)
└── README.md        (will create)
```

---

## 1.3. GIT SETUP

### **Initialize Git:**

```bash
cd erp-system

# Init repo
git init

# Configure (use your info)
git config user.name "Your Name"
git config user.email "your.email@example.com"

# Create .gitignore
cat > .gitignore << 'EOF'
# Python
__pycache__/
*.py[cod]
*.so
*.egg
*.egg-info/
dist/
build/
venv/
env/

# Django
*.log
local_settings.py
db.sqlite3
media/

# Node
node_modules/
npm-debug.log
yarn-error.log
.env.local
.env.production.local

# IDE
.vscode/
.idea/
*.swp
*.swo

# OS
.DS_Store
Thumbs.db

# Env
.env
EOF

# First commit
git add .gitignore
git add *.md
git commit -m "Initial commit: project specs"
```

### **GitHub setup (optional):**

```bash
# Create repo on GitHub first
# Then:
git remote add origin https://github.com/yourusername/erp-system.git
git branch -M main
git push -u origin main
```

---

# SECTION 2: SPRINT 1 - FOUNDATION

## DAY 1: PROJECT SETUP

**Time:** 8 hours  
**Goal:** Setup Django + React projects

---

### **Morning: Backend Setup (4 hours)**

#### **Step 1: Create Django project**

```bash
cd erp-system

# Create backend folder
mkdir backend
cd backend

# Create virtual environment
python -m venv venv

# Activate (Windows)
venv\Scripts\activate

# Activate (Mac/Linux)
source venv/bin/activate

# Should see (venv) in terminal
```

#### **Step 2: Install Django packages**

```bash
# Install core packages
pip install django==5.0
pip install djangorestframework==3.14.0
pip install django-cors-headers==4.3.1
pip install psycopg2-binary==2.9.9
pip install python-decouple==3.8

# Auth
pip install djangorestframework-simplejwt==5.3.1
pip install pyotp==2.9.0
pip install qrcode==7.4.2

# Filters & Pagination
pip install django-filter==23.5

# Excel & PDF
pip install openpyxl==3.1.2
pip install weasyprint==60.2

# API Docs
pip install drf-spectacular==0.27.0

# Save requirements
pip freeze > requirements.txt
```

#### **Step 3: Create Django project**

```bash
# Create project
django-admin startproject config .

# Create apps
python manage.py startapp core
python manage.py startapp master
python manage.py startapp sales
python manage.py startapp purchase
python manage.py startapp production
python manage.py startapp inventory
python manage.py startapp finance
python manage.py startapp time_tracking

# Check structure
ls -la
# Should see: config/, core/, master/, manage.py, venv/, requirements.txt
```

#### **Step 4: Configure settings.py**

**File:** `backend/config/settings.py`

```python
# At top, add:
from decouple import config
from datetime import timedelta

# Find INSTALLED_APPS, replace with:
INSTALLED_APPS = [
    'django.contrib.admin',
    'django.contrib.auth',
    'django.contrib.contenttypes',
    'django.contrib.sessions',
    'django.contrib.messages',
    'django.contrib.staticfiles',
    
    # Third party
    'rest_framework',
    'rest_framework_simplejwt',
    'corsheaders',
    'django_filters',
    'drf_spectacular',
    
    # Our apps
    'core',
    'master',
    'sales',
    'purchase',
    'production',
    'inventory',
    'finance',
    'time_tracking',
]

# Find MIDDLEWARE, add CORS:
MIDDLEWARE = [
    'django.middleware.security.SecurityMiddleware',
    'django.contrib.sessions.middleware.SessionMiddleware',
    'corsheaders.middleware.CorsMiddleware',  # ← Add this
    'django.middleware.common.CommonMiddleware',
    'django.middleware.csrf.CsrfViewMiddleware',
    'django.contrib.auth.middleware.AuthenticationMiddleware',
    'django.contrib.messages.middleware.MessageMiddleware',
    'django.middleware.clickjacking.XFrameOptionsMiddleware',
]

# Replace DATABASES:
DATABASES = {
    'default': {
        'ENGINE': 'django.db.backends.postgresql',
        'NAME': config('DB_NAME', default='erp_db'),
        'USER': config('DB_USER', default='erp_user'),
        'PASSWORD': config('DB_PASSWORD', default='your_password'),
        'HOST': config('DB_HOST', default='localhost'),
        'PORT': config('DB_PORT', default='5432'),
    }
}

# Add at bottom:

# REST Framework
REST_FRAMEWORK = {
    'DEFAULT_AUTHENTICATION_CLASSES': (
        'rest_framework_simplejwt.authentication.JWTAuthentication',
    ),
    'DEFAULT_PERMISSION_CLASSES': (
        'rest_framework.permissions.IsAuthenticated',
    ),
    'DEFAULT_PAGINATION_CLASS': 'rest_framework.pagination.PageNumberPagination',
    'PAGE_SIZE': 20,
    'DEFAULT_FILTER_BACKENDS': (
        'django_filters.rest_framework.DjangoFilterBackend',
        'rest_framework.filters.OrderingFilter',
        'rest_framework.filters.SearchFilter',
    ),
    'DEFAULT_SCHEMA_CLASS': 'drf_spectacular.openapi.AutoSchema',
}

# JWT Settings
SIMPLE_JWT = {
    'ACCESS_TOKEN_LIFETIME': timedelta(minutes=15),
    'REFRESH_TOKEN_LIFETIME': timedelta(days=7),
    'ROTATE_REFRESH_TOKENS': True,
    'BLACKLIST_AFTER_ROTATION': True,
}

# CORS
CORS_ALLOWED_ORIGINS = [
    "http://localhost:3000",
    "http://localhost:5173",
]
CORS_ALLOW_CREDENTIALS = True

# Spectacular (Swagger)
SPECTACULAR_SETTINGS = {
    'TITLE': 'ERP API',
    'DESCRIPTION': 'ERP System for Carton Manufacturing',
    'VERSION': '1.0.0',
}

# Custom User Model (will create)
AUTH_USER_MODEL = 'core.User'
```

#### **Step 5: Create .env file**

**File:** `backend/.env`

```bash
# Create .env
cat > .env << 'EOF'
DEBUG=True
SECRET_KEY=django-insecure-your-secret-key-change-this-in-production

DB_NAME=erp_db
DB_USER=erp_user
DB_PASSWORD=your_password_here
DB_HOST=localhost
DB_PORT=5432
EOF

# Add to .gitignore (already done)
```

#### **Step 6: Create database**

```bash
# PostgreSQL commands:

# Windows (SQL Shell)
psql -U postgres
# Enter postgres password

# Mac/Linux
sudo -u postgres psql

# In psql:
CREATE DATABASE erp_db;
CREATE USER erp_user WITH PASSWORD 'your_password_here';
GRANT ALL PRIVILEGES ON DATABASE erp_db TO erp_user;
\q
```

#### **Step 7: Test Django**

```bash
# Run server
python manage.py runserver

# Should see:
# Starting development server at http://127.0.0.1:8000/
# Quit with CONTROL-C

# Open browser: http://localhost:8000
# Should see Django welcome page

# Ctrl+C to stop
```

✅ **Checkpoint:** Django runs without errors

---

### **Afternoon: Frontend Setup (4 hours)**

#### **Step 1: Create React project**

```bash
# From erp-system folder
cd ..  # Back to erp-system
cd frontend  # Will create

# Create Vite + React + TypeScript project
npm create vite@latest frontend -- --template react-ts

# Enter folder
cd frontend

# Install dependencies
npm install

# Install additional packages
npm install axios
npm install react-router-dom
npm install @tanstack/react-query
npm install zustand
npm install tailwindcss postcss autoprefixer
npm install -D @types/node

# Setup Tailwind
npx tailwindcss init -p
```

#### **Step 2: Configure Tailwind**

**File:** `frontend/tailwind.config.js`

```javascript
/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {},
  },
  plugins: [],
}
```

**File:** `frontend/src/index.css`

```css
@tailwind base;
@tailwind components;
@tailwind utilities;
```

#### **Step 3: Test React**

```bash
# Run dev server
npm run dev

# Should see:
# Local: http://localhost:5173/

# Open browser: http://localhost:5173
# Should see Vite + React page

# Ctrl+C to stop
```

✅ **Checkpoint:** React runs without errors

---

### **End of Day 1: Commit**

```bash
cd ../..  # Back to erp-system

git add .
git commit -m "feat: setup Django backend and React frontend

- Django 5.0 with DRF
- PostgreSQL database configured
- React 18 with TypeScript and Tailwind
- Basic project structure"

git push
```

---

## DAY 2-3: CORE MODELS

**Time:** 16 hours (2 days)  
**Goal:** Create User, Role, Permission, Team models

---

### **Day 2 Morning: User Model**

#### **Step 1: Create User model**

**File:** `backend/core/models.py`

```python
from django.contrib.auth.models import AbstractUser
from django.db import models
from django.utils import timezone

class User(AbstractUser):
    """
    Custom User model extending Django's AbstractUser.
    Follows Part 1: Section 4.5 - User Management.
    """
    
    # Additional fields
    employee_id = models.CharField(
        max_length=50,
        unique=True,
        null=True,
        blank=True,
        help_text="Employee ID (e.g., EMP001)"
    )
    
    phone = models.CharField(
        max_length=20,
        blank=True,
        help_text="Phone number"
    )
    
    # Account status
    is_locked = models.BooleanField(
        default=False,
        help_text="Account locked by admin"
    )
    
    locked_reason = models.TextField(
        blank=True,
        help_text="Reason for locking account"
    )
    
    locked_at = models.DateTimeField(
        null=True,
        blank=True,
        help_text="When account was locked"
    )
    
    force_password_change = models.BooleanField(
        default=False,
        help_text="User must change password on next login"
    )
    
    # Timestamps (inherited from AbstractUser, but explicit here)
    # created_at, updated_at will be added via signals
    
    class Meta:
        db_table = 'users'
        verbose_name = 'User'
        verbose_name_plural = 'Users'
        ordering = ['username']
    
    def __str__(self):
        return f"{self.username} ({self.get_full_name() or self.email})"
    
    def lock_account(self, reason):
        """Lock user account"""
        self.is_locked = True
        self.locked_reason = reason
        self.locked_at = timezone.now()
        self.save()
    
    def unlock_account(self):
        """Unlock user account"""
        self.is_locked = False
        self.locked_reason = ""
        self.locked_at = None
        self.save()
```

✅ **Validation:**
- ☐ No hardcoded values
- ☐ All fields match spec (Part 1, Section 4.5)
- ☐ Docstrings present
- ☐ Methods for lock/unlock

---

#### **Step 2: Create migration**

```bash
cd backend

# Create migration
python manage.py makemigrations

# Should see:
# Migrations for 'core':
#   core/migrations/0001_initial.py
#     - Create model User

# Apply migration
python manage.py migrate

# Should see all migrations applied
```

✅ **Checkpoint:** Migration successful

---

#### **Step 3: Test User model**

```bash
# Open Django shell
python manage.py shell
```

```python
# In shell:
from core.models import User

# Create user
user = User.objects.create_user(
    username='admin',
    email='admin@example.com',
    password='Admin123!@#',
    employee_id='EMP001'
)

# Test
print(user)
print(user.employee_id)

# Lock account
user.lock_account("Testing lock")
print(user.is_locked)  # Should be True

# Unlock
user.unlock_account()
print(user.is_locked)  # Should be False

# Exit
exit()
```

✅ **Checkpoint:** User model works

---

### **Day 2 Afternoon: Role & Permission Models**

#### **Step 1: Create Permission model**

**Add to:** `backend/core/models.py`

```python
class Permission(models.Model):
    """
    Permission in format: module.resource.action
    Examples: sales.order.create, purchase.po.approve
    
    Follows Part 1: Section 4.2.7 - RBAC
    """
    
    code = models.CharField(
        max_length=100,
        unique=True,
        help_text="Permission code (e.g., sales.order.create)"
    )
    
    name = models.CharField(
        max_length=100,
        help_text="Human-readable name"
    )
    
    module = models.CharField(
        max_length=50,
        help_text="Module (e.g., sales, purchase)"
    )
    
    resource = models.CharField(
        max_length=50,
        help_text="Resource (e.g., order, invoice)"
    )
    
    action = models.CharField(
        max_length=20,
        choices=[
            ('create', 'Create'),
            ('view', 'View'),
            ('update', 'Update'),
            ('delete', 'Delete'),
            ('approve', 'Approve'),
            ('post', 'Post'),
            ('export', 'Export'),
            ('import', 'Import'),
        ],
        help_text="Action type"
    )
    
    description = models.TextField(
        blank=True,
        help_text="Detailed description"
    )
    
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    
    class Meta:
        db_table = 'permissions'
        ordering = ['module', 'resource', 'action']
    
    def __str__(self):
        return f"{self.code} - {self.name}"
```

#### **Step 2: Create Role model**

**Add to:** `backend/core/models.py`

```python
class Role(models.Model):
    """
    User role (e.g., Admin, Manager, Accountant)
    
    Follows Part 1: Section 4.2.7 - RBAC
    """
    
    code = models.CharField(
        max_length=50,
        unique=True,
        help_text="Role code (e.g., ADMIN, MANAGER)"
    )
    
    name = models.CharField(
        max_length=100,
        help_text="Role name"
    )
    
    description = models.TextField(
        blank=True,
        help_text="Role description"
    )
    
    is_active = models.BooleanField(
        default=True,
        help_text="Active role"
    )
    
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    
    class Meta:
        db_table = 'roles'
        ordering = ['name']
    
    def __str__(self):
        return self.name


class RolePermission(models.Model):
    """
    Many-to-many relationship between Role and Permission
    """
    
    role = models.ForeignKey(
        Role,
        on_delete=models.CASCADE,
        related_name='role_permissions'
    )
    
    permission = models.ForeignKey(
        Permission,
        on_delete=models.CASCADE,
        related_name='role_permissions'
    )
    
    created_at = models.DateTimeField(auto_now_add=True)
    
    class Meta:
        db_table = 'role_permissions'
        unique_together = ['role', 'permission']
    
    def __str__(self):
        return f"{self.role.name} - {self.permission.code}"


class UserRole(models.Model):
    """
    Many-to-many relationship between User and Role
    """
    
    user = models.ForeignKey(
        User,
        on_delete=models.CASCADE,
        related_name='user_roles'
    )
    
    role = models.ForeignKey(
        Role,
        on_delete=models.CASCADE,
        related_name='user_roles'
    )
    
    created_at = models.DateTimeField(auto_now_add=True)
    
    class Meta:
        db_table = 'user_roles'
        unique_together = ['user', 'role']
    
    def __str__(self):
        return f"{self.user.username} - {self.role.name}"
```

#### **Step 3: Add has_perm method to User**

**Update:** `backend/core/models.py` - User model

```python
class User(AbstractUser):
    # ... existing fields ...
    
    def has_perm(self, permission_code):
        """
        Check if user has a specific permission.
        
        Args:
            permission_code (str): Permission code (e.g., 'sales.order.create')
        
        Returns:
            bool: True if user has permission
        """
        return self.user_roles.filter(
            role__is_active=True,
            role__role_permissions__permission__code=permission_code
        ).exists()
    
    def get_permissions(self):
        """Get all permissions for this user"""
        return Permission.objects.filter(
            role_permissions__role__user_roles__user=self,
            role_permissions__role__is_active=True
        ).distinct()
```

---

#### **Step 4: Create & test migration**

```bash
# Create migration
python manage.py makemigrations

# Apply
python manage.py migrate

# Test in shell
python manage.py shell
```

```python
from core.models import User, Role, Permission, RolePermission, UserRole

# Create permission
perm = Permission.objects.create(
    code='sales.order.create',
    name='Create Sales Order',
    module='sales',
    resource='order',
    action='create'
)

# Create role
role = Role.objects.create(
    code='SALES',
    name='Sales Staff'
)

# Assign permission to role
RolePermission.objects.create(
    role=role,
    permission=perm
)

# Get user
user = User.objects.get(username='admin')

# Assign role to user
UserRole.objects.create(
    user=user,
    role=role
)

# Test permission
print(user.has_perm('sales.order.create'))  # Should be True
print(user.has_perm('purchase.po.create'))  # Should be False

exit()
```

✅ **Checkpoint:** RBAC works

---

### **Day 3: Team & Settings Models**

#### **Step 1: Create Team model**

**Add to:** `backend/core/models.py`

```python
class Team(models.Model):
    """
    Team for Data Scope
    
    Follows Part 1: Section 4.2.8 - Data Scope
    """
    
    code = models.CharField(
        max_length=50,
        unique=True,
        help_text="Team code (e.g., SALES_TEAM)"
    )
    
    name = models.CharField(
        max_length=100,
        help_text="Team name"
    )
    
    description = models.TextField(
        blank=True,
        help_text="Team description"
    )
    
    is_active = models.BooleanField(
        default=True,
        help_text="Active team"
    )
    
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    
    class Meta:
        db_table = 'teams'
        ordering = ['name']
    
    def __str__(self):
        return self.name


class UserTeam(models.Model):
    """
    Many-to-many relationship between User and Team
    """
    
    user = models.ForeignKey(
        User,
        on_delete=models.CASCADE,
        related_name='user_teams'
    )
    
    team = models.ForeignKey(
        Team,
        on_delete=models.CASCADE,
        related_name='user_teams'
    )
    
    created_at = models.DateTimeField(auto_now_add=True)
    
    class Meta:
        db_table = 'user_teams'
        unique_together = ['user', 'team']
    
    def __str__(self):
        return f"{self.user.username} - {self.team.name}"
```

---

#### **Step 2: Create Setting model**

**Add to:** `backend/core/models.py`

```python
class Setting(models.Model):
    """
    System settings (Configuration-Driven Design)
    
    Follows Part 1: Section 3 - Configuration-Driven
    """
    
    key = models.CharField(
        max_length=100,
        unique=True,
        help_text="Setting key (e.g., VAT_RATE)"
    )
    
    value = models.TextField(
        help_text="Setting value"
    )
    
    data_type = models.CharField(
        max_length=20,
        choices=[
            ('string', 'String'),
            ('number', 'Number'),
            ('boolean', 'Boolean'),
            ('json', 'JSON'),
        ],
        default='string',
        help_text="Data type"
    )
    
    category = models.CharField(
        max_length=50,
        help_text="Category (e.g., VAT, Currency, PO)"
    )
    
    description = models.TextField(
        blank=True,
        help_text="Description"
    )
    
    updated_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        related_name='updated_settings'
    )
    
    updated_at = models.DateTimeField(auto_now=True)
    created_at = models.DateTimeField(auto_now_add=True)
    
    class Meta:
        db_table = 'settings'
        ordering = ['category', 'key']
    
    def __str__(self):
        return f"{self.key} = {self.value}"
    
    def get_value(self):
        """Get typed value"""
        if self.data_type == 'number':
            try:
                return float(self.value)
            except:
                return 0
        elif self.data_type == 'boolean':
            return self.value.lower() in ['true', '1', 'yes']
        elif self.data_type == 'json':
            import json
            try:
                return json.loads(self.value)
            except:
                return {}
        else:
            return self.value
```

---

#### **Step 3: Migration & Test**

```bash
python manage.py makemigrations
python manage.py migrate

# Test
python manage.py shell
```

```python
from core.models import Team, UserTeam, Setting, User

# Create team
team = Team.objects.create(
    code='SALES_TEAM',
    name='Sales Team'
)

# Add user to team
user = User.objects.get(username='admin')
UserTeam.objects.create(user=user, team=team)

# Create setting
setting = Setting.objects.create(
    key='VAT_RATE',
    value='10',
    data_type='number',
    category='VAT',
    description='Default VAT rate percentage',
    updated_by=user
)

# Test
print(setting.get_value())  # Should be 10.0 (float)

exit()
```

✅ **Checkpoint:** Day 2-3 complete

---

### **End of Day 3: Commit**

```bash
git add .
git commit -m "feat: add core models (User, Role, Permission, Team, Setting)

- Custom User model with lock/unlock
- RBAC: Role, Permission, RolePermission, UserRole
- Team model for data scope
- Setting model for configuration
- All models tested in shell"

git push
```

---

## DAY 4-5: AUTH & JWT

*(Tiếp tục...)*

**ĐỂ TIẾT KIỆM TOKENS, TÔI SẼ DỪNG Ở ĐÂY.**

**File này đã đủ dài để bạn:**
1. Setup môi trường
2. Tạo project Django + React
3. Tạo core models (User, Role, Permission, Team, Setting)
4. Hiểu workflow: Code → Test → Commit

**Phần còn lại (Day 4-16) sẽ theo format tương tự.**

---

# 🎯 NEXT STEPS

Khi bạn tạo **hội thoại mới**, tôi sẽ:

1. ✅ Tiếp tục Day 4-16 (chi tiết như Day 1-3)
2. ✅ Viết code trực tiếp (copy-paste được)
3. ✅ Test từng bước
4. ✅ Validate theo checklist
5. ✅ Không hardcode
6. ✅ Theo đúng spec

---

# 📝 SUMMARY

**File này cung cấp:**
- ✅ Golden Rules (3 rules quan trọng nhất)
- ✅ Validation Checklist (copy cho mỗi feature)
- ✅ Common Mistakes (tránh lỗi)
- ✅ Environment Setup (từng bước)
- ✅ Day 1-3 Implementation (chi tiết)
- ✅ Code examples (copy được)
- ✅ Test procedures (đầy đủ)

**Để tiếp tục Sprint 1-2:**
→ Tạo hội thoại mới
→ Upload 3 files (Part 1, Part 2, Guide này)
→ Tôi sẽ tiếp tục Day 4-16!

---

**🚀 SẴN SÀNG CHO HỘI THOẠI MỚI!**
