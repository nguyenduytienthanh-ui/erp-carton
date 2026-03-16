from decimal import Decimal

from django.utils import timezone
from rest_framework import serializers

from .models import (
    AdvanceSettlement,
    AdvanceTransaction,
    BankAccount,
    BankReconciliation,
    CashAccount,
    CashTransaction,
    PayableDocument,
    PayableSettlement,
    ReceivableDocument,
    ReceivableSettlement,
    TransactionCategory,
    GeneralLedgerAccount,
    GeneralLedgerEntry,
)


class TransactionCategorySerializer(serializers.ModelSerializer):
    class Meta:
        model = TransactionCategory
        fields = '__all__'
        read_only_fields = ['created_by', 'updated_by', 'created_at', 'updated_at', 'search_text']


class BankAccountSerializer(serializers.ModelSerializer):
    class Meta:
        model = BankAccount
        fields = '__all__'
        read_only_fields = ['created_by', 'updated_by', 'created_at', 'updated_at', 'search_text']


class BankReconciliationSerializer(serializers.ModelSerializer):
    bank_account_code = serializers.CharField(source='bank_account.code', read_only=True)
    bank_account_name = serializers.SerializerMethodField()

    def get_bank_account_name(self, obj):
        if not getattr(obj, 'bank_account', None):
            return None
        parts = [
            getattr(obj.bank_account, 'bank_name', '') or '',
            getattr(obj.bank_account, 'account_number', '') or '',
        ]
        return ' - '.join([part for part in parts if part]).strip() or obj.bank_account.code

    class Meta:
        model = BankReconciliation
        fields = [
            'id',
            'code',
            'statement_date',
            'statement_balance',
            'bank_account',
            'bank_account_code',
            'bank_account_name',
            'book_balance',
            'delta',
            'status',
            'reference',
            'note',
            'approved_by',
            'approved_at',
            'posted_by',
            'posted_at',
            'created_by',
            'updated_by',
            'created_at',
            'updated_at',
        ]
        read_only_fields = [
            'code',
            'delta',
            'status',
            'approved_by',
            'approved_at',
            'posted_by',
            'posted_at',
            'created_by',
            'updated_by',
            'created_at',
            'updated_at',
        ]

    def validate(self, attrs):
        bank_account = attrs.get('bank_account') or getattr(self.instance, 'bank_account', None)
        if bank_account and not getattr(bank_account, 'is_active', False):
            raise serializers.ValidationError({'bank_account': 'Tài khoản ngân hàng đã ngừng sử dụng.'})
        return attrs


class CashAccountSerializer(serializers.ModelSerializer):
    current_balance = serializers.SerializerMethodField()

    def get_current_balance(self, obj):
        return obj.current_balance_as_of()

    class Meta:
        model = CashAccount
        fields = '__all__'
        read_only_fields = ['created_by', 'updated_by', 'created_at', 'updated_at', 'search_text']


