from decimal import Decimal

from django.conf import settings
from django.db import models
from django.db.models import Sum
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

    def _merge_update_fields(self, update_fields):
        if update_fields is None:
            return None
        fields = set(update_fields)
        fields.add('search_text')
        return list(fields)


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
        kwargs['update_fields'] = self._merge_update_fields(kwargs.get('update_fields'))
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
        kwargs['update_fields'] = self._merge_update_fields(kwargs.get('update_fields'))
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
        kwargs['update_fields'] = self._merge_update_fields(kwargs.get('update_fields'))
        super().save(*args, **kwargs)

    def current_balance_as_of(self, up_to_date=None, exclude_transaction_id: int | None = None):
        qs = CashTransaction.objects.all()
        if up_to_date:
            qs = qs.filter(transaction_date__lte=up_to_date)
        if exclude_transaction_id:
            qs = qs.exclude(pk=exclude_transaction_id)
        income_total = Decimal(str(
            qs.filter(
                transaction_type=CashTransaction.TYPE_INCOME,
                source_type=CashTransaction.SOURCE_CASH,
                source_cash_account=self,
            ).aggregate(total=Sum('amount')).get('total') or 0
        ))
        expense_total = Decimal(str(
            qs.filter(
                transaction_type=CashTransaction.TYPE_EXPENSE,
                source_type=CashTransaction.SOURCE_CASH,
                source_cash_account=self,
            ).aggregate(total=Sum('amount')).get('total') or 0
        ))
        transfer_out_total = Decimal(str(
            qs.filter(
                transaction_type=CashTransaction.TYPE_TRANSFER,
                source_cash_account=self,
            ).aggregate(total=Sum('amount')).get('total') or 0
        ))
        transfer_in_total = Decimal(str(
            qs.filter(
                transaction_type=CashTransaction.TYPE_TRANSFER,
                target_cash_account=self,
            ).aggregate(total=Sum('amount')).get('total') or 0
        ))
        return Decimal(str(self.balance or 0)) + income_total + transfer_in_total - expense_total - transfer_out_total


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
        kwargs['update_fields'] = self._merge_update_fields(kwargs.get('update_fields'))
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
    APPROVAL_DRAFT = 'DRAFT'
    APPROVAL_PENDING_L1 = 'PENDING_L1'
    APPROVAL_PENDING_L2 = 'PENDING_L2'
    APPROVAL_APPROVED = 'APPROVED'
    APPROVAL_REJECTED = 'REJECTED'
    APPROVAL_STATUS_CHOICES = [
        (APPROVAL_DRAFT, 'Nháp'),
        (APPROVAL_PENDING_L1, 'Chờ duyệt cấp 1'),
        (APPROVAL_PENDING_L2, 'Chờ duyệt cấp 2'),
        (APPROVAL_APPROVED, 'Đã duyệt'),
        (APPROVAL_REJECTED, 'Từ chối'),
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
    approval_status = models.CharField(
        max_length=20,
        choices=APPROVAL_STATUS_CHOICES,
        default=APPROVAL_DRAFT,
        verbose_name='Trạng thái duyệt',
    )
    required_approval_level = models.PositiveSmallIntegerField(default=1, verbose_name='Số cấp duyệt yêu cầu')
    submitted_at = models.DateTimeField(null=True, blank=True, verbose_name='Thời điểm gửi duyệt')
    submitted_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='finance_advance_transactions_submitted',
    )
    approved_level1_at = models.DateTimeField(null=True, blank=True, verbose_name='Thời điểm duyệt cấp 1')
    approved_level1_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='finance_advance_transactions_approved_l1',
    )
    approved_level2_at = models.DateTimeField(null=True, blank=True, verbose_name='Thời điểm duyệt cấp 2')
    approved_level2_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='finance_advance_transactions_approved_l2',
    )
    rejected_at = models.DateTimeField(null=True, blank=True, verbose_name='Thời điểm từ chối')
    rejected_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='finance_advance_transactions_rejected',
    )
    rejection_reason = models.CharField(max_length=255, blank=True, default='', verbose_name='Lý do từ chối')
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
            models.Index(fields=['approval_status']),
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
            self.approval_status,
            dict(self.APPROVAL_STATUS_CHOICES).get(self.approval_status, ''),
            str(self.required_approval_level),
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
        kwargs['update_fields'] = self._merge_update_fields(kwargs.get('update_fields'))
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
        kwargs['update_fields'] = self._merge_update_fields(kwargs.get('update_fields'))
        super().save(*args, **kwargs)


