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


class TransactionCategory(SearchTextModelMixin):
    TYPE_INCOME = 'INCOME'
    TYPE_EXPENSE = 'EXPENSE'
    TYPE_CHOICES = [
        (TYPE_INCOME, 'Thu'),
        (TYPE_EXPENSE, 'Chi'),
    ]

    code = models.CharField(max_length=20, unique=True, verbose_name='Mã')
    name = models.CharField(max_length=150, verbose_name='Tên loại')
    category_type = models.CharField(max_length=20, choices=TYPE_CHOICES, verbose_name='Loại')
    color = models.CharField(max_length=20, default='#1677ff', verbose_name='Màu hiển thị')
    note = models.TextField(blank=True, default='', verbose_name='Ghi chú')
    is_system = models.BooleanField(default=False, verbose_name='Danh mục hệ thống')
    is_active = models.BooleanField(default=True, verbose_name='Đang dùng')
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='finance_categories_created',
    )
    updated_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='finance_categories_updated',
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'finance_transaction_categories'
        ordering = ['code']
        indexes = [
            models.Index(fields=['code']),
            models.Index(fields=['name']),
            models.Index(fields=['category_type']),
            models.Index(fields=['is_active']),
        ]

    def __str__(self):
        return f'{self.code} - {self.name}'

    def _search_values(self):
        return [
            self.code,
            self.name,
            self.category_type,
            dict(self.TYPE_CHOICES).get(self.category_type, ''),
            self.color,
            self.note,
            'Danh mục hệ thống' if self.is_system else 'Danh mục tự tạo',
            'Đang dùng' if self.is_active else 'Ngừng dùng',
        ]

    def save(self, *args, **kwargs):
        if self.code:
            self.code = str(self.code).strip().upper()
        self._build_search_text()
        super().save(*args, **kwargs)


class BankAccount(SearchTextModelMixin):
    code = models.CharField(max_length=30, unique=True, verbose_name='Mã')
    account_number = models.CharField(max_length=50, unique=True, verbose_name='Số tài khoản')
    account_name = models.CharField(max_length=255, verbose_name='Tên chủ tài khoản')
    bank_name = models.CharField(max_length=150, verbose_name='Ngân hàng')
    branch = models.CharField(max_length=150, blank=True, default='', verbose_name='Chi nhánh')
    note = models.TextField(blank=True, default='', verbose_name='Ghi chú')
    is_active = models.BooleanField(default=True, verbose_name='Đang dùng')
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='finance_bank_accounts_created',
    )
    updated_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='finance_bank_accounts_updated',
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'finance_bank_accounts'
        ordering = ['code']
        indexes = [
            models.Index(fields=['code']),
            models.Index(fields=['account_number']),
            models.Index(fields=['bank_name']),
            models.Index(fields=['is_active']),
        ]

    def __str__(self):
        return f'{self.code} - {self.account_number}'

    def _search_values(self):
        return [
            self.code,
            self.account_number,
            self.account_name,
            self.bank_name,
            self.branch,
            self.note,
            'Đang dùng' if self.is_active else 'Ngừng dùng',
        ]

    def save(self, *args, **kwargs):
        if self.code:
            self.code = str(self.code).strip().upper()
        self._build_search_text()
        super().save(*args, **kwargs)