class CashTransactionSerializer(serializers.ModelSerializer):
    source_cash_account_name = serializers.CharField(source='source_cash_account.name', read_only=True)
    source_bank_account_code = serializers.CharField(source='source_bank_account.code', read_only=True)
    target_cash_account_name = serializers.CharField(source='target_cash_account.name', read_only=True)
    category_code = serializers.CharField(source='category.code', read_only=True)
    category_name = serializers.CharField(source='category.name', read_only=True)

    class Meta:
        model = CashTransaction
        fields = [
            'id',
            'transaction_type',
            'source_type',
            'source_cash_account',
            'source_bank_account',
            'target_cash_account',
            'source_cash_account_name',
            'source_bank_account_code',
            'target_cash_account_name',
            'category',
            'category_code',
            'category_name',
            'transaction_date',
            'amount',
            'object_name',
            'reason',
            'note',
            'created_by',
            'created_at',
            'updated_at',
        ]
        read_only_fields = ['created_by', 'created_at', 'updated_at']

    def validate_amount(self, value):
        if value is None or Decimal(str(value)) <= 0:
            raise serializers.ValidationError('Số tiền giao dịch phải lớn hơn 0.')
        return value

    def validate(self, attrs):
        tx_type = attrs.get('transaction_type') or (self.instance.transaction_type if self.instance else None)
        category = attrs.get('category') or (self.instance.category if self.instance else None)
        if tx_type in (CashTransaction.TYPE_INCOME, CashTransaction.TYPE_EXPENSE) and not category:
            raise serializers.ValidationError({'category': 'Danh mục thu/chi là bắt buộc cho giao dịch thu hoặc chi.'})
        if category:
            if not getattr(category, 'is_active', False):
                raise serializers.ValidationError({'category': 'Danh mục đã ngừng sử dụng.'})
            if tx_type in (CashTransaction.TYPE_INCOME, CashTransaction.TYPE_EXPENSE) and category.category_type != tx_type:
                raise serializers.ValidationError({'category': 'Danh mục phải cùng loại với giao dịch thu/chi.'})

        source_type = attrs.get('source_type') or (self.instance.source_type if self.instance else None)
        source_cash = attrs.get('source_cash_account') or (self.instance.source_cash_account if self.instance else None)
        source_bank = attrs.get('source_bank_account') or (self.instance.source_bank_account if self.instance else None)
        tx_date = attrs.get('transaction_date') or (self.instance.transaction_date if self.instance else None)
        if source_type == CashTransaction.SOURCE_CASH and not source_cash:
            raise serializers.ValidationError({'source_cash_account': 'Tài khoản quỹ là bắt buộc khi nguồn tiền là quỹ tiền mặt.'})
        if source_type == CashTransaction.SOURCE_BANK and not source_bank:
            raise serializers.ValidationError({'source_bank_account': 'Tài khoản ngân hàng là bắt buộc khi nguồn tiền là ngân hàng.'})
        if source_cash and not getattr(source_cash, 'is_active', False):
            raise serializers.ValidationError({'source_cash_account': 'Tài khoản quỹ nguồn đã ngừng sử dụng.'})
        if source_bank and not getattr(source_bank, 'is_active', False):
            raise serializers.ValidationError({'source_bank_account': 'Tài khoản ngân hàng nguồn đã ngừng sử dụng.'})
        target_cash = attrs.get('target_cash_account') or (self.instance.target_cash_account if self.instance else None)
        if tx_type == CashTransaction.TYPE_TRANSFER and not target_cash:
            raise serializers.ValidationError({'target_cash_account': 'Tài khoản đích là bắt buộc cho giao dịch chuyển quỹ.'})
        if target_cash and not getattr(target_cash, 'is_active', False):
            raise serializers.ValidationError({'target_cash_account': 'Tài khoản quỹ đích đã ngừng sử dụng.'})
        if source_type == CashTransaction.SOURCE_CASH:
            attrs['source_bank_account'] = None
        if source_type == CashTransaction.SOURCE_BANK:
            attrs['source_cash_account'] = None
        if tx_type != CashTransaction.TYPE_TRANSFER:
            attrs['target_cash_account'] = None
        if tx_type == CashTransaction.TYPE_TRANSFER and source_cash and target_cash and source_cash.id == target_cash.id:
            raise serializers.ValidationError({'target_cash_account': 'Tài khoản đích phải khác tài khoản nguồn khi chuyển quỹ.'})
        if tx_type in (CashTransaction.TYPE_EXPENSE, CashTransaction.TYPE_TRANSFER) and source_type == CashTransaction.SOURCE_CASH and source_cash:
            projected_balance = source_cash.current_balance_as_of(
                up_to_date=tx_date,
                exclude_transaction_id=int(self.instance.id) if self.instance else None,
            )
            amount_value = Decimal(str(attrs.get('amount') or (self.instance.amount if self.instance else 0) or 0))
            if amount_value > projected_balance:
                raise serializers.ValidationError({
                    'amount': (
                        f'Quỹ nguồn không đủ số dư khả dụng. '
                        f'Khả dụng đến ngày giao dịch: {projected_balance:,.0f}.'
                    )
                })
        return attrs


