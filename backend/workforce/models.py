from django.conf import settings
from django.db import models
from unidecode import unidecode


class SearchTextModelMixin(models.Model):
    search_text = models.TextField(default='', blank=True)

    class Meta:
        abstract = True

    def _search_values(self):
        return []

    def _build_search_text(self):
        combined = ' '.join(str(p).strip() for p in self._search_values() if p not in (None, ''))
        self.search_text = unidecode(combined).lower() if combined else ''


class Employee(SearchTextModelMixin):
    STATUS_ACTIVE = 'ACTIVE'
    STATUS_ON_LEAVE = 'ON_LEAVE'
    STATUS_RESIGNED = 'RESIGNED'
    STATUS_CHOICES = [
        (STATUS_ACTIVE, 'Đang làm'),
        (STATUS_ON_LEAVE, 'Tạm nghỉ'),
        (STATUS_RESIGNED, 'Nghỉ việc'),
    ]

    code = models.CharField(max_length=30, unique=True, verbose_name='Mã nhân viên')
    name = models.CharField(max_length=150, verbose_name='Họ tên')
    cccd = models.CharField(max_length=20, blank=True, default='', verbose_name='CCCD')
    birth_date = models.DateField(null=True, blank=True, verbose_name='Ngày sinh')
    gender = models.CharField(max_length=10, blank=True, default='', verbose_name='Giới tính')
    address = models.CharField(max_length=255, blank=True, default='', verbose_name='Địa chỉ')
    phone = models.CharField(max_length=20, blank=True, default='', verbose_name='Điện thoại')
    email = models.EmailField(blank=True, default='', verbose_name='Email')
    department = models.CharField(max_length=120, blank=True, default='', verbose_name='Phòng ban')
    position = models.CharField(max_length=120, blank=True, default='', verbose_name='Chức vụ')
    start_date = models.DateField(null=True, blank=True, verbose_name='Ngày vào làm')
    status = models.CharField(
        max_length=20,
        choices=STATUS_CHOICES,
        default=STATUS_ACTIVE,
        verbose_name='Trạng thái',
    )
    salary_basic = models.DecimalField(max_digits=15, decimal_places=2, default=0, verbose_name='Lương cơ bản')
    bank_account_number = models.CharField(max_length=50, blank=True, default='', verbose_name='Số tài khoản')
    bank_name = models.CharField(max_length=120, blank=True, default='', verbose_name='Ngân hàng')
    bank_branch = models.CharField(max_length=120, blank=True, default='', verbose_name='Chi nhánh')
    note = models.TextField(blank=True, default='', verbose_name='Ghi chú')

    is_active = models.BooleanField(default=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='workforce_employees_created',
    )
    updated_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='workforce_employees_updated',
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'workforce_employees'
        ordering = ['code']
        indexes = [
            models.Index(fields=['code']),
            models.Index(fields=['name']),
            models.Index(fields=['status']),
            models.Index(fields=['is_active']),
        ]

    def __str__(self):
        return f'{self.code} - {self.name}'

    def _search_values(self):
        status_label = dict(self.STATUS_CHOICES).get(self.status, '')
        parts = [
            self.code,
            self.name,
            self.cccd,
            self.gender,
            self.address,
            self.phone,
            self.email,
            self.department,
            self.position,
            str(self.salary_basic or ''),
            self.bank_account_number,
            self.bank_name,
            self.bank_branch,
            self.note,
            self.status,
            status_label,
            'Đang làm' if self.is_active else 'Ngừng dùng',
        ]
        if self.birth_date:
            parts.append(self.birth_date.isoformat())
        if self.start_date:
            parts.append(self.start_date.isoformat())
        return parts

    def save(self, *args, **kwargs):
        if self.code:
            self.code = str(self.code).strip().upper()
        self._build_search_text()
        super().save(*args, **kwargs)