class CashAccount(SearchTextModelMixin):
    TYPE_CASH = 'CASH'
    TYPE_FUND = 'FUND'
    TYPE_CHOICES = [
        (TYPE_CASH, 'Tiền mặt'),
        (TYPE_FUND, 'Quỹ'),
    ]

    name = models.CharField(max_length=150, verbose_name='Tên tài khoản')
    account_type = models.CharField(max_length=20, choices=TYPE_CHOICES, default=TYPE_CASH, verbose_name='Loại')
    balance = models.DecimalField(max_digits=15, decimal_places=2, default=0, verbose_name='Số dư')
    note = models.TextField(blank=True, default='', verbose_name='Ghi chú')
    is_active = models.BooleanField(default=True, verbose_name='Đang dùng')
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='finance_cash_accounts_created',
    )
    updated_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='finance_cash_accounts_updated',
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'finance_cash_accounts'
        ordering = ['name']
        indexes = [
            models.Index(fields=['name']),
            models.Index(fields=['account_type']),
            models.Index(fields=['is_active']),
        ]

    def __str__(self):
        return self.name

    def _search_values(self):
        return [
            self.name,
            self.account_type,
            dict(self.TYPE_CHOICES).get(self.account_type, ''),
            str(self.balance),
            self.note,
            'Đang dùng' if self.is_active else 'Ngừng dùng',
        ]

    def save(self, *args, **kwargs):
        self._build_search_text()
        super().save(*args, **kwargs)


class CashTransaction(SearchTextModelMixin):
    TYPE_INCOME = 'INCOME'
    TYPE_EXPENSE = 'EXPENSE'
    TYPE_TRANSFER = 'TRANSFER'
    TYPE_CHOICES = [
        (TYPE_INCOME, 'Thu'),
        (TYPE_EXPENSE, 'Chi'),
        (TYPE_TRANSFER, 'Chuyển'),
    ]

    SOURCE_CASH = 'CASH'
    SOURCE_BANK = 'BANK'
    SOURCE_CHOICES = [
        (SOURCE_CASH, 'Tiền mặt / Quỹ'),
        (SOURCE_BANK, 'Ngân hàng'),
    ]

    transaction_type = models.CharField(max_length=20, choices=TYPE_CHOICES, default=TYPE_EXPENSE, verbose_name='Loại giao dịch')
    source_type = models.CharField(max_length=20, choices=SOURCE_CHOICES, default=SOURCE_CASH, verbose_name='Nguồn tiền')
    source_cash_account = models.ForeignKey(
        CashAccount,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='outgoing_transactions',
        verbose_name='Tài khoản nguồn (quỹ)',
    )
    source_bank_account = models.ForeignKey(
        BankAccount,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='bank_transactions',
        verbose_name='Tài khoản nguồn (ngân hàng)',
    )
    target_cash_account = models.ForeignKey(
        CashAccount,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='incoming_transfer_transactions',
        verbose_name='Tài khoản đích (khi chuyển)',
    )
    category = models.ForeignKey(
        TransactionCategory,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='transactions',
        verbose_name='Danh mục thu chi',
    )
    transaction_date = models.DateField(verbose_name='Ngày giao dịch')
    amount = models.DecimalField(max_digits=15, decimal_places=2, verbose_name='Số tiền')
    object_name = models.CharField(max_length=255, blank=True, default='', verbose_name='Đối tượng')
    reason = models.CharField(max_length=255, blank=True, default='', verbose_name='Lý do')
    note = models.TextField(blank=True, default='', verbose_name='Ghi chú')
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='finance_cash_transactions_created',
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'finance_cash_transactions'
        ordering = ['-transaction_date', '-id']
        indexes = [
            models.Index(fields=['transaction_date']),
            models.Index(fields=['transaction_type']),
            models.Index(fields=['source_type']),
        ]

    def __str__(self):
        return f'{self.get_transaction_type_display()} {self.amount}'

    def _search_values(self):
        source_name = ''
        if self.source_type == self.SOURCE_CASH and self.source_cash_account_id:
            source_name = self.source_cash_account.name
        elif self.source_type == self.SOURCE_BANK and self.source_bank_account_id:
            source_name = self.source_bank_account.code
        target_name = self.target_cash_account.name if self.target_cash_account_id else ''
        category_code = self.category.code if self.category_id else ''
        category_name = self.category.name if self.category_id else ''
        return [
            self.transaction_type,
            dict(self.TYPE_CHOICES).get(self.transaction_type, ''),
            self.source_type,
            dict(self.SOURCE_CHOICES).get(self.source_type, ''),
            source_name,
            target_name,
            category_code,
            category_name,
            self.transaction_date.isoformat() if self.transaction_date else '',
            str(self.amount),
            self.object_name,
            self.reason,
            self.note,
        ]

    def clean(self):
        from django.core.exceptions import ValidationError
        if self.source_type == self.SOURCE_CASH and not self.source_cash_account_id:
            raise ValidationError('Nguồn quỹ bắt buộc khi source_type=CASH.')
        if self.source_type == self.SOURCE_BANK and not self.source_bank_account_id:
            raise ValidationError('Nguồn ngân hàng bắt buộc khi source_type=BANK.')
        if self.transaction_type == self.TYPE_TRANSFER and not self.target_cash_account_id:
            raise ValidationError('Tài khoản đích bắt buộc khi giao dịch chuyển.')
        if self.amount is None or self.amount <= 0:
            raise ValidationError('Số tiền phải lớn hơn 0.')

    def save(self, *args, **kwargs):
        self._build_search_text()
        super().save(*args, **kwargs)