class AdvanceTransactionSerializer(serializers.ModelSerializer):
    source_cash_account_name = serializers.CharField(source='source_cash_account.name', read_only=True)
    source_bank_account_code = serializers.CharField(source='source_bank_account.code', read_only=True)
    total_spent = serializers.DecimalField(max_digits=15, decimal_places=2, read_only=True)
    total_refund = serializers.DecimalField(max_digits=15, decimal_places=2, read_only=True)
    remaining_amount = serializers.DecimalField(max_digits=15, decimal_places=2, read_only=True)
    disbursement_status = serializers.SerializerMethodField()
    disbursement_transaction_id = serializers.SerializerMethodField()
    disbursed_at = serializers.SerializerMethodField()

    @staticmethod
    def _disbursement_marker(obj) -> str:
        return f'[ADVANCE:{obj.id}]'

    def _get_disbursement_tx(self, obj):
        return CashTransaction.objects.filter(reason__icontains=self._disbursement_marker(obj)).order_by('-id').first()

    def get_disbursement_status(self, obj):
        return 'DISBURSED' if self._get_disbursement_tx(obj) else 'NOT_DISBURSED'

    def get_disbursement_transaction_id(self, obj):
        tx = self._get_disbursement_tx(obj)
        return int(tx.id) if tx else None

    def get_disbursed_at(self, obj):
        tx = self._get_disbursement_tx(obj)
        return tx.created_at.isoformat() if tx and tx.created_at else None

    def validate_amount(self, value):
        if value is None or Decimal(str(value)) <= 0:
            raise serializers.ValidationError('Số tiền tạm ứng phải lớn hơn 0.')
        return value

    def validate(self, attrs):
        source_type = attrs.get('source_type') or (self.instance.source_type if self.instance else AdvanceTransaction.SOURCE_CASH)
        source_cash = attrs.get('source_cash_account') or (self.instance.source_cash_account if self.instance else None)
        source_bank = attrs.get('source_bank_account') or (self.instance.source_bank_account if self.instance else None)
        if source_type == AdvanceTransaction.SOURCE_CASH and not source_cash:
            raise serializers.ValidationError({'source_cash_account': 'Tài khoản quỹ là bắt buộc khi nguồn tiền là quỹ tiền mặt.'})
        if source_type == AdvanceTransaction.SOURCE_BANK and not source_bank:
            raise serializers.ValidationError({'source_bank_account': 'Tài khoản ngân hàng là bắt buộc khi nguồn tiền là ngân hàng.'})
        if source_cash and not getattr(source_cash, 'is_active', False):
            raise serializers.ValidationError({'source_cash_account': 'Tài khoản quỹ nguồn đã ngừng sử dụng.'})
        if source_bank and not getattr(source_bank, 'is_active', False):
            raise serializers.ValidationError({'source_bank_account': 'Tài khoản ngân hàng nguồn đã ngừng sử dụng.'})
        return attrs

    class Meta:
        model = AdvanceTransaction
        fields = [
            'id',
            'code',
            'advance_type',
            'advance_date',
            'recipient_name',
            'source_type',
            'source_cash_account',
            'source_bank_account',
            'source_cash_account_name',
            'source_bank_account_code',
            'amount',
            'purpose',
            'note',
            'status',
            'approval_status',
            'required_approval_level',
            'submitted_at',
            'submitted_by',
            'approved_level1_at',
            'approved_level1_by',
            'approved_level2_at',
            'approved_level2_by',
            'rejected_at',
            'rejected_by',
            'rejection_reason',
            'is_active',
            'total_spent',
            'total_refund',
            'remaining_amount',
            'disbursement_status',
            'disbursement_transaction_id',
            'disbursed_at',
            'created_by',
            'updated_by',
            'created_at',
            'updated_at',
        ]
        read_only_fields = [
            'created_by',
            'updated_by',
            'created_at',
            'updated_at',
            'total_spent',
            'total_refund',
            'remaining_amount',
            'status',
            'approval_status',
            'required_approval_level',
            'submitted_at',
            'submitted_by',
            'approved_level1_at',
            'approved_level1_by',
            'approved_level2_at',
            'approved_level2_by',
            'rejected_at',
            'rejected_by',
            'rejection_reason',
        ]


