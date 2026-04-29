import json

from core.models import Setting

from .models import GeneralLedgerAccount


FINANCE_GL_CONTROL_ACCOUNT_MAPPINGS_KEY = 'FINANCE_GL_CONTROL_ACCOUNT_MAPPINGS'

FINANCE_GL_CONTROL_ACCOUNT_FIELDS = (
    'ar_control_gl_account_id',
    'ap_control_gl_account_id',
    'advance_control_gl_account_id',
    'bank_reconciliation_adjustment_gl_account_id',
    'payroll_clearing_gl_account_id',
    'default_sales_revenue_gl_account_id',
    'default_purchase_clearing_gl_account_id',
    'default_advance_settlement_expense_gl_account_id',
    'inventory_asset_gl_account_id',
    'cogs_gl_account_id',
    'production_wip_gl_account_id',
    'inventory_adjustment_gl_account_id',
    'vat_input_gl_account_id',
    'vat_output_gl_account_id',
)


class FinancePostingError(ValueError):
    pass


def _normalize_mapping_payload(payload: dict | None) -> dict:
    normalized = {field: None for field in FINANCE_GL_CONTROL_ACCOUNT_FIELDS}
    if not isinstance(payload, dict):
        return normalized

    for field in FINANCE_GL_CONTROL_ACCOUNT_FIELDS:
        raw_value = payload.get(field)
        if raw_value in (None, '', 0, '0'):
            normalized[field] = None
            continue
        try:
            normalized[field] = int(raw_value)
        except (TypeError, ValueError):
            normalized[field] = None
    return normalized


def get_finance_gl_control_mapping_ids() -> dict:
    row = Setting.objects.filter(key=FINANCE_GL_CONTROL_ACCOUNT_MAPPINGS_KEY, is_active=True).first()
    if not row:
        return _normalize_mapping_payload({})

    try:
        parsed = json.loads(str(row.value or '{}'))
    except Exception:
        parsed = {}
    return _normalize_mapping_payload(parsed if isinstance(parsed, dict) else {})


def get_finance_gl_control_mappings() -> dict:
    mapping_ids = get_finance_gl_control_mapping_ids()
    account_ids = [account_id for account_id in mapping_ids.values() if account_id]
    accounts = {
        account.id: account
        for account in GeneralLedgerAccount.objects.filter(id__in=account_ids)
    }
    return {
        field: {
            'id': account_id,
            'code': accounts[account_id].code if account_id and account_id in accounts else None,
            'name': accounts[account_id].name if account_id and account_id in accounts else None,
        }
        for field, account_id in mapping_ids.items()
    }


def save_finance_gl_control_mappings(payload: dict) -> dict:
    normalized = _normalize_mapping_payload(payload)
    account_ids = [account_id for account_id in normalized.values() if account_id]
    accounts = {
        account.id: account
        for account in GeneralLedgerAccount.objects.filter(id__in=account_ids)
    }
    missing_ids = [account_id for account_id in account_ids if account_id not in accounts]
    if missing_ids:
        raise FinancePostingError(
            f'Không tìm thấy tài khoản kế toán: {", ".join(str(item) for item in missing_ids)}.'
        )

    Setting.objects.update_or_create(
        key=FINANCE_GL_CONTROL_ACCOUNT_MAPPINGS_KEY,
        defaults={
            'value': json.dumps(normalized),
            'data_type': 'json',
            'description': 'Mapping control accounts cho kế toán tài chính.',
            'is_active': True,
        },
    )
    return get_finance_gl_control_mappings()
