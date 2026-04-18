from django.contrib import admin
from .models import (
    AttendanceOvertimeItem,
    AttendanceRecord,
    BonusPenaltyRecord,
    Employee,
    PayrollRecord,
    SalaryAdvanceRecord,
)


@admin.register(Employee)
class EmployeeAdmin(admin.ModelAdmin):
    list_display = ('code', 'name', 'department', 'position', 'status', 'is_active')
    search_fields = ('code', 'name', 'department', 'position', 'phone', 'email')
    list_filter = ('status', 'is_active', 'department')


class AttendanceOvertimeInline(admin.TabularInline):
    model = AttendanceOvertimeItem
    extra = 0


@admin.register(AttendanceRecord)
class AttendanceRecordAdmin(admin.ModelAdmin):
    list_display = ('employee', 'month', 'standard_days', 'actual_days', 'is_active')
    search_fields = ('employee__code', 'employee__name', 'month', 'note')
    list_filter = ('month', 'is_active')
    inlines = [AttendanceOvertimeInline]


@admin.register(BonusPenaltyRecord)
class BonusPenaltyRecordAdmin(admin.ModelAdmin):
    list_display = ('employee', 'month', 'record_type', 'amount', 'record_date', 'is_active')
    search_fields = ('employee__code', 'employee__name', 'reason', 'approved_by_name', 'note')
    list_filter = ('month', 'record_type', 'is_active')


@admin.register(SalaryAdvanceRecord)
class SalaryAdvanceRecordAdmin(admin.ModelAdmin):
    list_display = ('employee', 'advance_date', 'month', 'amount', 'status', 'is_active')
    search_fields = ('employee__code', 'employee__name', 'reason', 'approved_by_name', 'note')
    list_filter = ('month', 'status', 'is_active')


@admin.register(PayrollRecord)
class PayrollRecordAdmin(admin.ModelAdmin):
    list_display = ('employee', 'month', 'actual_days', 'total_income', 'total_deductions', 'net_pay', 'status')
    search_fields = ('employee__code', 'employee__name', 'month', 'note')
    list_filter = ('month', 'status')

