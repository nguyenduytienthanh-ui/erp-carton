from django.contrib import admin

from .models import (
    AdvanceSettlement,
    AdvanceTransaction,
    BankAccount,
    CashAccount,
    CashTransaction,
    TransactionCategory,
)


@admin.register(TransactionCategory)
class TransactionCategoryAdmin(admin.ModelAdmin):
    list_display = ('code', 'name', 'category_type', 'is_system', 'is_active')
    search_fields = ('code', 'name')
    list_filter = ('category_type', 'is_system', 'is_active')


@admin.register(BankAccount)
class BankAccountAdmin(admin.ModelAdmin):
    list_display = ('code', 'account_number', 'bank_name', 'is_active')
    search_fields = ('code', 'account_number', 'account_name', 'bank_name')
    list_filter = ('is_active', 'bank_name')


@admin.register(CashAccount)
class CashAccountAdmin(admin.ModelAdmin):
    list_display = ('name', 'account_type', 'balance', 'is_active')
    search_fields = ('name',)
    list_filter = ('account_type', 'is_active')


@admin.register(CashTransaction)
class CashTransactionAdmin(admin.ModelAdmin):
    list_display = ('transaction_date', 'transaction_type', 'amount', 'source_type', 'source_cash_account')
    search_fields = ('reason', 'object_name')
    list_filter = ('transaction_type', 'source_type', 'transaction_date')


@admin.register(AdvanceTransaction)
class AdvanceTransactionAdmin(admin.ModelAdmin):
    list_display = ('code', 'advance_date', 'recipient_name', 'advance_type', 'amount', 'status', 'is_active')
    search_fields = ('code', 'recipient_name', 'purpose')
    list_filter = ('advance_type', 'status', 'source_type', 'is_active')


@admin.register(AdvanceSettlement)
class AdvanceSettlementAdmin(admin.ModelAdmin):
    list_display = ('advance_transaction', 'settlement_date', 'spent_amount', 'refund_amount')
    search_fields = ('advance_transaction__code', 'advance_transaction__recipient_name', 'note')
    list_filter = ('settlement_date',)