class AdvanceTransaction(SearchTextModelMixin):
    TYPE_PURCHASE = 'PURCHASE'
    TYPE_SALARY = 'SALARY'
    TYPE_OTHER = 'OTHER'
    TYPE_CHOICES = [
        (TYPE_PURCHASE, 'Tạm ứng mua hàng'),
        (TYPE_SALARY, 'Tạm ứng lương'),
        (TYPE_OTHER, 'Tạm ứng khác'),
    ]

    STATUS_OPEN = 'OPEN'
    STATUS_PARTIAL = 'PARTIAL'
    STATUS_SETTLED = 'SETTLED'
    STATUS_CANCELLED = 'CANCELLED'
    STATUS_CHOICES = [
        (STATUS_OPEN, 'Chưa quyết toán'),
        (STATUS_PARTIAL, 'Đang quyết toán'),
        (STATUS_SETTLED, 'Đã quyết toán'),
        (STATUS_CANCELLED, 'Đã hủy'),
    ]

    SOURCE_CASH = 'CASH'
    SOURCE_BANK = 'BANK'
    SOURCE_CHOICES = [
        (SOURCE_CASH, 'Tiền mặt / Quỹ'),
        (SOURCE_BANK, 'Ngân hàng'),
    ]

    code = models.CharField(max_length=30, unique=True, verbose_name='Mã tạm ứng')
    advance_type = models.CharField(max_length=20, choices=TYPE_CHOICES, default=TYPE_PURCHASE, verbose_name='Loại tạm ứng')
    advance_date = models.DateField(verbose_name='Ngày tạm ứng')
    recipient_name = models.CharField(max_length=255, verbose_name='Người nhận tạm ứng')
    source_type = models.CharField(max_length=20, choices=SOURCE_CHOICES, default=SOURCE_CASH, verbose_name='Nguồn tiền')
    source_cash_account = models.ForeignKey(
        CashAccount,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='advance_transactions_from_cash',
        verbose_name='Tài khoản nguồn (quỹ)',
    )
    source_bank_account = models.ForeignKey(
        BankAccount,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='advance_transactions_from_bank',
        verbose_name='Tài khoản nguồn (ngân hàng)',
    )
    amount = models.DecimalField(max_digits=15, decimal_places=2, verbose_name='Số tiền tạm ứng')
    purpose = models.CharField(max_length=255, blank=True, default='', verbose_name='Mục đích')
    note = models.TextField(blank=True, default='', verbose_name='Ghi chú')
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default=STATUS_OPEN, verbose_name='Trạng thái')
    is_active = models.BooleanField(default=True, verbose_name='Đang dùng')
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='finance_advance_transactions_created',
    )
    updated_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='finance_advance_transactions_updated',
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'finance_advance_transactions'
        ordering = ['-advance_date', '-id']
        indexes = [
            models.Index(fields=['code']),
            models.Index(fields=['advance_date']),
            models.Index(fields=['advance_type']),
            models.Index(fields=['status']),
            models.Index(fields=['is_active']),
        ]

    def __str__(self):
        return f'{self.code} - {self.recipient_name}'

    @property
    def total_spent(self):
        return self.settlements.aggregate(total=models.Sum('spent_amount')).get('total') or 0

    @property
    def total_refund(self):
        return self.settlements.aggregate(total=models.Sum('refund_amount')).get('total') or 0

    @property
    def remaining_amount(self):
        return (self.amount or 0) - (self.total_spent or 0) - (self.total_refund or 0)

    def _search_values(self):
        source_name = ''
        if self.source_type == self.SOURCE_CASH and self.source_cash_account_id:
            source_name = self.source_cash_account.name
        elif self.source_type == self.SOURCE_BANK and self.source_bank_account_id:
            source_name = self.source_bank_account.code
        return [
            self.code,
            self.advance_type,
            dict(self.TYPE_CHOICES).get(self.advance_type, ''),
            self.status,
            dict(self.STATUS_CHOICES).get(self.status, ''),
            self.advance_date.isoformat() if self.advance_date else '',
            self.recipient_name,
            self.source_type,
            dict(self.SOURCE_CHOICES).get(self.source_type, ''),
            source_name,
            str(self.amount),
            self.purpose,
            self.note,
            'Đang dùng' if self.is_active else 'Ngừng dùng',
        ]

    def clean(self):
        from django.core.exceptions import ValidationError

        if self.source_type == self.SOURCE_CASH and not self.source_cash_account_id:
            raise ValidationError('Nguồn quỹ bắt buộc khi source_type=CASH.')
        if self.source_type == self.SOURCE_BANK and not self.source_bank_account_id:
            raise ValidationError('Nguồn ngân hàng bắt buộc khi source_type=BANK.')
        if self.amount is None or self.amount <= 0:
            raise ValidationError('Số tiền tạm ứng phải lớn hơn 0.')

    def save(self, *args, **kwargs):
        if self.code:
            self.code = str(self.code).strip().upper()
        self._build_search_text()
        super().save(*args, **kwargs)


