from decimal import Decimal

from rest_framework import serializers

from .models import (
    AdvanceSettlement,
    AdvanceTransaction,
    BankAccount,
    CashAccount,
    CashTransaction,
    TransactionCategory,
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