class AttendanceRecord(SearchTextModelMixin):
    employee = models.ForeignKey(
        Employee,
        on_delete=models.CASCADE,
        related_name='attendance_records',
        verbose_name='Nhân viên',
    )
    month = models.CharField(max_length=7, verbose_name='Tháng', help_text='Định dạng YYYY-MM')
    standard_days = models.DecimalField(max_digits=5, decimal_places=2, default=26, verbose_name='Ngày công chuẩn')
    actual_days = models.DecimalField(max_digits=5, decimal_places=2, default=0, verbose_name='Ngày công thực tế')
    paid_leave = models.DecimalField(max_digits=5, decimal_places=2, default=0, verbose_name='Nghỉ phép')
    unpaid_leave = models.DecimalField(max_digits=5, decimal_places=2, default=0, verbose_name='Nghỉ không phép')
    note = models.TextField(blank=True, default='', verbose_name='Ghi chú')
    is_active = models.BooleanField(default=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='workforce_attendance_created',
    )
    updated_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='workforce_attendance_updated',
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'workforce_attendance_records'
        ordering = ['-month', 'employee__code']
        unique_together = [('employee', 'month')]
        indexes = [
            models.Index(fields=['month']),
            models.Index(fields=['employee', 'month']),
            models.Index(fields=['is_active']),
        ]

    def __str__(self):
        return f'{self.employee.code} - {self.month}'

    @property
    def total_overtime_hours(self):
        return self.overtime_items.aggregate(total=models.Sum('hours')).get('total') or 0

    def _search_values(self):
        return [
            self.employee.code if self.employee_id else '',
            self.employee.name if self.employee_id else '',
            self.month,
            str(self.standard_days),
            str(self.actual_days),
            str(self.paid_leave),
            str(self.unpaid_leave),
            self.note,
            'Đang dùng' if self.is_active else 'Ngừng dùng',
        ]

    def save(self, *args, **kwargs):
        self._build_search_text()
        super().save(*args, **kwargs)


class AttendanceOvertimeItem(SearchTextModelMixin):
    DAY_TYPE_WEEKDAY = 'WEEKDAY'
    DAY_TYPE_SUNDAY = 'SUNDAY'
    DAY_TYPE_HOLIDAY = 'HOLIDAY'
    DAY_TYPE_CHOICES = [
        (DAY_TYPE_WEEKDAY, 'Ngày thường'),
        (DAY_TYPE_SUNDAY, 'Chủ nhật'),
        (DAY_TYPE_HOLIDAY, 'Ngày lễ'),
    ]

    SHIFT_MORNING = 'MORNING'
    SHIFT_AFTERNOON = 'AFTERNOON'
    SHIFT_EVENING = 'EVENING'
    SHIFT_NIGHT = 'NIGHT'
    SHIFT_FULLDAY = 'FULLDAY'
    SHIFT_CHOICES = [
        (SHIFT_MORNING, 'Sáng'),
        (SHIFT_AFTERNOON, 'Chiều'),
        (SHIFT_EVENING, 'Tối'),
        (SHIFT_NIGHT, 'Đêm'),
        (SHIFT_FULLDAY, 'Cả ngày'),
    ]

    attendance = models.ForeignKey(
        AttendanceRecord,
        on_delete=models.CASCADE,
        related_name='overtime_items',
        verbose_name='Bảng chấm công',
    )
    overtime_date = models.DateField(verbose_name='Ngày tăng ca')
    day_type = models.CharField(max_length=20, choices=DAY_TYPE_CHOICES, default=DAY_TYPE_WEEKDAY, verbose_name='Loại ngày')
    shift = models.CharField(max_length=20, choices=SHIFT_CHOICES, default=SHIFT_EVENING, verbose_name='Buổi')
    hours = models.DecimalField(max_digits=5, decimal_places=2, default=0, verbose_name='Số giờ')
    rate = models.DecimalField(max_digits=4, decimal_places=2, default=1.5, verbose_name='Hệ số')
    note = models.TextField(blank=True, default='', verbose_name='Ghi chú')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'workforce_attendance_overtime_items'
        ordering = ['overtime_date', 'id']
        indexes = [
            models.Index(fields=['overtime_date']),
            models.Index(fields=['day_type']),
            models.Index(fields=['shift']),
        ]

    def __str__(self):
        return f'{self.attendance_id} - {self.overtime_date} ({self.hours}h)'

    def _search_values(self):
        return [
            self.attendance.employee.code if self.attendance_id else '',
            self.attendance.employee.name if self.attendance_id else '',
            self.overtime_date.isoformat() if self.overtime_date else '',
            self.day_type,
            dict(self.DAY_TYPE_CHOICES).get(self.day_type, ''),
            self.shift,
            dict(self.SHIFT_CHOICES).get(self.shift, ''),
            str(self.hours),
            str(self.rate),
            self.note,
        ]

    def save(self, *args, **kwargs):
        self._build_search_text()
        super().save(*args, **kwargs)