class AdvanceSettlementSerializer(serializers.ModelSerializer):
    advance_code = serializers.CharField(source='advance_transaction.code', read_only=True)
    advance_recipient_name = serializers.CharField(source='advance_transaction.recipient_name', read_only=True)

    @staticmethod
    def _disbursement_marker(advance: AdvanceTransaction) -> str:
        return f'[ADVANCE:{advance.id}]'

    class Meta:
        model = AdvanceSettlement
        fields = [
            'id',
            'advance_transaction',
            'advance_code',
            'advance_recipient_name',
            'settlement_date',
            'spent_amount',
            'refund_amount',
            'note',
            'created_by',
            'updated_by',
            'created_at',
            'updated_at',
        ]
        read_only_fields = ['created_by', 'updated_by', 'created_at', 'updated_at']

    def validate(self, attrs):
        spent = Decimal(str(attrs.get('spent_amount') or (self.instance.spent_amount if self.instance else 0) or 0))
        refund = Decimal(str(attrs.get('refund_amount') or (self.instance.refund_amount if self.instance else 0) or 0))
        if spent < 0:
            raise serializers.ValidationError({'spent_amount': 'Số tiền chi không được âm.'})
        if refund < 0:
            raise serializers.ValidationError({'refund_amount': 'Số tiền hoàn ứng không được âm.'})
        if spent + refund <= 0:
            raise serializers.ValidationError('Tổng chi quyết toán và hoàn ứng phải lớn hơn 0.')

        advance = attrs.get('advance_transaction') or (self.instance.advance_transaction if self.instance else None)
        settlement_date = attrs.get('settlement_date') or (self.instance.settlement_date if self.instance else None)
        if advance:
            if advance.approval_status != AdvanceTransaction.APPROVAL_APPROVED:
                raise serializers.ValidationError({'advance_transaction': 'Chỉ được quyết toán phiếu đã duyệt đầy đủ.'})
            disbursement_tx = CashTransaction.objects.filter(
                reason__icontains=self._disbursement_marker(advance)
            ).order_by('-id').first()
            if disbursement_tx is None:
                raise serializers.ValidationError({'advance_transaction': 'Chỉ được quyết toán sau khi đã có chứng từ chi tiền tạm ứng.'})
            if settlement_date and advance.advance_date and settlement_date < advance.advance_date:
                raise serializers.ValidationError({'settlement_date': 'Ngày quyết toán không được trước ngày tạm ứng.'})
            if settlement_date and disbursement_tx.transaction_date and settlement_date < disbursement_tx.transaction_date:
                raise serializers.ValidationError({'settlement_date': 'Ngày quyết toán không được trước ngày chi tiền thực tế.'})
            advance_amount = Decimal(str(advance.amount or 0))
            from django.db.models import Sum
            existing_qs = advance.settlements.all()
            if self.instance:
                existing_qs = existing_qs.exclude(pk=self.instance.pk)
            existing_totals = existing_qs.aggregate(
                existing_spent=Sum('spent_amount'),
                existing_refund=Sum('refund_amount'),
            )
            existing_total = Decimal(str(existing_totals.get('existing_spent') or 0)) + Decimal(str(existing_totals.get('existing_refund') or 0))
            new_total = existing_total + spent + refund
            if new_total > advance_amount:
                raise serializers.ValidationError(
                    f'Tổng quyết toán ({new_total:,.0f}) vượt quá số tiền tạm ứng ({advance_amount:,.0f}). '
                    f'Còn được quyết toán tối đa: {max(0, advance_amount - existing_total):,.0f}.'
                )
        return attrs


class ReceivableSettlementSerializer(serializers.ModelSerializer):
    receivable_code = serializers.CharField(source='receivable_document.code', read_only=True)
    customer_name = serializers.SerializerMethodField()
    source_cash_account_name = serializers.CharField(source='source_cash_account.name', read_only=True)
    source_bank_account_code = serializers.CharField(source='source_bank_account.code', read_only=True)
    cash_transaction_id = serializers.IntegerField(source='cash_transaction.id', read_only=True)

    class Meta:
        model = ReceivableSettlement
        fields = [
            'id',
            'receivable_document',
            'receivable_code',
            'customer_name',
            'settlement_date',
            'amount',
            'source_type',
            'source_cash_account',
            'source_cash_account_name',
            'source_bank_account',
            'source_bank_account_code',
            'cash_transaction_id',
            'note',
            'created_at',
            'updated_at',
        ]
        read_only_fields = fields

    def get_customer_name(self, obj):
        snapshot = getattr(obj.receivable_document, 'customer_snapshot', None) or {}
        return snapshot.get('name') or snapshot.get('company_name')


class ReceivableDocumentSerializer(serializers.ModelSerializer):
    source_sales_order_code = serializers.CharField(source='source_sales_order.code', read_only=True)
    customer_name = serializers.SerializerMethodField()
    customer_code = serializers.SerializerMethodField()
    remaining_amount = serializers.DecimalField(max_digits=18, decimal_places=2, read_only=True)
    days_overdue = serializers.SerializerMethodField()
    settlements = ReceivableSettlementSerializer(many=True, read_only=True)

    class Meta:
        model = ReceivableDocument
        fields = [
            'id',
            'code',
            'source_sales_order',
            'source_sales_order_code',
            'customer',
            'customer_code',
            'customer_name',
            'customer_snapshot',
            'document_date',
            'due_date',
            'currency',
            'exchange_rate',
            'subtotal_amount',
            'tax_amount',
            'total_amount',
            'settled_amount',
            'remaining_amount',
            'days_overdue',
            'status',
            'reference',
            'note',
            'version',
            'created_at',
            'updated_at',
            'settlements',
        ]
        read_only_fields = fields

    def get_customer_name(self, obj):
        snapshot = obj.customer_snapshot or {}
        return snapshot.get('name') or snapshot.get('company_name') or getattr(getattr(obj, 'customer', None), 'name', None)

    def get_customer_code(self, obj):
        snapshot = obj.customer_snapshot or {}
        return snapshot.get('code') or getattr(getattr(obj, 'customer', None), 'code', None)

    def get_days_overdue(self, obj):
        if obj.status == 'CANCELLED' or not obj.due_date or obj.remaining_amount <= 0:
            return 0
        delta = (timezone.localdate() - obj.due_date).days
        return delta if delta > 0 else 0


