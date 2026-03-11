import re
from decimal import Decimal

from rest_framework import serializers

from finance.models import CashTransaction
from .models import (
    AttendanceOvertimeItem,
    AttendanceRecord,
    BonusPenaltyRecord,
    Employee,
    EmployeeProfileHistory,
    PayrollRecord,
    SalaryAdvanceRecord,
)

_MONTH_RE = re.compile(r'^\d{4}-(0[1-9]|1[0-2])$')


class EmployeeSerializer(serializers.ModelSerializer):
    created_by_username = serializers.CharField(source='created_by.username', read_only=True)
    updated_by_username = serializers.CharField(source='updated_by.username', read_only=True)
    profile_effective_month = serializers.CharField(write_only=True, required=False, allow_blank=True)

    def validate_profile_effective_month(self, value):
        if value and not _MONTH_RE.match(str(value)):
            raise serializers.ValidationError('Tháng hiệu lực phải có dạng YYYY-MM (ví dụ: 2025-01).')
        return value

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
            'profile_effective_month',
            'is_active',
            'created_by',
            'updated_by',
            'created_by_username',
            'updated_by_username',
            'created_at',
            'updated_at',
        ]
        read_only_fields = ['created_by', 'updated_by', 'created_at', 'updated_at']


class EmployeeProfileHistorySerializer(serializers.ModelSerializer):
    employee_code = serializers.CharField(source='employee.code', read_only=True)
    employee_name = serializers.CharField(source='employee.name', read_only=True)

    def validate_effective_month(self, value):
        if not value or not _MONTH_RE.match(str(value)):
            raise serializers.ValidationError('Tháng hiệu lực phải có dạng YYYY-MM (ví dụ: 2025-01).')
        return value

    def validate_salary_basic(self, value):
        if value is None or Decimal(str(value)) < 0:
            raise serializers.ValidationError('Lương cơ bản không được âm.')
        return value

    class Meta:
        model = EmployeeProfileHistory
        fields = [
            'id',
            'employee',
            'employee_code',
            'employee_name',
            'effective_month',
            'salary_basic',
            'department',
            'position',
            'status',
            'note',
            'created_by',
            'updated_by',
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

    def validate_month(self, value):
        if not value or not _MONTH_RE.match(str(value)):
            raise serializers.ValidationError('Tháng phải có dạng YYYY-MM (ví dụ: 2025-01).')
        return value

    def validate_employee(self, value):
        if not getattr(value, 'is_active', False) or getattr(value, 'status', '') == Employee.STATUS_RESIGNED:
            raise serializers.ValidationError('Không được chấm công cho nhân viên đã nghỉ việc hoặc ngừng hiệu lực.')
        return value

    def validate(self, attrs):
        standard_days = attrs.get('standard_days', getattr(self.instance, 'standard_days', None))
        actual_days = attrs.get('actual_days', getattr(self.instance, 'actual_days', None))
        paid_leave = attrs.get('paid_leave', getattr(self.instance, 'paid_leave', None))
        unpaid_leave = attrs.get('unpaid_leave', getattr(self.instance, 'unpaid_leave', None))
        month = attrs.get('month') or getattr(self.instance, 'month', '')
        if standard_days is not None and Decimal(str(standard_days)) <= 0:
            raise serializers.ValidationError({'standard_days': 'Số ngày công chuẩn phải lớn hơn 0.'})
        if actual_days is not None and Decimal(str(actual_days)) < 0:
            raise serializers.ValidationError({'actual_days': 'Số ngày thực công không được âm.'})
        if paid_leave is not None and Decimal(str(paid_leave)) < 0:
            raise serializers.ValidationError({'paid_leave': 'Số ngày nghỉ phép không được âm.'})
        if unpaid_leave is not None and Decimal(str(unpaid_leave)) < 0:
            raise serializers.ValidationError({'unpaid_leave': 'Số ngày nghỉ không phép không được âm.'})
        if standard_days is not None and actual_days is not None:
            standard_value = Decimal(str(standard_days))
            actual_value = Decimal(str(actual_days))
            paid_leave_value = Decimal(str(paid_leave or 0))
            unpaid_leave_value = Decimal(str(unpaid_leave or 0))
            if actual_value > standard_value:
                raise serializers.ValidationError({'actual_days': 'Số ngày thực công không thể vượt quá số ngày công chuẩn.'})
            if actual_value + paid_leave_value + unpaid_leave_value > standard_value:
                raise serializers.ValidationError({
                    'non_field_errors': 'Tổng công thực tế + nghỉ phép + nghỉ không lương không được vượt quá số ngày công chuẩn.'
                })
        for item in attrs.get('overtime_items') or []:
            overtime_date = str(item.get('overtime_date') or '')
            if month and overtime_date[:7] != str(month):
                raise serializers.ValidationError({'overtime_items': 'Ngày tăng ca phải nằm trong đúng tháng bảng chấm công.'})
        return attrs

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

    def validate_month(self, value):
        if not value or not _MONTH_RE.match(str(value)):
            raise serializers.ValidationError('Tháng phải có dạng YYYY-MM (ví dụ: 2025-01).')
        return value

    def validate_amount(self, value):
        if value is None or Decimal(str(value)) <= 0:
            raise serializers.ValidationError('Số tiền thưởng/phạt phải lớn hơn 0.')
        return value

    def validate_employee(self, value):
        if not getattr(value, 'is_active', False) or getattr(value, 'status', '') == Employee.STATUS_RESIGNED:
            raise serializers.ValidationError('Không được lập thưởng/phạt cho nhân viên đã nghỉ việc hoặc ngừng hiệu lực.')
        return value


class SalaryAdvanceRecordSerializer(serializers.ModelSerializer):
    employee_code = serializers.CharField(source='employee.code', read_only=True)
    employee_name = serializers.CharField(source='employee.name', read_only=True)
    disbursement_status = serializers.SerializerMethodField()
    disbursement_transaction_id = serializers.SerializerMethodField()
    disbursed_at = serializers.SerializerMethodField()

    @staticmethod
    def _disbursement_marker(obj) -> str:
        return f'[SALADV:{obj.id}]'

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
            raise serializers.ValidationError('Số tiền ứng lương phải lớn hơn 0.')
        return value

    def validate_month(self, value):
        if not value or not _MONTH_RE.match(str(value)):
            raise serializers.ValidationError('Tháng phải có dạng YYYY-MM (ví dụ: 2025-01).')
        return value

    def validate_employee(self, value):
        if not getattr(value, 'is_active', False) or getattr(value, 'status', '') == Employee.STATUS_RESIGNED:
            raise serializers.ValidationError('Chỉ được tạo ứng lương cho nhân viên đang làm và còn hiệu lực.')
        return value

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
            'disbursement_status',
            'disbursement_transaction_id',
            'disbursed_at',
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


class PayrollRecordSerializer(serializers.ModelSerializer):
    employee_code = serializers.CharField(source='employee.code', read_only=True)
    employee_name = serializers.CharField(source='employee.name', read_only=True)
    employee_department = serializers.CharField(source='employee_department_snapshot', read_only=True)
    employee_position = serializers.CharField(source='employee_position_snapshot', read_only=True)

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
            'profile_effective_month',
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