class BonusPenaltyRecord(SearchTextModelMixin):
    TYPE_BONUS = 'BONUS'
    TYPE_PENALTY = 'PENALTY'
    TYPE_CHOICES = [
        (TYPE_BONUS, 'Thưởng'),
        (TYPE_PENALTY, 'Phạt'),
    ]

    CALC_FIXED = 'FIXED'
    CALC_DAILY_RATIO = 'DAILY_RATIO'
    CALC_CHOICES = [
        (CALC_FIXED, 'Cố định'),
        (CALC_DAILY_RATIO, 'Theo ngày công'),
    ]

    employee = models.ForeignKey(
        Employee,
        on_delete=models.CASCADE,
        related_name='bonus_penalty_records',
        verbose_name='Nhân viên',
    )
    month = models.CharField(max_length=7, verbose_name='Tháng', help_text='Định dạng YYYY-MM')
    record_type = models.CharField(max_length=20, choices=TYPE_CHOICES, default=TYPE_BONUS, verbose_name='Loại')
    reason = models.CharField(max_length=255, verbose_name='Lý do')
    amount = models.DecimalField(max_digits=15, decimal_places=2, verbose_name='Số tiền')
    calculation_type = models.CharField(max_length=20, choices=CALC_CHOICES, default=CALC_FIXED, verbose_name='Cách tính')
    record_date = models.DateField(verbose_name='Ngày ghi nhận')
    approved_by_name = models.CharField(max_length=120, blank=True, default='', verbose_name='Người duyệt')
    note = models.TextField(blank=True, default='', verbose_name='Ghi chú')
    is_active = models.BooleanField(default=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='workforce_bonus_penalty_created',
    )
    updated_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='workforce_bonus_penalty_updated',
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'workforce_bonus_penalty_records'
        ordering = ['-record_date', '-id']
        indexes = [
            models.Index(fields=['month']),
            models.Index(fields=['record_type']),
            models.Index(fields=['employee', 'month']),
            models.Index(fields=['is_active']),
        ]

    def __str__(self):
        return f'{self.employee.code} - {self.month} - {self.record_type}'

    def _search_values(self):
        return [
            self.employee.code if self.employee_id else '',
            self.employee.name if self.employee_id else '',
            self.month,
            self.record_type,
            dict(self.TYPE_CHOICES).get(self.record_type, ''),
            self.reason,
            str(self.amount),
            self.calculation_type,
            dict(self.CALC_CHOICES).get(self.calculation_type, ''),
            self.record_date.isoformat() if self.record_date else '',
            self.approved_by_name,
            self.note,
            'Đang dùng' if self.is_active else 'Ngừng dùng',
        ]

    def save(self, *args, **kwargs):
        self._build_search_text()
        super().save(*args, **kwargs)