class ReceivableStatus:
    OPEN = 'OPEN'
    PARTIAL = 'PARTIAL'
    SETTLED = 'SETTLED'
    CANCELLED = 'CANCELLED'
    CHOICES = [
        (OPEN, 'Chưa thu'),
        (PARTIAL, 'Thu một phần'),
        (SETTLED, 'Đã thu đủ'),
        (CANCELLED, 'Đã hủy'),
    ]


class PayableStatus:
    OPEN = 'OPEN'
    PARTIAL = 'PARTIAL'
    SETTLED = 'SETTLED'
    CANCELLED = 'CANCELLED'
    CHOICES = [
        (OPEN, 'Chưa chi'),
        (PARTIAL, 'Chi một phần'),
        (SETTLED, 'Đã chi đủ'),
        (CANCELLED, 'Đã hủy'),
    ]


class ReceivableDocument(SearchTextModelMixin):
    code = models.CharField(max_length=30, unique=True, verbose_name='Mã phải thu')
    source_sales_order = models.OneToOneField(
        'sales.SalesOrder',
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name='receivable_document',
        verbose_name='Đơn bán nguồn',
    )
    customer = models.ForeignKey(
        'core.Customer',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='receivable_documents',
        verbose_name='Khách hàng',
    )
    customer_snapshot = models.JSONField(default=dict, blank=True, verbose_name='Snapshot khách hàng')
    document_date = models.DateField(verbose_name='Ngày ghi nhận')
    due_date = models.DateField(verbose_name='Ngày đến hạn')
    currency = models.CharField(max_length=3, default='VND', verbose_name='Tiền tệ')
    exchange_rate = models.DecimalField(max_digits=18, decimal_places=6, default=Decimal('1'), verbose_name='Tỷ giá')
    subtotal_amount = models.DecimalField(max_digits=18, decimal_places=2, default=0, verbose_name='Tiền hàng')
    tax_amount = models.DecimalField(max_digits=18, decimal_places=2, default=0, verbose_name='Thuế')
    total_amount = models.DecimalField(max_digits=18, decimal_places=2, default=0, verbose_name='Tổng phải thu')
    settled_amount = models.DecimalField(max_digits=18, decimal_places=2, default=0, verbose_name='Đã thu')
    status = models.CharField(max_length=20, choices=ReceivableStatus.CHOICES, default=ReceivableStatus.OPEN, verbose_name='Trạng thái')
    reference = models.CharField(max_length=200, blank=True, default='', verbose_name='Tham chiếu')
    note = models.TextField(blank=True, default='', verbose_name='Ghi chú')
    version = models.IntegerField(default=0)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='finance_receivables_created',
    )
    updated_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='finance_receivables_updated',
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'finance_receivable_documents'
        ordering = ['due_date', '-id']
        indexes = [
            models.Index(fields=['code']),
            models.Index(fields=['document_date']),
            models.Index(fields=['due_date']),
            models.Index(fields=['status']),
            models.Index(fields=['customer']),
        ]

    def __str__(self):
        return self.code

    @property
    def remaining_amount(self):
        remaining = Decimal(str(self.total_amount or 0)) - Decimal(str(self.settled_amount or 0))
        return remaining if remaining > 0 else Decimal('0')

    def _search_values(self):
        snapshot = self.customer_snapshot or {}
        return [
            self.code,
            getattr(getattr(self, 'source_sales_order', None), 'code', None) or '',
            snapshot.get('code'),
            snapshot.get('name'),
            snapshot.get('company_name'),
            self.document_date.isoformat() if self.document_date else '',
            self.due_date.isoformat() if self.due_date else '',
            str(self.total_amount or 0),
            str(self.settled_amount or 0),
            str(self.remaining_amount),
            dict(ReceivableStatus.CHOICES).get(self.status, self.status),
            self.reference,
            self.note,
        ]

    def save(self, *args, **kwargs):
        if self.code:
            self.code = str(self.code).strip().upper()
        self._build_search_text()
        kwargs['update_fields'] = self._merge_update_fields(kwargs.get('update_fields'))
        super().save(*args, **kwargs)


