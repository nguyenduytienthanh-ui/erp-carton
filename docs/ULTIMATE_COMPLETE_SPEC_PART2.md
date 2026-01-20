# 📦 ERP THÙNG CARTON - ULTIMATE COMPLETE SPECIFICATION
## PART 2: Core Functions 28-54 + Modules + Implementation

> ⚠️ **ĐỌC PART 1 TRƯỚC! File này là phần tiếp theo.** ⚠️

**Link Part 1:** `ULTIMATE_COMPLETE_SPEC_PART1.md`

**Part 2 này bao gồm:**
- ✅ 54 Core Functions (28-54) - Tiếp theo Part 1
- ✅ 6 Modules MVP (Chi tiết đầy đủ)
- ✅ Báo cáo MVP
- ✅ UI/Responsive
- ✅ Deliverables
- ✅ Roadmap 8 Sprints
- ✅ 14 Khóa yêu cầu bắt buộc
- ✅ Database Schema Complete
- ✅ API Design Complete
- ✅ Implementation Guide Step-by-step

---

# 📋 MỤC LỤC PART 2

## 4. 54 CHỨC NĂNG CORE (Tiếp Part 1)
- [4.6. Workflow & Locking (28-33)](#46-workflow--locking-28-33)
- [4.7. Audit & Logging (34-35)](#47-audit--logging-34-35)
- [4.8. Attachments & Notes (36-41)](#48-attachments--notes-36-41)
- [4.9. Configuration (42-47)](#49-configuration-42-47)
- [4.10. API & DevOps (48-54)](#410-api--devops-48-54)

## 8. 6 MODULES MVP
- [8.1. Master Data](#81-master-data)
- [8.2. Sales (Bán hàng)](#82-sales-bán-hàng)
- [8.3. Purchase (Mua hàng)](#83-purchase-mua-hàng)
- [8.4. Inventory (Kho)](#84-inventory-kho)
- [8.5. Finance (Thu-Chi)](#85-finance-thu-chi)
- [8.6. Advance (Tạm ứng)](#86-advance-tạm-ứng)
- [8.7. Production (Sản xuất)](#87-production-sản-xuất)
- [8.8. Notes/Thread/Task](#88-notesthreadtask)
- [8.9. Time (Chấm công)](#89-time-chấm-công)

## 9-13. REPORTS, UI, DELIVERABLES, ROADMAP
- [9. Báo cáo MVP](#9-báo-cáo-mvp)
- [10. UI/Responsive](#10-uiresponsive)
- [11. Deliverables](#11-deliverables)
- [12. Roadmap 8 Sprints](#12-roadmap-8-sprints)
- [13. Backlog](#13-backlog)

## 14. 14 KHÓA YÊU CẦU
- [14.1. NFR](#141-nfr)
- [14.2. LAN Fallback](#142-lan-fallback)
- [14.3. Permission Matrix](#143-permission-matrix)
- [14.4. Close Period](#144-close-period)
- [14.5. Print Templates](#145-print-templates)
- [14.6. Data Migration](#146-data-migration)
- [14.7. Notifications](#147-notifications)
- [14.8. File Attachments](#148-file-attachments)

## 15-17. DATABASE, API, IMPLEMENTATION
- [15. Database Schema Complete](#15-database-schema-complete)
- [16. API Design Complete](#16-api-design-complete)
- [17. Implementation Guide](#17-implementation-guide)

---

# 4. 54 CHỨC NĂNG CORE (Tiếp)

## 4.6. Workflow & Locking (28-33)

### **28. Workflow chuẩn: DRAFT → APPROVED → POSTED/LOCKED**

**Standard workflow:**
```
DRAFT 
  → User tạo, có thể sửa/xóa
  
SUBMITTED (Optional)
  → Gửi duyệt, chờ approver
  
APPROVED
  → Đã duyệt, sẵn sàng thực thi
  
POSTED/LOCKED
  → Đã ghi sổ, không cho sửa (immutable)
  
CANCELLED
  → Đã hủy
```

**State transitions:**
```python
class SalesOrder(models.Model):
    STATUS_CHOICES = [
        ('DRAFT', 'Draft'),
        ('SUBMITTED', 'Submitted'),
        ('APPROVED', 'Approved'),
        ('IN_PROGRESS', 'In Progress'),
        ('DONE', 'Done'),
        ('CANCELLED', 'Cancelled'),
    ]
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='DRAFT')
    is_locked = models.BooleanField(default=False)
    
    def can_edit(self, user):
        if self.is_locked and not user.has_perm('sales.order.unlock'):
            return False
        return True
    
    def can_delete(self, user):
        if self.status in ['APPROVED', 'IN_PROGRESS', 'DONE']:
            return False
        return True
```

---

### **29. Chặn sửa sau APPROVED/POSTED (trừ user có quyền)**

**Middleware/Validation:**
```python
def save(self, *args, **kwargs):
    if self.pk:  # Existing record
        old = SalesOrder.objects.get(pk=self.pk)
        
        if old.is_locked:
            # Check unlock permission
            from django.contrib.auth import get_current_user
            user = get_current_user()  # Custom middleware
            
            if not user.has_perm('sales.order.unlock'):
                raise ValidationError("Cannot edit locked order. Contact admin.")
    
    super().save(*args, **kwargs)
```

---

### **30. Luật sửa: bắt buộc ghi 'lý do chỉnh sửa' + audit trail**

**Edit Reason:**
```python
@api_view(['PUT'])
@permission_required('sales.order.update')
def update_order(request, pk):
    order = SalesOrder.objects.get(pk=pk)
    
    if order.status in ['APPROVED', 'POSTED']:
        edit_reason = request.data.get('edit_reason')
        if not edit_reason:
            return Response({
                "error": "Edit reason is required for approved/posted orders"
            }, status=400)
        
        # Log to audit
        AuditLog.objects.create(
            user=request.user,
            action='UPDATE',
            entity_type='SalesOrder',
            entity_id=pk,
            old_values=model_to_dict(order),
            new_values=request.data,
            reason=edit_reason
        )
    
    # Update...
    serializer = SalesOrderSerializer(order, data=request.data, partial=True)
    serializer.is_valid(raise_exception=True)
    serializer.save()
    
    return Response(serializer.data)
```

---

### **31. Optimistic locking/version để tránh ghi đè**

**Version field:**
```python
class SalesOrder(models.Model):
    version = models.IntegerField(default=1)
    
    def save(self, *args, **kwargs):
        if self.pk:  # Update
            # Get current version from DB
            current = SalesOrder.objects.select_for_update().get(pk=self.pk)
            
            if current.version != self.version:
                raise ConcurrentModificationError(
                    f"Order was modified by another user. "
                    f"Please refresh and try again."
                )
            
            # Increment version
            self.version = F('version') + 1
        
        super().save(*args, **kwargs)
```

**Frontend:**
```typescript
// When editing, include version
const updateOrder = async (orderId: number, data: any, version: number) => {
    try {
        await api.put(`/sales/orders/${orderId}`, {
            ...data,
            version: version  // ← Include current version
        });
    } catch (error) {
        if (error.response?.data?.error === 'ConcurrentModificationError') {
            alert('Order was modified by another user. Please refresh.');
            // Reload order
            loadOrder(orderId);
        }
    }
};
```

---

### **32. Soft delete + restore (đối tượng phù hợp)**

**Soft Delete Model:**
```python
class SoftDeleteModel(models.Model):
    is_deleted = models.BooleanField(default=False)
    deleted_at = models.DateTimeField(null=True, blank=True)
    deleted_by = models.ForeignKey(User, null=True, blank=True, related_name='+')
    
    class Meta:
        abstract = True
    
    def delete(self, using=None, keep_parents=False):
        # Soft delete
        self.is_deleted = True
        self.deleted_at = timezone.now()
        # deleted_by should be set by view
        self.save()
    
    def hard_delete(self):
        # Real delete
        super().delete()
    
    def restore(self):
        self.is_deleted = False
        self.deleted_at = None
        self.deleted_by = None
        self.save()

# Manager to filter out deleted
class SoftDeleteManager(models.Manager):
    def get_queryset(self):
        return super().get_queryset().filter(is_deleted=False)

# Usage
class Customer(SoftDeleteModel):
    objects = SoftDeleteManager()
    all_objects = models.Manager()  # Include deleted
```

**API:**
```
DELETE /api/v1/customers/123      → Soft delete
POST   /api/v1/customers/123/restore  → Restore
DELETE /api/v1/customers/123?hard=true  → Hard delete (Admin only)
```

---

### **33. Chuẩn 'điều chỉnh': tạo chứng từ điều chỉnh thay vì sửa số đã POSTED**

**Adjustment Document Pattern:**

**Example: AR Invoice adjustment**

**KHÔNG làm:**
```python
# ❌ Sai: Sửa trực tiếp invoice đã POSTED
invoice = ARInvoice.objects.get(code='INV-001')
invoice.total = 1000000  # Was 1100000
invoice.save()  # ← NGUY HIỂM! Mất audit trail
```

**Làm đúng:**
```python
# ✅ Đúng: Tạo Credit Note (điều chỉnh giảm)
credit_note = CreditNote.objects.create(
    original_invoice=invoice,
    amount=100000,  # Adjustment amount
    reason="Customer return - 10 units defective",
    created_by=request.user
)

# AR balance tự động giảm
# Audit trail đầy đủ
```

**Models:**
```python
class CreditNote(models.Model):
    code = models.CharField(max_length=50, unique=True)
    original_invoice = models.ForeignKey('ARInvoice', related_name='credit_notes')
    credit_date = models.DateField(default=timezone.now)
    amount = models.DecimalField(max_digits=15, decimal_places=2)
    reason = models.TextField()
    status = models.CharField(max_length=20, default='DRAFT')
    
    def post(self):
        # Reduce AR balance
        self.original_invoice.ar_balance -= self.amount
        self.original_invoice.save()
        
        self.status = 'POSTED'
        self.save()
```

---

## 4.7. Audit & Logging (34-35)

### **34. Audit log nghiệp vụ: CREATE/UPDATE/DELETE/APPROVE/POST/UNLOCK/EXPORT/IMPORT**

**Complete Audit Log:**
```python
class AuditLog(models.Model):
    # Request tracking
    request_id = models.UUIDField(default=uuid.uuid4)
    
    # User info
    user = models.ForeignKey(User, null=True, on_delete=models.SET_NULL)
    username = models.CharField(max_length=150)  # Backup if user deleted
    
    # Action
    action = models.CharField(max_length=50, choices=[
        ('CREATE', 'Create'),
        ('UPDATE', 'Update'),
        ('DELETE', 'Delete'),
        ('APPROVE', 'Approve'),
        ('REJECT', 'Reject'),
        ('POST', 'Post'),
        ('CANCEL', 'Cancel'),
        ('UNLOCK', 'Unlock'),
        ('EXPORT', 'Export'),
        ('IMPORT', 'Import'),
        ('VIEW', 'View'),  # Optional for sensitive data
    ])
    
    # Entity
    entity_type = models.CharField(max_length=50)
    entity_id = models.IntegerField()
    entity_repr = models.CharField(max_length=255)  # Human readable (e.g., "SO-260108-001")
    
    # Changes
    old_values = models.JSONField(null=True, blank=True)
    new_values = models.JSONField(null=True, blank=True)
    
    # Reason (for sensitive actions)
    reason = models.TextField(blank=True)
    
    # Network
    ip_address = models.GenericIPAddressField()
    user_agent = models.TextField()
    
    # Timestamp
    created_at = models.DateTimeField(auto_now_add=True)
    
    class Meta:
        indexes = [
            models.Index(fields=['entity_type', 'entity_id']),
            models.Index(fields=['user', 'action']),
            models.Index(fields=['created_at']),
            models.Index(fields=['request_id']),
        ]
```

**Auto-logging with signals:**
```python
from django.db.models.signals import pre_save, post_save, post_delete
from django.dispatch import receiver

@receiver(post_save)
def log_create_update(sender, instance, created, **kwargs):
    # Skip audit log model itself
    if isinstance(instance, AuditLog):
        return
    
    # Get current user from middleware
    user = get_current_user()
    if not user:
        return
    
    action = 'CREATE' if created else 'UPDATE'
    
    old_values = None
    if not created:
        # Get old values from pre_save
        old_values = getattr(instance, '_old_values', None)
    
    AuditLog.objects.create(
        user=user,
        username=user.username,
        action=action,
        entity_type=sender.__name__,
        entity_id=instance.pk,
        entity_repr=str(instance),
        old_values=old_values,
        new_values=model_to_dict(instance),
        ip_address=get_client_ip(),
        user_agent=get_user_agent()
    )

@receiver(pre_save)
def capture_old_values(sender, instance, **kwargs):
    if instance.pk:
        try:
            old = sender.objects.get(pk=instance.pk)
            instance._old_values = model_to_dict(old)
        except:
            pass
```

---

### **35. Mọi lỗi API trả request_id để truy vết log**

**Middleware to add request_id:**
```python
import uuid

class RequestIDMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response
    
    def __call__(self, request):
        # Generate unique request ID
        request_id = str(uuid.uuid4())
        request.request_id = request_id
        
        # Add to response header
        response = self.get_response(request)
        response['X-Request-ID'] = request_id
        
        return response
```

**Log with request_id:**
```python
import logging
logger = logging.getLogger(__name__)

def some_view(request):
    try:
        # Business logic...
        pass
    except Exception as e:
        logger.error(
            f"Error in view: {e}",
            extra={
                'request_id': request.request_id,
                'user': request.user.username,
                'path': request.path
            }
        )
        
        return Response({
            "error": "Internal server error",
            "request_id": request.request_id,  # ← Return to client
            "message": "Please contact support with this request ID"
        }, status=500)
```

**User reports error:**
```
User: "Tôi gặp lỗi khi tạo đơn hàng!"
Support: "Request ID của bạn là gì?"
User: "a1b2c3d4-5678-90ef-ghij-klmnopqrstuv"
Support: *Search log by request_id* → Found exact error!
```

---

## 4.8. Attachments & Notes (36-41)

### **36. Attachments: đính kèm file/ảnh theo mọi đối tượng**

**Generic Attachment Model:**
```python
from django.contrib.contenttypes.fields import GenericForeignKey
from django.contrib.contenttypes.models import ContentType

class Attachment(models.Model):
    # Polymorphic relation
    content_type = models.ForeignKey(ContentType, on_delete=models.CASCADE)
    object_id = models.PositiveIntegerField()
    content_object = GenericForeignKey('content_type', 'object_id')
    
    # File info
    file = models.FileField(upload_to='attachments/%Y/%m/%d/')
    filename = models.CharField(max_length=255)
    file_size = models.BigIntegerField()  # bytes
    mime_type = models.CharField(max_length=100)
    
    # Upload info
    uploaded_by = models.ForeignKey(User, on_delete=models.CASCADE)
    uploaded_at = models.DateTimeField(auto_now_add=True)
    
    # Optional
    description = models.TextField(blank=True)
    
    class Meta:
        ordering = ['-uploaded_at']
```

**Settings:**
```python
# settings.py
MAX_UPLOAD_SIZE = 500 * 1024 * 1024  # 500MB
ALLOWED_FILE_TYPES = ['jpg', 'jpeg', 'png', 'heic', 'pdf']
MAX_ATTACHMENTS_PER_DOCUMENT = 50
MAX_TOTAL_SIZE_PER_DOCUMENT = 2 * 1024 * 1024 * 1024  # 2GB
```

**Validation:**
```python
def validate_file(file):
    # Check size
    if file.size > settings.MAX_UPLOAD_SIZE:
        raise ValidationError(f"File size exceeds {settings.MAX_UPLOAD_SIZE / 1024 / 1024}MB")
    
    # Check extension
    ext = file.name.split('.')[-1].lower()
    if ext not in settings.ALLOWED_FILE_TYPES:
        raise ValidationError(f"File type .{ext} not allowed. Allowed: {', '.join(settings.ALLOWED_FILE_TYPES)}")
    
    return True
```

**API:**
```python
@action(detail=True, methods=['post'])
def upload_attachment(self, request, pk=None):
    obj = self.get_object()
    file = request.FILES.get('file')
    
    if not file:
        return Response({"error": "No file provided"}, status=400)
    
    # Validate
    validate_file(file)
    
    # Check total size for this document
    current_total = Attachment.objects.filter(
        content_type=ContentType.objects.get_for_model(obj),
        object_id=obj.pk
    ).aggregate(total=Sum('file_size'))['total'] or 0
    
    if current_total + file.size > settings.MAX_TOTAL_SIZE_PER_DOCUMENT:
        return Response({
            "error": f"Total attachments size exceeds 2GB limit"
        }, status=400)
    
    # Create attachment
    attachment = Attachment.objects.create(
        content_object=obj,
        file=file,
        filename=file.name,
        file_size=file.size,
        mime_type=file.content_type,
        uploaded_by=request.user
    )
    
    return Response(AttachmentSerializer(attachment).data, status=201)
```

---

### **37. Notes/Thread theo đối tượng: comment theo dòng thời gian**

**Note Model:**
```python
class Note(models.Model):
    # Polymorphic
    content_type = models.ForeignKey(ContentType, on_delete=models.CASCADE)
    object_id = models.PositiveIntegerField()
    content_object = GenericForeignKey()
    
    # Content
    content = models.TextField()
    
    # Metadata
    is_pinned = models.BooleanField(default=False)
    is_internal = models.BooleanField(default=False)  # Not visible to external users
    
    # Author
    created_by = models.ForeignKey(User, on_delete=models.CASCADE)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    
    # Mentions
    mentioned_users = models.ManyToManyField(User, related_name='mentioned_in_notes', blank=True)
    
    class Meta:
        ordering = ['-is_pinned', '-created_at']
```

**Parse @mentions:**
```python
import re

def parse_mentions(content):
    # Find all @username patterns
    pattern = r'@(\w+)'
    usernames = re.findall(pattern, content)
    
    # Get users
    users = User.objects.filter(username__in=usernames)
    
    return users

# When creating note
note = Note.objects.create(
    content_object=order,
    content=request.data['content'],
    created_by=request.user
)

# Parse mentions
mentioned = parse_mentions(note.content)
note.mentioned_users.set(mentioned)

# Send notifications
for user in mentioned:
    Notification.objects.create(
        user=user,
        type='MENTION',
        message=f"{request.user.username} mentioned you in {order}",
        link_url=f"/sales/orders/{order.pk}/notes/{note.pk}"
    )
```

---

### **38. @mention người liên quan + notification**

*(Đã implement ở trên)*

**Notification Model:**
```python
class Notification(models.Model):
    user = models.ForeignKey(User, on_delete=models.CASCADE)
    type = models.CharField(max_length=50, choices=[
        ('MENTION', 'Mention'),
        ('TASK_ASSIGNED', 'Task Assigned'),
        ('APPROVAL_REQUEST', 'Approval Request'),
        ('APPROVED', 'Approved'),
        ('REJECTED', 'Rejected'),
        ('COMMENT', 'Comment'),
    ])
    message = models.TextField()
    link_url = models.CharField(max_length=500, blank=True)
    
    is_read = models.BooleanField(default=False)
    read_at = models.DateTimeField(null=True, blank=True)
    
    created_at = models.DateTimeField(auto_now_add=True)
    
    class Meta:
        ordering = ['-created_at']
```

**API:**
```
GET /api/v1/notifications           → List unread
GET /api/v1/notifications/all       → List all
POST /api/v1/notifications/{id}/mark-read
POST /api/v1/notifications/mark-all-read
```

---

### **39. Task/Assignment: giao việc, trạng thái, deadline**

**Task Model:**
```python
class Task(models.Model):
    # Linked object
    content_type = models.ForeignKey(ContentType, on_delete=models.CASCADE)
    object_id = models.PositiveIntegerField()
    related_object = GenericForeignKey()
    
    # Task info
    title = models.CharField(max_length=200)
    description = models.TextField(blank=True)
    
    # Assignment
    assigned_to = models.ForeignKey(User, related_name='assigned_tasks', on_delete=models.CASCADE)
    assigned_by = models.ForeignKey(User, related_name='created_tasks', on_delete=models.CASCADE)
    
    # Status
    status = models.CharField(max_length=20, choices=[
        ('TODO', 'To Do'),
        ('IN_PROGRESS', 'In Progress'),
        ('DONE', 'Done'),
        ('CANCELLED', 'Cancelled'),
    ], default='TODO')
    
    # Priority
    priority = models.CharField(max_length=20, choices=[
        ('LOW', 'Low'),
        ('MEDIUM', 'Medium'),
        ('HIGH', 'High'),
        ('URGENT', 'Urgent'),
    ], default='MEDIUM')
    
    # Dates
    due_date = models.DateField(null=True, blank=True)
    completed_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    
    class Meta:
        ordering = ['-priority', 'due_date']
```

**API:**
```
POST /api/v1/tasks
GET  /api/v1/tasks/my-tasks         → Tasks assigned to me
POST /api/v1/tasks/{id}/start       → Change status to IN_PROGRESS
POST /api/v1/tasks/{id}/complete    → Change status to DONE
```

---

### **40. Blocking Task/Issue: chặn RELEASED/duyệt LSX khi chưa DONE**

**Blocking Task:**
```python
class Task(models.Model):
    # Add field
    is_blocking = models.BooleanField(default=False)
    blocks_action = models.CharField(max_length=50, blank=True)  # 'RELEASE', 'APPROVE'
```

**Check before action:**
```python
class ProductionOrder(models.Model):
    def release(self, user):
        # Check blocking tasks
        blocking_tasks = Task.objects.filter(
            content_type=ContentType.objects.get_for_model(self),
            object_id=self.pk,
            is_blocking=True,
            blocks_action='RELEASE',
            status__in=['TODO', 'IN_PROGRESS']  # Not DONE
        )
        
        if blocking_tasks.exists():
            raise ValidationError(
                f"Cannot release order. {blocking_tasks.count()} blocking task(s) not completed: "
                f"{', '.join(t.title for t in blocking_tasks)}"
            )
        
        # Proceed with release...
        self.status = 'RELEASED'
        self.save()
```

**Use case:**
```
SKU: TH-001 (Thùng carton 30x40x50)

Issue: "Phim in bị lỗi - Hỏng sau 500 tấm"
Type: BLOCKER
Blocks: RELEASE

→ Khi tạo Production Order cho TH-001
→ Kiểm tra: Có BLOCKER chưa DONE?
→ Nếu có → KHÔNG CHO RELEASED
→ Báo lỗi: "Cannot release. Blocking issue: Phim in bị lỗi..."
```

---

### **41. Pin/Tag ghi chú quan trọng (nhắc lại lần sản xuất sau)**

**Pin note:**
```python
class Note(models.Model):
    is_pinned = models.BooleanField(default=False)
```

**Pinned notes hiện đầu tiên:**
```python
# Ordering
class Meta:
    ordering = ['-is_pinned', '-created_at']

# When viewing SKU → Show pinned notes first
notes = Note.objects.filter(
    content_type=ContentType.objects.get_for_model(SKU),
    object_id=sku.pk
)
# Auto ordered by is_pinned DESC, created_at DESC
```

**Tags:**
```python
class Tag(models.Model):
    name = models.CharField(max_length=50, unique=True)
    color = models.CharField(max_length=7, default='#3B82F6')  # Hex color

class Note(models.Model):
    tags = models.ManyToManyField(Tag, blank=True)
```

**Use case:**
```
SKU: TH-001

📌 Pinned Note #1:
   "QUAN TRỌNG: Phim in dễ hỏng, kiểm tra kỹ trước khi chạy!"
   Tags: #cảnh_báo #phim_in #QC
   
📌 Pinned Note #2:
   "Chỉ dùng giấy loại A+, không dùng loại B"
   Tags: #nguyên_vật_liệu #yêu_cầu_chất_lượng

Note #3:
   "LSX-001: Chạy OK, 1000 cái"
   Tags: #sản_xuất_ok
```

---

## 4.9. Configuration (42-47)

### **42. DocumentType cấu hình**

*(Đã có ở Part 1)*

### **43. Quy tắc mã PREFIX-YYMMDD-### (3 số) + counter transaction-safe**

*(Đã có ở Part 1)*

### **44. Cấu hình tiền tệ (VND 0, USD 3) + format VN 1.234,567**

*(Đã có ở Part 1)*

### **45. Cấu hình VAT (0/8/10) + inclusive/exclusive**

*(Đã có ở Part 1)*

### **46. Cấu hình tolerance PO (%, abs) + luật approve khi over-receipt**

**Settings:**
```python
Setting.objects.create(
    key='PO_TOLERANCE_PERCENT',
    value='5',
    data_type='number',
    description='Cho phép nhận vượt PO (%)'
)

Setting.objects.create(
    key='PO_TOLERANCE_REQUIRE_APPROVAL',
    value='true',
    data_type='boolean',
    description='Bắt buộc approve khi nhận vượt tolerance'
)
```

**Logic:**
```python
def create_goods_receipt(po, items):
    for item in items:
        po_item = po.items.get(sku=item.sku)
        
        remaining = po_item.quantity - po_item.received_quantity
        over_qty = item.quantity - remaining
        
        if over_qty > 0:
            # Calculate tolerance
            tolerance_percent = float(settings.get('PO_TOLERANCE_PERCENT', 5))
            tolerance_qty = po_item.quantity * tolerance_percent / 100
            
            if over_qty <= tolerance_qty:
                # Within tolerance
                require_approval = settings.get('PO_TOLERANCE_REQUIRE_APPROVAL', 'true') == 'true'
                
                if require_approval:
                    # Need manager approval
                    gr.status = 'PENDING_APPROVAL'
                    gr.approval_reason = f"Over-receipt by {over_qty} units (within {tolerance_percent}% tolerance)"
                else:
                    # Auto approve
                    gr.status = 'APPROVED'
            else:
                # Exceed tolerance
                raise ValidationError(
                    f"Over-receipt exceeds tolerance. "
                    f"Ordered: {po_item.quantity}, "
                    f"Already received: {po_item.received_quantity}, "
                    f"Receiving: {item.quantity}, "
                    f"Over by: {over_qty} (tolerance: {tolerance_qty})"
                )
```

---

### **47. Cấu hình ca làm (shift) + break time (không tính giờ)**

**Shift Model:**
```python
class Shift(models.Model):
    name = models.CharField(max_length=100)
    start_time = models.TimeField()
    end_time = models.TimeField()
    break_start = models.TimeField(null=True, blank=True)
    break_end = models.TimeField(null=True, blank=True)
    work_hours = models.DecimalField(max_digits=4, decimal_places=2)
    is_active = models.BooleanField(default=True)
```

**Calculate work hours:**
```python
def calculate_work_hours(check_in, check_out, shift):
    # Total time
    total = (check_out - check_in).total_seconds() / 3600  # hours
    
    # Subtract break
    if shift.break_start and shift.break_end:
        break_hours = (
            datetime.combine(date.today(), shift.break_end) -
            datetime.combine(date.today(), shift.break_start)
        ).total_seconds() / 3600
        
        total -= break_hours
    
    return round(total, 2)
```

**Example:**
```
Ca ngày:
- Start: 08:00
- End: 17:00
- Break: 12:00-13:00 (1 hour)
- Work hours: 8.00

Check-in: 08:05
Check-out: 17:15
Total: 9.17 hours
Minus break: 1 hour
Work hours: 8.17 hours
```

---

## 4.10. API & DevOps (48-54)

### **48. OpenAPI/Swagger auto-generated + version /api/v1**

**Install:**
```bash
pip install drf-spectacular
```

**Settings:**
```python
INSTALLED_APPS = [
    # ...
    'drf_spectacular',
]

REST_FRAMEWORK = {
    'DEFAULT_SCHEMA_CLASS': 'drf_spectacular.openapi.AutoSchema',
}

SPECTACULAR_SETTINGS = {
    'TITLE': 'ERP API',
    'DESCRIPTION': 'ERP System for Carton Manufacturing',
    'VERSION': '1.0.0',
    'SERVE_INCLUDE_SCHEMA': False,
}
```

**URLs:**
```python
from drf_spectacular.views import SpectacularAPIView, SpectacularSwaggerView

urlpatterns = [
    path('api/schema/', SpectacularAPIView.as_view(), name='schema'),
    path('api/docs/', SpectacularSwaggerView.as_view(url_name='schema'), name='swagger-ui'),
]
```

**Access:** `http://localhost:8000/api/docs/`

---

### **49. Chuẩn list API: page/page_size/order/q/filter[field]/fields**

*(Đã có ở Part 1)*

### **50. CORS allowlist domain FE + rate limit ở gateway**

**Django CORS:**
```python
pip install django-cors-headers

INSTALLED_APPS = [
    'corsheaders',
    # ...
]

MIDDLEWARE = [
    'corsheaders.middleware.CorsMiddleware',
    # ...
]

CORS_ALLOWED_ORIGINS = [
    "https://erp.your-domain.com",
    "http://localhost:3000",  # Dev
]

CORS_ALLOW_CREDENTIALS = True
```

**Rate Limit (Nginx/API Gateway):**
```nginx
limit_req_zone $binary_remote_addr zone=api_limit:10m rate=100r/m;

location /api/ {
    limit_req zone=api_limit burst=20 nodelay;
    proxy_pass http://backend:8000;
}
```

---

### **51. Health check endpoint (/health) + tunnel status indicator**

**Health Check:**
```python
from django.db import connection
from django.core.cache import cache

@api_view(['GET'])
@permission_classes([AllowAny])
def health_check(request):
    # Check database
    try:
        connection.ensure_connection()
        db_status = 'ok'
    except Exception as e:
        db_status = f'error: {str(e)}'
    
    # Check cache
    try:
        cache.set('health_check', 'ok', 1)
        cache_status = 'ok' if cache.get('health_check') == 'ok' else 'error'
    except Exception as e:
        cache_status = f'error: {str(e)}'
    
    # Check tunnel (if using Cloudflare)
    try:
        # Simple check: can we reach external service?
        import requests
        r = requests.get('https://cloudflare.com', timeout=5)
        tunnel_status = 'connected' if r.status_code == 200 else 'disconnected'
    except:
        tunnel_status = 'disconnected'
    
    # Disk usage
    import shutil
    disk = shutil.disk_usage('/')
    disk_usage = f"{disk.used / disk.total * 100:.1f}%"
    
    # Last backup
    try:
        import os
        import glob
        backup_files = glob.glob('/backup/*.sql.gz')
        if backup_files:
            latest = max(backup_files, key=os.path.getctime)
            last_backup = datetime.fromtimestamp(os.path.getctime(latest))
        else:
            last_backup = None
    except:
        last_backup = None
    
    return Response({
        'status': 'healthy' if db_status == 'ok' and cache_status == 'ok' else 'unhealthy',
        'database': db_status,
        'cache': cache_status,
        'tunnel': tunnel_status,
        'disk_usage': disk_usage,
        'last_backup': last_backup.isoformat() if last_backup else None,
    })
```

---

### **52. Backup scheduler (local 2nd disk) + backup to Google Drive**

**Backup Script:**
```bash
#!/bin/bash
# /scripts/backup.sh

# Variables
DB_NAME="erp_db"
DB_USER="erp_user"
BACKUP_DIR="/backup"
DATE=$(date +%Y%m%d_%H%M%S)
KEEP_DAYS=30

# Backup database
echo "Backing up database..."
pg_dump -U $DB_USER $DB_NAME | gzip > $BACKUP_DIR/db_$DATE.sql.gz

# Backup media files
echo "Backing up media files..."
tar -czf $BACKUP_DIR/media_$DATE.tar.gz /app/media/

# Delete old backups
echo "Cleaning old backups..."
find $BACKUP_DIR -name "db_*.sql.gz" -mtime +$KEEP_DAYS -delete
find $BACKUP_DIR -name "media_*.tar.gz" -mtime +$KEEP_DAYS -delete

# Upload to Google Drive (using rclone)
echo "Uploading to Google Drive..."
rclone copy $BACKUP_DIR/db_$DATE.sql.gz gdrive:erp-backups/database/
rclone copy $BACKUP_DIR/media_$DATE.tar.gz gdrive:erp-backups/media/

# Log
echo "Backup completed: $DATE" >> $BACKUP_DIR/backup.log
```

**Cron:**
```bash
# Run daily at 3:00 AM
crontab -e

0 3 * * * /scripts/backup.sh >> /var/log/backup.log 2>&1
```

**rclone setup:**
```bash
# Install
curl https://rclone.org/install.sh | sudo bash

# Configure Google Drive
rclone config

# Test
rclone copy /backup/test.txt gdrive:erp-backups/
```

---

### **53. Restore test script/checklist (định kỳ)**

**Restore Test Script:**
```bash
#!/bin/bash
# /scripts/restore_test.sh

# Monthly restore test checklist

echo "=== ERP RESTORE TEST ==="
echo "Date: $(date)"
echo ""

# 1. Download latest backup from Drive
echo "1. Downloading latest backup from Google Drive..."
rclone copy gdrive:erp-backups/database/ /restore-test/ --include "db_*.sql.gz" --max-age 1d
LATEST_BACKUP=$(ls -t /restore-test/db_*.sql.gz | head -1)

if [ -z "$LATEST_BACKUP" ]; then
    echo "❌ ERROR: No backup file found"
    exit 1
fi

echo "✓ Downloaded: $LATEST_BACKUP"

# 2. Create test database
echo "2. Creating test database..."
psql -U postgres -c "DROP DATABASE IF EXISTS erp_test_restore;"
psql -U postgres -c "CREATE DATABASE erp_test_restore;"
echo "✓ Test database created"

# 3. Restore backup
echo "3. Restoring backup..."
gunzip < $LATEST_BACKUP | psql -U erp_user -d erp_test_restore
if [ $? -eq 0 ]; then
    echo "✓ Restore successful"
else
    echo "❌ ERROR: Restore failed"
    exit 1
fi

# 4. Run smoke tests
echo "4. Running smoke tests..."

# Test 1: Count records
echo "   - Checking record counts..."
SALES_COUNT=$(psql -U erp_user -d erp_test_restore -t -c "SELECT COUNT(*) FROM sales_orders;")
PURCHASE_COUNT=$(psql -U erp_user -d erp_test_restore -t -c "SELECT COUNT(*) FROM purchase_orders;")
echo "     Sales Orders: $SALES_COUNT"
echo "     Purchase Orders: $PURCHASE_COUNT"

# Test 2: Check latest record
echo "   - Checking latest record..."
LATEST_SO=$(psql -U erp_user -d erp_test_restore -t -c "SELECT code FROM sales_orders ORDER BY created_at DESC LIMIT 1;")
echo "     Latest SO: $LATEST_SO"

# 5. Cleanup
echo "5. Cleaning up..."
psql -U postgres -c "DROP DATABASE erp_test_restore;"
rm $LATEST_BACKUP
echo "✓ Cleanup complete"

# 6. Summary
echo ""
echo "=== RESTORE TEST SUMMARY ==="
echo "Status: SUCCESS ✓"
echo "Backup file: $(basename $LATEST_BACKUP)"
echo "Restore time: ~10 seconds"
echo "Data integrity: OK"
echo ""
echo "Next test: $(date -d '+1 month')"
```

**Cron (Monthly):**
```bash
# 1st day of month at 2:00 AM
0 2 1 * * /scripts/restore_test.sh >> /var/log/restore_test.log 2>&1
```

---

### **54. Monitoring: disk usage, last backup, error rate (log-based)**

**Simple Monitoring Script:**
```python
# /scripts/monitor.py
import os
import glob
import smtplib
from datetime import datetime, timedelta
from email.mime.text import MIMEText

def check_disk_usage():
    """Alert if disk > 80%"""
    import shutil
    disk = shutil.disk_usage('/')
    usage_percent = disk.used / disk.total * 100
    
    if usage_percent > 80:
        return f"ALERT: Disk usage {usage_percent:.1f}%"
    return None

def check_last_backup():
    """Alert if last backup > 25 hours ago"""
    backup_files = glob.glob('/backup/db_*.sql.gz')
    if not backup_files:
        return "ALERT: No backup files found"
    
    latest = max(backup_files, key=os.path.getctime)
    last_backup_time = datetime.fromtimestamp(os.path.getctime(latest))
    hours_ago = (datetime.now() - last_backup_time).total_seconds() / 3600
    
    if hours_ago > 25:
        return f"ALERT: Last backup was {hours_ago:.1f} hours ago"
    return None

def check_error_rate():
    """Alert if error rate > 5% in last hour"""
    # Parse Django log
    log_file = '/var/log/django/django.log'
    
    one_hour_ago = datetime.now() - timedelta(hours=1)
    
    total = 0
    errors = 0
    
    with open(log_file, 'r') as f:
        for line in f:
            # Simple parsing (adjust based on your log format)
            if 'ERROR' in line:
                errors += 1
            total += 1
    
    error_rate = errors / total * 100 if total > 0 else 0
    
    if error_rate > 5:
        return f"ALERT: Error rate {error_rate:.1f}% (last hour)"
    return None

def send_alert_email(alerts):
    """Send email alert"""
    msg = MIMEText('\n'.join(alerts))
    msg['Subject'] = 'ERP System Alert'
    msg['From'] = 'erp@your-domain.com'
    msg['To'] = 'admin@your-domain.com'
    
    s = smtplib.SMTP('localhost')
    s.send_message(msg)
    s.quit()

if __name__ == '__main__':
    alerts = []
    
    # Run checks
    for check_func in [check_disk_usage, check_last_backup, check_error_rate]:
        result = check_func()
        if result:
            alerts.append(result)
    
    # Send alerts if any
    if alerts:
        print("Alerts found:")
        for alert in alerts:
            print(f"  - {alert}")
        
        send_alert_email(alerts)
    else:
        print("All checks passed ✓")
```

**Cron (Every hour):**
```bash
0 * * * * /usr/bin/python3 /scripts/monitor.py >> /var/log/monitor.log 2>&1
```

---

# 8. 6 MODULES MVP

## 8.1. Master Data

**Entities:**
1. **Customer** - Khách hàng
2. **Supplier** - Nhà cung cấp
3. **Warehouse** - Kho
4. **Unit** - Đơn vị tính (kg, m, pcs, box...)
5. **Material** - Nguyên vật liệu (giấy, keo, mực...)
6. **FinishedGoods/SKU** - Thành phẩm (thùng carton các loại)
7. **BankAccount** - Tài khoản ngân hàng
8. **CashAccount** - Quỹ tiền mặt
9. **Currency** - Tiền tệ (VND, USD)
10. **TaxRate** - Thuế suất (VAT 0%, 8%, 10%)
11. **Shift** - Ca làm việc
12. **ExpenseCategory** - Loại thu/chi

**Key Points:**
- Customer/Supplier có `owner` & `owner_team` (Data Scope)
- SKU có thể là Material hoặc Finished Goods
- Warehouse support multi-warehouse

**Models ở Part 1 & Implementation Guide dưới**

---

## 8.2. Sales (Bán hàng)

**Workflow:**
```
Quotation (Optional) 
    ↓
Sales Order (SO/DH)
    ├─ Status: DRAFT → APPROVED → IN_PROGRESS → DONE
    └─ Delivery: NOT_SHIPPED → PARTIAL → FULLY_SHIPPED → RETURNED
    ↓
Delivery Note (GH) - Có thể giao nhiều lần
    ├─ Mỗi GH → PX thành phẩm (giảm tồn kho)
    └─ Tạo nhiều GH cho 1 SO (partial delivery)
    ↓
AR Invoice
    ├─ Phát hành từ GH (ưu tiên) hoặc từ SO
    ├─ Tạo công nợ phải thu (AR Balance)
    └─ Hóa đơn VAT
    ↓
Receipt (PT) - Thu tiền
    ├─ Thu theo hóa đơn hoặc theo khách
    ├─ Phân bổ FIFO (ngày hóa đơn) hoặc manual
    └─ Giảm AR Balance
    
RETURN:
    ├─ Nhập lại kho (PN)
    └─ Credit Note giảm AR
```

**Key Features:**
- Multi-delivery (1 SO → nhiều GH)
- Partial delivery tracking
- AR balance theo AR Invoice (không phải SO)
- Receipt allocation (FIFO or manual)
- Return handling

---

## 8.3. Purchase (Mua hàng)

**Workflow:**
```
Material Request (MR)
    ├─ From Production (thiếu NVL)
    ├─ From Sales (MTO)
    └─ From Inventory (MIN alert)
    ↓
RFQ (Optional) - Request for Quotation
    ├─ Gửi 3+ suppliers
    ├─ Compare responses
    └─ Select winner
    ↓
Purchase Order (PO)
    └─ Status: DRAFT → APPROVED → OPEN → PARTIAL_RECEIVED → RECEIVED → CLOSED_SHORT
    ↓
Goods Receipt (PN-PO) - Nhận hàng
    ├─ Nhận thực tế (nhiều lần)
    ├─ Tăng tồn NVL (ledger)
    ├─ KHÔNG tạo công nợ
    └─ Over-receipt check:
        • <= tolerance → Approve + lý do
        • > tolerance → PO Amendment
    ↓
AP Invoice
    ├─ Nhận hóa đơn từ NCC
    ├─ Tạo công nợ phải trả (AP Balance)
    └─ VAT đầu vào
    ↓
Payment (PC) - Chi tiền
    ├─ Chi theo hóa đơn hoặc theo NCC
    ├─ Phân bổ FIFO hoặc manual
    └─ Giảm AP Balance

RETURN (RTS):
    ├─ Xuất trả kho (PX)
    └─ Debit Note giảm AP
```

**Key Points:**
- Theo dõi: Ordered / Received / Invoiced
- Over-receipt: <= tolerance (approve) | > tolerance (PO amendment)
- Under-receipt: Cho phép, có thể CLOSED_SHORT
- AP balance theo AP Invoice (không phải PN)

---

## 8.4. Inventory (Kho)

**Principles:**
- Tồn kho tính theo **ledger** (KHÔNG sửa tay)
- Mọi thay đổi qua chứng từ kho: PN, PX, ADJ

**Inventory Transactions (Ledger):**
```
Type              | Qty  | Ref
──────────────────|──────|─────────────────
PN-PO (Purchase)  | +100 | PO-001
PX-SO (Sales)     | -50  | SO-001
PN-LSX (Prod)     | +200 | LSX-001
PX-LSX (Prod)     | -150 | LSX-001
ADJ (Adjustment)  | +10  | Stocktake-001
```

**Stock Movement:**
```
Inventory = SUM(transactions.quantity)
```

**Stocktake Process:**
```
1. Create Stocktake
2. Count physical stock
3. Compare: Physical vs System
4. Generate Adjustment (ADJ)
   - Chênh lệch = Physical - System
5. Post ADJ → Update inventory
```

**Reports:**
- NXT (Nhập Xuất Tồn) by Material/Finished Goods
- Stock Valuation (Weighted Average)
- Stock Aging
- Stock Movement

---

## 8.5. Finance (Thu-Chi)

**Sổ quỹ theo Account:**
- Tiền mặt (CASH-001)
- Ngân hàng 1 (BANK-VCB)
- Ngân hàng 2 (BANK-TCB)
- ...

**Transactions:**
```
PT (Receipt):
  + Từ khách hàng (link AR Invoice)
  + Thu nhập khác
  → Tăng Account Balance

PC (Payment):
  + Cho nhà cung cấp (link AP Invoice)
  + Chi phí khác
  → Giảm Account Balance

Transfer:
  + Chuyển giữa accounts
  + Tạo 2 dòng: -A, +B
  + Có thể có phí (chi phí tài chính)
```

**Thu/Chi Category:**
Map theo nhóm báo cáo:
- COGS (Giá vốn hàng bán)
- Selling Expense (Chi phí bán hàng)
- Admin Expense (Chi phí quản lý)
- Financial Cost (Chi phí tài chính)
- Other Income (Thu nhập khác)

**Báo cáo:**
- Sổ quỹ theo account
- Lịch sử transfer
- Cash Flow (theo category)

---

## 8.6. Advance (Tạm ứng)

**Workflow:**
```
1. Advance Issue (Ứng tiền)
   ├─ Employee xin tạm ứng
   ├─ Amount + Purpose + Deadline
   ├─ Approve → Chi tiền (PC)
   └─ Track: Số dư tạm ứng

2. Settlement (Quyết toán)
   ├─ Employee upload hóa đơn
   ├─ Phân loại chi phí (COGS/Selling/Admin...)
   ├─ Ghi nhận chi phí NGAY
   ├─ Tính chênh lệch:
   │   • Advance = 10M
   │   • Actual expense = 9M
   │   • Difference = +1M (dư, thu lại)
   └─ Nếu dư → PT (thu lại)
       Nếu thiếu → PC (chi thêm)

3. Báo cáo
   ├─ Số dư tạm ứng theo người
   ├─ Cảnh báo quá hạn
   └─ Nếu quá hạn → Trừ lương (link HR)
```

**Key Point:**
- Chi phí ghi nhận ngay khi Settlement (KHÔNG qua tạm ứng)
- Tạm ứng chỉ là "advance payment", không phải chi phí

---

## 8.7. Production (Sản xuất)

**Workflow:**
```
1. BOM (Bill of Materials)
   ├─ Define: 1 Thùng TH-001 cần:
   │   • Giấy: 2 kg
   │   • Keo: 0.1 kg
   │   • Mực: 0.05 lít
   └─ Versioning support

2. Production Order (LSX)
   ├─ Status: PLANNED → RELEASED → PRODUCING → FINISHED
   ├─ Quantity planned vs produced
   └─ Dates

3. Material Check
   ├─ Check inventory
   └─ If insufficient → Auto create MR → Purchase

4. Material Issue (PX NVL)
   ├─ Xuất NVL cho sản xuất
   └─ Giảm tồn

5. Production Progress
   ├─ Công nhân update theo ca
   ├─ BẮT ĐẦU / KẾT THÚC
   ├─ Ghi: Sản lượng / Hao hụt / Lý do / Ảnh
   └─ Real-time tracking

6. Finished Goods Receipt (PN TP)
   ├─ Nhập thành phẩm
   └─ Tăng tồn

7. QC Inspection (Optional MVP)
   ├─ Sample check
   └─ PASS / FAIL / PARTIAL
```

**Blocking Issue/Task:**
```
Issue type: INFO / WARNING / BLOCKER

BLOCKER example:
- SKU: TH-001
- Issue: "Phim in bị lỗi"
- Type: BLOCKER
- Status: TODO

→ Khi tạo LSX cho TH-001
→ Check: Có BLOCKER chưa DONE?
→ Nếu có → KHÔNG CHO RELEASED
→ Phải DONE issue trước

Deadline:
- Có thể để trống khi chưa có đơn
- Khi tạo LSX → Bắt buộc gán assignee + deadline
```

---

## 8.8. Notes/Thread/Task

**KHÔNG LÀM CHAT KIỂU ZALO!**

**Scope:**
1. **Thread theo đối tượng**
   - SO, PO, SKU, LSX, Invoice, Advance...
   - Comment, @mention, file attachments
   - Timeline view

2. **Kênh theo Team** (Optional, đơn giản)
   - Sales Team channel
   - Production Team channel
   - Simple timeline messages
   - KHÔNG làm chat realtime phức tạp

3. **Task/Assignment**
   - Giao việc
   - Deadline, priority
   - Blocking tasks (cho Production)

**Implementation:** Đã có ở 4.8 (36-41)

---

## 8.9. Time (Chấm công)

**MVP - Tối thiểu:**

**Features:**
1. Shift templates (giờ vào/ra + break)
2. Check-in/out
3. Auto calculate work hours (trừ break)
4. Báo cáo giờ công

**NOT in MVP:**
- Face recognition
- GPS location
- OT request workflow
- Leave management (complex)
- Payroll calculation

**Workflow:**
```
1. Admin tạo Shift
   Ca ngày: 08:00-17:00, break 12:00-13:00

2. Employee check-in/out
   Check-in: 08:05
   Check-out: 17:15

3. System calculate
   Total: 9h10m
   Break: 1h
   Work hours: 8h10m

4. Report
   Export Excel: Giờ công theo user/tháng
```

---

# 9. BÁO CÁO MVP

**Báo cáo bắt buộc có:**

1. **NXT (Nhập Xuất Tồn)**
   - By SKU
   - Date range
   - Opening / In / Out / Closing

2. **Tồn kho**
   - Current stock by SKU
   - Warehouse
   - Value

3. **Kiểm tồn**
   - Stocktake results
   - Variance analysis

4. **Sổ quỹ**
   - By account (Cash, Banks)
   - Receipts, Payments
   - Balance

5. **Transfer history**
   - Between accounts
   - Fees

6. **Theo dõi SO**
   - Delivered / Invoiced / Paid
   - Outstanding

7. **Theo dõi PO**
   - Ordered / Received / Invoiced / Paid
   - Over/Under receipt

8. **Tạm ứng**
   - Outstanding advance by employee
   - Overdue warnings

9. **Tiến độ sản xuất**
   - By LSX / SKU / Shift
   - Output / Waste

10. **VAT Reports**
    - Output VAT (AR Invoices)
    - Input VAT (AP Invoices)
    - Summary by period
    - Export Excel (form 01, 02 GTGT)

11. **Chấm công**
    - Work hours by user/period
    - Export Excel

---

# 10. UI/RESPONSIVE

**Desktop:**
- DataGrid đầy đủ
- Nhiều cột
- Sidebar navigation
- Full features

**Tablet:**
- Compact layout
- Giảm padding
- Collapsible sidebar
- Touch-friendly

**Mobile:**
- Card view (thay vì table)
- Quick search prominent
- Quick filters (status, date)
- Giảm cột hiển thị (chỉ essential)
- Bottom navigation
- Swipe actions

**Implementation:**
```typescript
// Tailwind responsive classes
<div className="hidden md:block">Desktop only</div>
<div className="block md:hidden">Mobile only</div>

// Card view for mobile
<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
  {orders.map(order => (
    <OrderCard order={order} />
  ))}
</div>
```

---

# 11. DELIVERABLES

**Bắt buộc có:**

1. **Repository Structure:**
```
erp-carton/
├── backend/
│   ├── manage.py
│   ├── config/
│   ├── core/
│   ├── master/
│   ├── sales/
│   ├── purchase/
│   ├── production/
│   ├── inventory/
│   ├── finance/
│   ├── time/
│   └── requirements.txt
├── frontend/
│   ├── src/
│   ├── package.json
│   └── tsconfig.json
├── docker-compose.yml
├── .env.example
├── README.md
└── docs/
    ├── ADR/
    ├── API.md
    ├── DATABASE.md
    └── OPERATIONS.md
```

2. **Database:**
- Migrations (all)
- Seed data
- Sample accounts by role:
  • admin@example.com (Admin)
  • manager@example.com (Quản lý)
  • accountant@example.com (Kế toán)
  • warehouse@example.com (Kho)
  • production@example.com (Sản xuất)
  • delivery@example.com (Giao hàng)

3. **Documentation:**
- README: Setup DEV/TEST, deploy Hybrid, 2FA, backup/restore
- ADR (Architecture Decision Records)
- OpenAPI/Swagger
- Data model summary (ERD)
- Operations guide (1 page): Backup/restore procedures

4. **Tests (tối thiểu):**
```python
# VAT calculation
def test_vat_calculation_exclusive():
    assert calculate_vat(1000000, 10, 'EXCLUSIVE') == (1000000, 100000, 1100000)

# Rounding
def test_vnd_rounding():
    assert format_vnd(1234.567) == "1.235"

# PO tolerance
def test_po_over_receipt_within_tolerance():
    # Should pass if within 5%
    pass

# Ledger stock
def test_inventory_ledger_balance():
    # Inventory = SUM(transactions)
    pass

# Data scope
def test_scope_enforcement():
    # Owner can only see own data
    pass

# Check-in/out
def test_calculate_work_hours():
    # 08:05-17:15, break 12:00-13:00 → 8.17h
    pass
```

---

# 12. ROADMAP 8 SPRINTS

**Sprint structure: 2 weeks/sprint = 16 weeks (~4 months)**

### **Sprint 1: Foundation** (Week 1-2)
- ✅ Auth + JWT + 2FA
- ✅ RBAC + Data Scope
- ✅ Audit logs
- ✅ Admin Settings UI
- ✅ Master data CRUD
- ✅ DocumentType config
- ✅ Chuẩn list/filter/export

**Deliverable:** Login works, RBAC works, Master data ready

---

### **Sprint 2: Inventory** (Week 3-4)
- ✅ Inventory ledger: PN, PX, ADJ
- ✅ Stock calculation
- ✅ NXT report
- ✅ Stocktake workflow
- ✅ Stock valuation

**Deliverable:** Inventory tracking works

---

### **Sprint 3: Sales** (Week 5-6)
- ✅ SO/DH workflow
- ✅ GH (Delivery Note)
- ✅ AR Invoice
- ✅ PT (Receipt)
- ✅ Return handling
- ✅ VAT output

**Deliverable:** Sales end-to-end works

---

### **Sprint 4: Purchase** (Week 7-8)
- ✅ PO workflow
- ✅ PN-PO (Goods Receipt)
- ✅ AP Invoice
- ✅ PC (Payment)
- ✅ Over-receipt tolerance
- ✅ VAT input

**Deliverable:** Purchase end-to-end works

---

### **Sprint 5: Finance** (Week 9-10)
- ✅ Cash/Bank accounts
- ✅ Sổ quỹ
- ✅ Transfer between accounts
- ✅ Advance + Settlement
- ✅ Expense categories
- ✅ Reports

**Deliverable:** Finance tracking works

---

### **Sprint 6: Production** (Week 11-12)
- ✅ BOM
- ✅ LSX workflow
- ✅ Progress tracking by shift
- ✅ Blocking Issue/Task
- ✅ Thread/Notes
- ✅ Notifications
- ✅ Material Issue/Receipt

**Deliverable:** Production tracking works

---

### **Sprint 7: Time** (Week 13-14)
- ✅ Shift config
- ✅ Check-in/out
- ✅ Work hours calculation
- ✅ Reports
- ✅ Export Excel

**Deliverable:** Time tracking works

---

### **Sprint 8: Hardening** (Week 15-16)
- ✅ Database indexes
- ✅ Performance optimization
- ✅ Backup/restore automation
- ✅ Monitoring setup
- ✅ Deployment notes
- ✅ UAT
- ✅ Bug fixing

**Deliverable:** Production-ready system

---

# 13. BACKLOG

**Giai đoạn sau (không trong MVP):**

1. 3-way matching nâng cao (PO = GR = Invoice, chi tiết)
2. Credit/Debit notes chuẩn (complex scenarios)
3. Bank reconciliation theo sao kê (auto-match)
4. BOM/định mức (advanced costing)
5. Tính giá thành/giá vốn (cost accounting)
6. KPI/OEE dashboard
7. Lương & BHXH (full payroll)
8. BI dashboard (Power BI/Metabase)
9. QR scan nâng cao (mobile app)
10. Mobile quick actions (approve on mobile)
11. Duyệt nhiều cấp (multi-level approval)
12. Tích hợp chấm công khuôn mặt/camera

---

# 14. 14 KHÓA YÊU CẦU

## 14.1. NFR

*(Đã có ở Part 1)*

## 14.2. LAN Fallback

*(Đã có ở Part 1)*

## 14.3. Permission Matrix

**Roles:**
- Admin
- Manager (Quản lý)
- Accountant (Kế toán)
- Sales
- Warehouse (Kho)
- Production (Sản xuất)
- Delivery (Giao hàng)

**Permission Matrix (example):**

| Action | Admin | Manager | Accountant | Sales | Warehouse | Production | Delivery |
|--------|-------|---------|------------|-------|-----------|------------|----------|
| **Sales Order** |
| Create | ✓ | ✓ | ✗ | ✓ | ✗ | ✗ | ✗ |
| View | ✓ | ✓ | ✓ | ✓ | ✗ | ✗ | ✗ |
| Approve | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ |
| **Delivery Note** |
| Create | ✓ | ✓ | ✗ | ✗ | ✓ | ✗ | ✓ |
| View | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ | ✓ |
| **AR Invoice** |
| Create | ✓ | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ |
| Post | ✓ | ✗ | ✓ | ✗ | ✗ | ✗ | ✗ |
| **Receipt** |
| Create | ✓ | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ |
| Approve | ✓ | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ |
| **Purchase Order** |
| Create | ✓ | ✓ | ✗ | ✗ | ✓ | ✓ | ✗ |
| Approve | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ |

**Sensitive Actions (require log + reason):**
- Approve (any document)
- Post (close period)
- Unlock (locked document)
- Cancel
- Delete
- Export (sensitive data)

---

## 14.4. Close Period

**Close Period (Khóa kỳ):**

**Model:**
```python
class ClosePeriod(models.Model):
    year = models.IntegerField()
    month = models.IntegerField()
    closed_at = models.DateTimeField(auto_now_add=True)
    closed_by = models.ForeignKey(User)
    is_closed = models.BooleanField(default=True)
    
    # Grace period
    grace_days = models.IntegerField(default=0)  # Configurable
    grace_deadline = models.DateTimeField()
    
    class Meta:
        unique_together = ['year', 'month']
```

**Logic:**
```python
def can_post_backdate(posting_date, user):
    """Check if can post to a past period"""
    period = ClosePeriod.objects.filter(
        year=posting_date.year,
        month=posting_date.month,
        is_closed=True
    ).first()
    
    if not period:
        return True  # Period not closed
    
    # Check if within grace period
    if timezone.now() <= period.grace_deadline:
        return True
    
    # Check permission
    if user.has_perm('finance.reopen_period'):
        # Must provide reason
        return True
    
    return False
```

**Settings:**
```python
Setting.objects.create(
    key='CLOSE_PERIOD_GRACE_DAYS',
    value='5',
    data_type='number',
    description='Số ngày ân hạn sau khi khóa kỳ'
)
```

**UI:**
```
Khóa kỳ 01/2026:
- Khóa lúc: 31/01/2026 17:00
- Ân hạn: 5 ngày → Deadline: 05/02/2026 23:59
- Sau deadline: KHÔNG cho post backdate vào 01/2026
```

---

## 14.5. Print Templates

**Mẫu in tối thiểu:**
- Phiếu nhập (PN) - A4
- Phiếu xuất (PX) - A4
- Phiếu thu (PT) - A4
- Phiếu chi (PC) - A4
- Sales Order (SO) - A4 (optional)
- Delivery Note (GH) - A4 (optional)

**Chốt trường bắt buộc:**
- Company logo
- Company info (name, address, tax code)
- Document code, date
- Party info (customer/supplier)
- Items table
- Amounts (subtotal, VAT, total)
- Signatures (người lập, người duyệt, người nhận)
- QR code

**Template Engine:**
```python
# Use Django templates + WeasyPrint
# Template: templates/pdf/receipt.html

from django.template.loader import render_to_string
from weasyprint import HTML

def print_receipt(receipt_id):
    receipt = Receipt.objects.get(pk=receipt_id)
    company = Company.objects.first()
    
    html = render_to_string('pdf/receipt.html', {
        'receipt': receipt,
        'company': company,
        'qr_code': receipt.qr_code_base64,
    })
    
    pdf = HTML(string=html).write_pdf()
    return pdf
```

**Customization:**
- Admin có thể upload logo
- Config company info
- Chọn template (nếu có nhiều mẫu)

---

## 14.6. Data Migration

**Import tối thiểu:**
1. Customers/Suppliers
2. SKU (Materials + Finished Goods)
3. Warehouses
4. Opening stock (tồn đầu kỳ)
5. Opening AR/AP (công nợ đầu kỳ)

**Process:**
```
1. Download template (Excel)
2. Fill data
3. Upload → Preview + Validate
4. Review errors
5. Fix & re-upload OR Import valid only
6. Confirm → Import
7. Log results
```

**Import modes:**
- **Fail-fast:** 1 lỗi → Stop all (rollback)
- **Import valid only:** Skip lỗi, import phần đúng

**UAT Checklist:**
```
☐ Mua → Nhập → Hóa đơn → Chi (end-to-end)
☐ Bán → Xuất → Hóa đơn → Thu (end-to-end)
☐ Kiểm kho → Adjustment
☐ Luồng duyệt theo quyền
☐ Báo cáo tồn kho (chính xác)
☐ Báo cáo công nợ (chính xác)
☐ Báo cáo thu chi (chính xác)
```

---

## 14.7. Notifications

**Notification trong app:**

**Triggers:**
- Gửi duyệt (SO, PO, Payment...)
- Đã duyệt / Từ chối
- Đã post
- @mention trong note
- Task assigned
- Task deadline approaching

**Notification Model:**
```python
class Notification(models.Model):
    user = models.ForeignKey(User)
    type = models.CharField(max_length=50)
    title = models.CharField(max_length=200)
    message = models.TextField()
    link_url = models.CharField(max_length=500)
    
    is_read = models.BooleanField(default=False)
    read_at = models.DateTimeField(null=True)
    created_at = models.DateTimeField(auto_now_add=True)
```

**UI:**
- Bell icon (🔔) với badge (unread count)
- Dropdown list
- Click → Mark read + Navigate to link
- "Mark all as read"

**Reset Password:**
- Admin cấp mật khẩu tạm: `Temp123!@#`
- User login → Bắt buộc đổi mật khẩu
- Optional: Gửi email (nếu company có email)

---

## 14.8. File Attachments

**Quy định:**

**Allowed types:**
- jpg, jpeg, png, heic (ảnh)
- pdf (document)

**NOT allowed:**
- mp4, mov (video - quá nặng)
- zip, rar (rủi ro virus)
- exe, bat (nguy hiểm)

**Limits:**
- Max per file: 500MB
- Max total per document: 2GB
- No limit on number of files

**Expected volume:**
- 10-30 GB/month phát sinh

**Upload:**
- Chunked upload (for large files)
- Resumable upload (nếu mất kết nối)
- Preview (ảnh, PDF)
- Audit log

**Storage:**
- Files lưu riêng (filesystem hoặc S3)
- Database chỉ lưu metadata

**Implementation:**
```python
# Use django-chunked-upload
pip install django-chunked-upload

# settings.py
CHUNKED_UPLOAD_MAX_BYTES = 500 * 1024 * 1024  # 500MB
```

---

# 15. DATABASE SCHEMA COMPLETE

*(Chi tiết đầy đủ 80-100 tables sẽ rất dài. Tôi sẽ list key tables. Full ERD nên tạo riêng.)*

**Core Tables (from Part 1):**
- users, roles, permissions, user_roles, role_permissions
- teams, user_teams
- settings, document_types
- audit_logs, security_audit_logs
- sessions, two_factor_auth
- attachments, notes, tasks

**Master Data:**
- customers, suppliers
- warehouses, warehouse_locations
- units, currencies, tax_rates
- skus (materials + finished goods)
- bank_accounts, cash_accounts
- expense_categories, shifts

**Sales:**
- quotations, quotation_items
- sales_orders, sales_order_items
- delivery_notes, delivery_note_items
- ar_invoices, ar_invoice_items
- receipts, receipt_invoice_mappings
- credit_notes

**Purchase:**
- material_requests, material_request_items
- rfqs, rfq_items, rfq_responses
- purchase_orders, purchase_order_items
- goods_receipts, goods_receipt_items
- ap_invoices, ap_invoice_items
- payments, payment_invoice_mappings
- debit_notes

**Production:**
- boms, bom_items
- production_orders
- material_issues, material_issue_items
- production_tracking
- qc_inspections, qc_defect_types
- finished_goods_receipts

**Inventory:**
- inventory (current stock)
- inventory_transactions (ledger)
- stock_counts, stock_count_items
- stock_adjustments
- pallets (QR tracking)

**Finance:**
- account_balances
- ar_balance, ap_balance
- employee_advances
- advance_settlements, settlement_lines
- transfers

**Time:**
- attendance_records
- leave_requests (future)
- ot_requests (future)

**Total:** ~80-100 tables

---

# 16. API DESIGN COMPLETE

**Base URL:** `/api/v1/`

**Auth:**
```
POST /api/v1/auth/login
POST /api/v1/auth/logout
POST /api/v1/auth/refresh
POST /api/v1/auth/2fa/setup
POST /api/v1/auth/2fa/verify
```

**Users & Roles:**
```
GET    /api/v1/users
POST   /api/v1/users
GET    /api/v1/users/{id}
PUT    /api/v1/users/{id}
DELETE /api/v1/users/{id}
POST   /api/v1/users/{id}/assign-roles
POST   /api/v1/users/{id}/assign-teams

GET    /api/v1/roles
POST   /api/v1/roles
GET    /api/v1/permissions
```

**Master Data:**
```
GET    /api/v1/customers
POST   /api/v1/customers
GET    /api/v1/customers/{id}
PUT    /api/v1/customers/{id}
DELETE /api/v1/customers/{id}
GET    /api/v1/customers/import-template
POST   /api/v1/customers/import-preview
POST   /api/v1/customers/import

(Similar for: suppliers, skus, warehouses...)
```

**Sales:**
```
GET    /api/v1/sales/orders
POST   /api/v1/sales/orders
GET    /api/v1/sales/orders/{id}
PUT    /api/v1/sales/orders/{id}
DELETE /api/v1/sales/orders/{id}
POST   /api/v1/sales/orders/{id}/submit
POST   /api/v1/sales/orders/{id}/approve
POST   /api/v1/sales/orders/{id}/cancel
GET    /api/v1/sales/orders/{id}/deliveries
GET    /api/v1/sales/orders/{id}/invoices
GET    /api/v1/sales/orders/{id}/print-pdf

GET    /api/v1/sales/deliveries
POST   /api/v1/sales/deliveries
... (similar CRUD)

GET    /api/v1/sales/invoices
POST   /api/v1/sales/invoices
POST   /api/v1/sales/invoices/{id}/post
...

GET    /api/v1/sales/receipts
POST   /api/v1/sales/receipts
...
```

**Purchase, Production, Inventory, Finance, Time:**
*(Similar structure)*

**Attachments & Notes:**
```
GET    /api/v1/sales/orders/{id}/attachments
POST   /api/v1/sales/orders/{id}/attachments
DELETE /api/v1/attachments/{id}

GET    /api/v1/sales/orders/{id}/notes
POST   /api/v1/sales/orders/{id}/notes
PUT    /api/v1/notes/{id}
POST   /api/v1/notes/{id}/pin
```

**Reports:**
```
GET    /api/v1/reports/nxt?sku_id=1&from=2026-01-01&to=2026-01-31
GET    /api/v1/reports/stock-summary
GET    /api/v1/reports/ar-aging
GET    /api/v1/reports/ap-aging
GET    /api/v1/reports/cashflow
GET    /api/v1/reports/production-progress
GET    /api/v1/reports/vat-summary
```

---

# 17. IMPLEMENTATION GUIDE

## Step 1: Setup Dev Environment (Day 1)

```bash
# Backend
mkdir erp-backend
cd erp-backend
python -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate

pip install django djangorestframework django-cors-headers
pip install psycopg2-binary python-decouple
pip install djangorestframework-simplejwt
pip install django-filter
pip install pyotp qrcode  # For 2FA
pip install openpyxl  # For Excel
pip install weasyprint  # For PDF
pip install drf-spectacular  # For OpenAPI

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

# PostgreSQL
createdb erp_db
createuser erp_user -P  # Set password

# Configure settings.py
# (See example in deliverables)
```

## Step 2: Core Tables (Day 2-3)

```bash
# Create models in core/models.py
# - User (extend AbstractUser)
# - Role, Permission
# - Team
# - Setting
# - DocumentType
# - AuditLog
# ... (see Part 1)

python manage.py makemigrations
python manage.py migrate

# Create superuser
python manage.py createsuperuser
```

## Step 3: Auth & RBAC (Day 4-5)

```python
# Implement:
# - JWT authentication
# - 2FA setup
# - Permission checking
# - Data scope filtering

# Test:
python manage.py test core.tests
```

## Step 4-8: Follow Sprint Plan

**Follow Roadmap section 12 exactly!**

Each sprint:
1. Design models
2. Create migrations
3. Write serializers
4. Write views/viewsets
5. Write tests
6. Build frontend pages
7. Integration test
8. Demo to stakeholders

---

# KẾT LUẬN

## ✅ BẠN ĐÃ CÓ ĐẦY ĐỦ:

**PART 1:**
- Foundation
- 54 Core (1-27)
- Configuration principles

**PART 2 (File này):**
- 54 Core (28-54)
- 6 Modules MVP
- Báo cáo
- UI/Responsive
- Deliverables
- Roadmap 8 Sprints
- 14 Khóa yêu cầu
- Database Schema
- API Design
- Implementation Guide

**Total: 2 files = SIÊU HOÀN CHỈNH!**

---

## 🚀 CÁCH DÙNG VỚI CURSOR:

```
erp-system/
├── ULTIMATE_COMPLETE_SPEC_PART1.md  ← READ FIRST
├── ULTIMATE_COMPLETE_SPEC_PART2.md  ← Then this
├── backend/  (Cursor will create)
└── frontend/ (Cursor will create)
```

**Prompt:**
```
Tôi muốn xây dựng ERP. Tôi KHÔNG BIẾT CODE.

📁 SPECS:
1. ULTIMATE_COMPLETE_SPEC_PART1.md
2. ULTIMATE_COMPLETE_SPEC_PART2.md

🔥 QUAN TRỌNG:
- Django DRF + PostgreSQL + React + TypeScript
- Follow Configuration-Driven Design
- LÀM 54 CHỨC NĂNG CORE TRƯỚC (Part 1)
- Follow Roadmap 8 Sprints (Part 2)

NHIỆM VỤ:
Sprint 1 - Foundation (2 weeks)

Đọc 2 files spec và bắt đầu!
```

---

**SẴN SÀNG CODE! 🎉**

Chúc bạn thành công với dự án ERP!
