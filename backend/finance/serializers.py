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


class AdvanceTransactionSerializer(serializers.ModelSerializer):
    source_cash_account_name = serializers.CharField(source='source_cash_account.name', read_only=True)
    source_bank_account_code = serializers.CharField(source='source_bank_account.code', read_only=True)
    total_spent = serializers.DecimalField(max_digits=15, decimal_places=2, read_only=True)
    total_refund = serializers.DecimalField(max_digits=15, decimal_places=2, read_only=True)
    remaining_amount = serializers.DecimalField(max_digits=15, decimal_places=2, read_only=True)

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

