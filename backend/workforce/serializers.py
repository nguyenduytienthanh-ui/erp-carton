from rest_framework import serializers
from .models import (
    AttendanceOvertimeItem,
    AttendanceRecord,
    BonusPenaltyRecord,
    Employee,
    PayrollRecord,
    SalaryAdvanceRecord,
)


class EmployeeSerializer(serializers.ModelSerializer):
    created_by_username = serializers.CharField(source='created_by.username', read_only=True)
    updated_by_username = serializers.CharField(source='updated_by.username', read_only=True)

    class Meta:
        model = Employee
        fields = [
            'id',
            'code',
            'name',
            'cccd',
            'birth_date',
            'gender',
            'address',
            'phone',
            'email',
            'department',
            'position',
            'start_date',
            'status',
            'salary_basic',
            'bank_account_number',
            'bank_name',
            'bank_branch',
            'note',
            'is_active',
            'created_by',
            'updated_by',
            'created_by_username',
            'updated_by_username',
            'created_at',
            'updated_at',
        ]
        read_only_fields = ['created_by', 'updated_by', 'created_at', 'updated_at']


class AttendanceOvertimeItemSerializer(serializers.ModelSerializer):
    class Meta:
        model = AttendanceOvertimeItem
        fields = [
            'id',
            'attendance',
            'overtime_date',
            'day_type',
            'shift',
            'hours',
            'rate',
            'note',
            'created_at',
            'updated_at',
        ]
        read_only_fields = ['created_at', 'updated_at']


class AttendanceRecordSerializer(serializers.ModelSerializer):
    employee_code = serializers.CharField(source='employee.code', read_only=True)
    employee_name = serializers.CharField(source='employee.name', read_only=True)
    overtime_items = AttendanceOvertimeItemSerializer(many=True, required=False)
    total_overtime_hours = serializers.DecimalField(max_digits=7, decimal_places=2, read_only=True)

    class Meta:
        model = AttendanceRecord
        fields = [
            'id',
            'employee',
            'employee_code',
            'employee_name',
            'month',
            'standard_days',
            'actual_days',
            'paid_leave',
            'unpaid_leave',
            'note',
            'is_active',
            'overtime_items',
            'total_overtime_hours',
            'created_by',
            'updated_by',
            'created_at',
            'updated_at',
        ]
        read_only_fields = ['created_by', 'updated_by', 'created_at', 'updated_at', 'total_overtime_hours']

    def create(self, validated_data):
        overtime_items = validated_data.pop('overtime_items', [])
        instance = AttendanceRecord.objects.create(**validated_data)
        for item in overtime_items:
            AttendanceOvertimeItem.objects.create(attendance=instance, **item)
        return instance

    def update(self, instance, validated_data):
        overtime_items = validated_data.pop('overtime_items', None)
        for field, value in validated_data.items():
            setattr(instance, field, value)
        instance.save()

        if overtime_items is not None:
            instance.overtime_items.all().delete()
            for item in overtime_items:
                AttendanceOvertimeItem.objects.create(attendance=instance, **item)
        return instance


class BonusPenaltyRecordSerializer(serializers.ModelSerializer):
    employee_code = serializers.CharField(source='employee.code', read_only=True)
    employee_name = serializers.CharField(source='employee.name', read_only=True)

    class Meta:
        model = BonusPenaltyRecord
        fields = [
            'id',
            'employee',
            'employee_code',
            'employee_name',
            'month',
            'record_type',
            'reason',
            'amount',
            'calculation_type',
            'record_date',
            'approved_by_name',
            'note',
            'is_active',
            'created_by',
            'updated_by',
            'created_at',
            'updated_at',
        ]
        read_only_fields = ['created_by', 'updated_by', 'created_at', 'updated_at']


class SalaryAdvanceRecordSerializer(serializers.ModelSerializer):
    employee_code = serializers.CharField(source='employee.code', read_only=True)
    employee_name = serializers.CharField(source='employee.name', read_only=True)

    class Meta:
        model = SalaryAdvanceRecord
        fields = [
            'id',
            'employee',
            'employee_code',
            'employee_name',
            'advance_date',
            'month',
            'amount',
            'reason',
            'approved_by_name',
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


class PayrollRecordSerializer(serializers.ModelSerializer):
    employee_code = serializers.CharField(source='employee.code', read_only=True)
    employee_name = serializers.CharField(source='employee.name', read_only=True)
    employee_department = serializers.CharField(source='employee.department', read_only=True)
    employee_position = serializers.CharField(source='employee.position', read_only=True)

    class Meta:
        model = PayrollRecord
        fields = [
            'id',
            'employee',
            'employee_code',
            'employee_name',
            'employee_department',
            'employee_position',
            'month',
            'standard_days',
            'actual_days',
            'basic_salary',
            'salary_by_attendance',
            'overtime_pay',
            'total_bonus',
            'total_penalty',
            'advance_deduction',
            'total_income',
            'total_deductions',
            'net_pay',
            'status',
            'note',
            'created_by',
            'updated_by',
            'created_at',
            'updated_at',
        ]
        read_only_fields = ['created_by', 'updated_by', 'created_at', 'updated_at']