class ReceivableSettlement(SearchTextModelMixin):
    SOURCE_CASH = 'CASH'
    SOURCE_BANK = 'BANK'
    SOURCE_CHOICES = [
        (SOURCE_CASH, 'Tiền mặt / Quỹ'),
        (SOURCE_BANK, 'Ngân hàng'),
    ]

    receivable_document = models.ForeignKey(
        ReceivableDocument,
        on_delete=models.CASCADE,
        related_name='settlements',
        verbose_name='Chứng từ phải thu',
    )
    settlement_date = models.DateField(verbose_name='Ngày thu tiền')
    amount = models.DecimalField(max_digits=18, decimal_places=2, verbose_name='Số tiền thu')
    source_type = models.CharField(max_length=20, choices=SOURCE_CHOICES, default=SOURCE_CASH, verbose_name='Nguồn tiền')
    source_cash_account = models.ForeignKey(
        CashAccount,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='receivable_settlements_from_cash',
        verbose_name='Quỹ thu',
    )
    source_bank_account = models.ForeignKey(
        BankAccount,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='receivable_settlements_from_bank',
        verbose_name='Ngân hàng thu',
    )
    cash_transaction = models.OneToOneField(
        CashTransaction,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='receivable_settlement',
        verbose_name='Giao dịch quỹ/ngân hàng',
    )
    note = models.TextField(blank=True, default='', verbose_name='Ghi chú')
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='finance_receivable_settlements_created',
    )
    updated_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='finance_receivable_settlements_updated',
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'finance_receivable_settlements'
        ordering = ['-settlement_date', '-id']
        indexes = [
            models.Index(fields=['settlement_date']),
            models.Index(fields=['receivable_document']),
        ]

    def __str__(self):
        return f'THU-{self.receivable_document.code}-{self.id}'

    def _search_values(self):
        snapshot = self.receivable_document.customer_snapshot if self.receivable_document_id else {}
        return [
            self.receivable_document.code if self.receivable_document_id else '',
            snapshot.get('name'),
            snapshot.get('company_name'),
            self.settlement_date.isoformat() if self.settlement_date else '',
            str(self.amount or 0),
            self.source_type,
            dict(self.SOURCE_CHOICES).get(self.source_type, ''),
            self.note,
        ]

    def save(self, *args, **kwargs):
        self._build_search_text()
        kwargs['update_fields'] = self._merge_update_fields(kwargs.get('update_fields'))
        super().save(*args, **kwargs)