class PayableSettlementSerializer(serializers.ModelSerializer):
    payable_code = serializers.CharField(source='payable_document.code', read_only=True)
    supplier_name = serializers.SerializerMethodField()
    source_cash_account_name = serializers.CharField(source='source_cash_account.name', read_only=True)
    source_bank_account_code = serializers.CharField(source='source_bank_account.code', read_only=True)
    cash_transaction_id = serializers.IntegerField(source='cash_transaction.id', read_only=True)

    class Meta:
        model = PayableSettlement
        fields = [
            'id',
            'payable_document',
            'payable_code',
            'supplier_name',
            'settlement_date',
            'amount',
            'source_type',
            'source_cash_account',
            'source_cash_account_name',
            'source_bank_account',
            'source_bank_account_code',
            'cash_transaction_id',
            'note',
            'created_at',
            'updated_at',
        ]
        read_only_fields = fields

    def get_supplier_name(self, obj):
        snapshot = getattr(obj.payable_document, 'supplier_snapshot', None) or {}
        return snapshot.get('name') or snapshot.get('company_name')


class PayableDocumentSerializer(serializers.ModelSerializer):
    source_purchase_receipt_code = serializers.CharField(source='source_purchase_receipt.code', read_only=True)
    source_purchase_order_code = serializers.SerializerMethodField()
    supplier_name = serializers.SerializerMethodField()
    supplier_code = serializers.SerializerMethodField()
    remaining_amount = serializers.DecimalField(max_digits=18, decimal_places=2, read_only=True)
    days_overdue = serializers.SerializerMethodField()
    settlements = PayableSettlementSerializer(many=True, read_only=True)

    class Meta:
        model = PayableDocument
        fields = [
            'id',
            'code',
            'source_purchase_receipt',
            'source_purchase_receipt_code',
            'source_purchase_order_code',
            'supplier',
            'supplier_code',
            'supplier_name',
            'supplier_snapshot',
            'document_date',
            'due_date',
            'vendor_invoice_no',
            'vendor_invoice_date',
            'currency',
            'exchange_rate',
            'subtotal_amount',
            'tax_amount',
            'total_amount',
            'settled_amount',
            'remaining_amount',
            'days_overdue',
            'status',
            'reference',
            'note',
            'version',
            'created_at',
            'updated_at',
            'settlements',
        ]
        read_only_fields = fields

    def get_source_purchase_order_code(self, obj):
        return getattr(getattr(getattr(obj, 'source_purchase_receipt', None), 'purchase_order', None), 'code', None)

    def get_supplier_name(self, obj):
        snapshot = obj.supplier_snapshot or {}
        return snapshot.get('name') or snapshot.get('company_name') or getattr(getattr(obj, 'supplier', None), 'name', None)

    def get_supplier_code(self, obj):
        snapshot = obj.supplier_snapshot or {}
        return snapshot.get('code') or getattr(getattr(obj, 'supplier', None), 'code', None)

    def get_days_overdue(self, obj):
        if obj.status == 'CANCELLED' or not obj.due_date or obj.remaining_amount <= 0:
            return 0
        delta = (timezone.localdate() - obj.due_date).days
        return delta if delta > 0 else 0



# ============== GENERAL LEDGER ==============
class GeneralLedgerAccountSerializer(serializers.ModelSerializer):
    class Meta:
        model = GeneralLedgerAccount
        fields = ['id', 'code', 'name', 'account_type', 'description', 'is_active', 'created_at', 'updated_at']
        read_only_fields = ['created_at', 'updated_at']


class GeneralLedgerEntrySerializer(serializers.ModelSerializer):
    account_name = serializers.CharField(source='account.name', read_only=True)
    account_code = serializers.CharField(source='account.code', read_only=True)
    account_type = serializers.CharField(source='account.account_type', read_only=True)
    created_by_name = serializers.CharField(source='created_by.username', read_only=True, allow_null=True)
    
    class Meta:
        model = GeneralLedgerEntry
        fields = [
            'id', 'account', 'account_name', 'account_code', 'account_type',
            'posting_date', 'debit_amount', 'credit_amount',
            'document_type', 'document_id', 'document_code', 'description',
            'created_by', 'created_by_name', 'created_at'
        ]
        read_only_fields = ['id', 'created_at', 'created_by']