class AdvanceSettlement(SearchTextModelMixin):
    advance_transaction = models.ForeignKey(
        AdvanceTransaction,
        on_delete=models.CASCADE,
        related_name='settlements',
        verbose_name='Phiếu tạm ứng',
    )
    settlement_date = models.DateField(verbose_name='Ngày quyết toán')
    spent_amount = models.DecimalField(max_digits=15, decimal_places=2, default=0, verbose_name='Chi thực tế')
    refund_amount = models.DecimalField(max_digits=15, decimal_places=2, default=0, verbose_name='Hoàn ứng')
    note = models.TextField(blank=True, default='', verbose_name='Ghi chú')
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='finance_advance_settlements_created',
    )
    updated_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='finance_advance_settlements_updated',
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'finance_advance_settlements'
        ordering = ['-settlement_date', '-id']
        indexes = [
            models.Index(fields=['settlement_date']),
            models.Index(fields=['advance_transaction']),
        ]

    def __str__(self):
        return f'QT-{self.advance_transaction.code}-{self.id}'

    def _search_values(self):
        return [
            self.advance_transaction.code if self.advance_transaction_id else '',
            self.advance_transaction.recipient_name if self.advance_transaction_id else '',
            self.settlement_date.isoformat() if self.settlement_date else '',
            str(self.spent_amount),
            str(self.refund_amount),
            self.note,
        ]

    def clean(self):
        from django.core.exceptions import ValidationError

        if (self.spent_amount or 0) < 0:
            raise ValidationError('Chi thực tế không được âm.')
        if (self.refund_amount or 0) < 0:
            raise ValidationError('Hoàn ứng không được âm.')
        if (self.spent_amount or 0) + (self.refund_amount or 0) <= 0:
            raise ValidationError('Chi thực tế + Hoàn ứng phải lớn hơn 0.')

    def save(self, *args, **kwargs):
        self._build_search_text()
        super().save(*args, **kwargs)