class PayableDocument(SearchTextModelMixin):
    code = models.CharField(max_length=30, unique=True, verbose_name='Mã phải trả')
    source_purchase_receipt = models.OneToOneField(
        'purchasing.PurchaseReceipt',
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name='payable_document',
        verbose_name='Phiếu nhập nguồn',
    )
    supplier = models.ForeignKey(
        'purchasing.Supplier',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='payable_documents',
        verbose_name='Nhà cung cấp',
    )
    supplier_snapshot = models.JSONField(default=dict, blank=True, verbose_name='Snapshot nhà cung cấp')
    document_date = models.DateField(verbose_name='Ngày ghi nhận')
    due_date = models.DateField(verbose_name='Ngày đến hạn')
    vendor_invoice_no = models.CharField(max_length=100, blank=True, default='', verbose_name='Số hóa đơn NCC')
    vendor_invoice_date = models.DateField(null=True, blank=True, verbose_name='Ngày hóa đơn NCC')
    currency = models.CharField(max_length=3, default='VND', verbose_name='Tiền tệ')
    exchange_rate = models.DecimalField(max_digits=18, decimal_places=6, default=Decimal('1'), verbose_name='Tỷ giá')
    subtotal_amount = models.DecimalField(max_digits=18, decimal_places=2, default=0, verbose_name='Tiền hàng')
    tax_amount = models.DecimalField(max_digits=18, decimal_places=2, default=0, verbose_name='Thuế')
    total_amount = models.DecimalField(max_digits=18, decimal_places=2, default=0, verbose_name='Tổng phải trả')
    settled_amount = models.DecimalField(max_digits=18, decimal_places=2, default=0, verbose_name='Đã chi')
    status = models.CharField(max_length=20, choices=PayableStatus.CHOICES, default=PayableStatus.OPEN, verbose_name='Trạng thái')
    reference = models.CharField(max_length=200, blank=True, default='', verbose_name='Tham chiếu')
    note = models.TextField(blank=True, default='', verbose_name='Ghi chú')
    version = models.IntegerField(default=0)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='finance_payables_created',
    )
    updated_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='finance_payables_updated',
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'finance_payable_documents'
        ordering = ['due_date', '-id']
        indexes = [
            models.Index(fields=['code']),
            models.Index(fields=['document_date']),
            models.Index(fields=['due_date']),
            models.Index(fields=['status']),
            models.Index(fields=['supplier']),
        ]

    def __str__(self):
        return self.code

    @property
    def remaining_amount(self):
        remaining = Decimal(str(self.total_amount or 0)) - Decimal(str(self.settled_amount or 0))
        return remaining if remaining > 0 else Decimal('0')

    def _search_values(self):
        snapshot = self.supplier_snapshot or {}
        receipt_code = getattr(getattr(self, 'source_purchase_receipt', None), 'code', '') or ''
        purchase_order_code = getattr(getattr(getattr(self, 'source_purchase_receipt', None), 'purchase_order', None), 'code', '') or ''
        return [
            self.code,
            receipt_code,
            purchase_order_code,
            snapshot.get('code'),
            snapshot.get('name'),
            snapshot.get('company_name'),
            self.document_date.isoformat() if self.document_date else '',
            self.due_date.isoformat() if self.due_date else '',
            self.vendor_invoice_no,
            self.vendor_invoice_date.isoformat() if self.vendor_invoice_date else '',
            str(self.total_amount or 0),
            str(self.settled_amount or 0),
            str(self.remaining_amount),
            dict(PayableStatus.CHOICES).get(self.status, self.status),
            self.reference,
            self.note,
        ]

    def save(self, *args, **kwargs):
        if self.code:
            self.code = str(self.code).strip().upper()
        self._build_search_text()
        super().save(*args, **kwargs)


class PayableSettlement(SearchTextModelMixin):
    SOURCE_CASH = 'CASH'
    SOURCE_BANK = 'BANK'
    SOURCE_CHOICES = [
        (SOURCE_CASH, 'Tiền mặt / Quỹ'),
        (SOURCE_BANK, 'Ngân hàng'),
    ]

    payable_document = models.ForeignKey(
        PayableDocument,
        on_delete=models.CASCADE,
        related_name='settlements',
        verbose_name='Chứng từ phải trả',
    )
    settlement_date = models.DateField(verbose_name='Ngày thanh toán')
    amount = models.DecimalField(max_digits=18, decimal_places=2, verbose_name='Số tiền chi')
    source_type = models.CharField(max_length=20, choices=SOURCE_CHOICES, default=SOURCE_CASH, verbose_name='Nguồn tiền')
    source_cash_account = models.ForeignKey(
        CashAccount,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='payable_settlements_from_cash',
        verbose_name='Quỹ chi',
    )
    source_bank_account = models.ForeignKey(
        BankAccount,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='payable_settlements_from_bank',
        verbose_name='Ngân hàng chi',
    )
    cash_transaction = models.OneToOneField(
        CashTransaction,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='payable_settlement',
        verbose_name='Giao dịch quỹ/ngân hàng',
    )
    note = models.TextField(blank=True, default='', verbose_name='Ghi chú')
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='finance_payable_settlements_created',
    )
    updated_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='finance_payable_settlements_updated',
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'finance_payable_settlements'
        ordering = ['-settlement_date', '-id']
        indexes = [
            models.Index(fields=['settlement_date']),
            models.Index(fields=['payable_document']),
        ]

    def __str__(self):
        return f'CHI-{self.payable_document.code}-{self.id}'

    def _search_values(self):
        snapshot = self.payable_document.supplier_snapshot if self.payable_document_id else {}
        return [
            self.payable_document.code if self.payable_document_id else '',
            snapshot.get('name'),
            snapshot.get('company_name'),
            self.settlement_date.isoformat() if self.settlement_date else '',
            str(self.amount or 0),
            self.source_type,
            dict(self.SOURCE_CHOICES).get(self.source_type, ''),
            self.note,
        ]

    def save(self, *args, **kwargs):
        self._build_search_text()
        super().save(*args, **kwargs)