class SalaryAdvanceRecord(SearchTextModelMixin):
    STATUS_UNDEDUCTED = 'UNDEDUCTED'
    STATUS_DEDUCTED = 'DEDUCTED'
    STATUS_CHOICES = [
        (STATUS_UNDEDUCTED, 'Chưa trừ'),
        (STATUS_DEDUCTED, 'Đã trừ'),
    ]

    employee = models.ForeignKey(
        Employee,
        on_delete=models.CASCADE,
        related_name='salary_advances',
        verbose_name='Nhân viên',
    )
    advance_date = models.DateField(verbose_name='Ngày ứng')
    month = models.CharField(max_length=7, verbose_name='Tháng trừ lương', help_text='Định dạng YYYY-MM')
    amount = models.DecimalField(max_digits=15, decimal_places=2, verbose_name='Số tiền ứng')
    reason = models.CharField(max_length=255, blank=True, default='Ứng lương', verbose_name='Lý do')
    approved_by_name = models.CharField(max_length=120, blank=True, default='', verbose_name='Người duyệt')
    note = models.TextField(blank=True, default='', verbose_name='Ghi chú')
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default=STATUS_UNDEDUCTED, verbose_name='Trạng thái')
    is_active = models.BooleanField(default=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='workforce_salary_advance_created',
    )
    updated_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='workforce_salary_advance_updated',
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'workforce_salary_advance_records'
        ordering = ['-advance_date', '-id']
        indexes = [
            models.Index(fields=['month']),
            models.Index(fields=['employee', 'month']),
            models.Index(fields=['status']),
            models.Index(fields=['is_active']),
        ]

    def __str__(self):
        return f'{self.employee.code} - {self.month} - {self.amount}'

    def _search_values(self):
        return [
            self.employee.code if self.employee_id else '',
            self.employee.name if self.employee_id else '',
            self.advance_date.isoformat() if self.advance_date else '',
            self.month,
            str(self.amount),
            self.reason,
            self.approved_by_name,
            self.note,
            self.status,
            dict(self.STATUS_CHOICES).get(self.status, ''),
            'Đang dùng' if self.is_active else 'Ngừng dùng',
        ]

    def save(self, *args, **kwargs):
        self._build_search_text()
        super().save(*args, **kwargs)


class PayrollRecord(SearchTextModelMixin):
    STATUS_UNLOCKED = 'UNLOCKED'
    STATUS_LOCKED = 'LOCKED'
    STATUS_CHOICES = [
        (STATUS_UNLOCKED, 'Chưa khóa'),
        (STATUS_LOCKED, 'Đã khóa'),
    ]

    employee = models.ForeignKey(
        Employee,
        on_delete=models.CASCADE,
        related_name='payroll_records',
        verbose_name='Nhân viên',
    )
    month = models.CharField(max_length=7, verbose_name='Tháng', help_text='Định dạng YYYY-MM')
    standard_days = models.DecimalField(max_digits=5, decimal_places=2, default=0)
    actual_days = models.DecimalField(max_digits=5, decimal_places=2, default=0)
    basic_salary = models.DecimalField(max_digits=15, decimal_places=2, default=0)
    salary_by_attendance = models.DecimalField(max_digits=15, decimal_places=2, default=0)
    overtime_pay = models.DecimalField(max_digits=15, decimal_places=2, default=0)
    total_bonus = models.DecimalField(max_digits=15, decimal_places=2, default=0)
    total_penalty = models.DecimalField(max_digits=15, decimal_places=2, default=0)
    advance_deduction = models.DecimalField(max_digits=15, decimal_places=2, default=0)
    total_income = models.DecimalField(max_digits=15, decimal_places=2, default=0)
    total_deductions = models.DecimalField(max_digits=15, decimal_places=2, default=0)
    net_pay = models.DecimalField(max_digits=15, decimal_places=2, default=0)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default=STATUS_UNLOCKED)
    note = models.TextField(blank=True, default='')
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='workforce_payroll_created',
    )
    updated_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='workforce_payroll_updated',
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'workforce_payroll_records'
        ordering = ['-month', 'employee__code']
        unique_together = [('employee', 'month')]
        indexes = [
            models.Index(fields=['month']),
            models.Index(fields=['employee', 'month']),
            models.Index(fields=['status']),
        ]

    def __str__(self):
        return f'{self.employee.code} - {self.month}'

    def _search_values(self):
        return [
            self.employee.code if self.employee_id else '',
            self.employee.name if self.employee_id else '',
            self.month,
            str(self.standard_days),
            str(self.actual_days),
            str(self.basic_salary),
            str(self.salary_by_attendance),
            str(self.overtime_pay),
            str(self.total_bonus),
            str(self.total_penalty),
            str(self.advance_deduction),
            str(self.total_income),
            str(self.total_deductions),
            str(self.net_pay),
            self.status,
            dict(self.STATUS_CHOICES).get(self.status, ''),
            self.note,
        ]

    def save(self, *args, **kwargs):
        self._build_search_text()
        super().save(*args, **kwargs)

