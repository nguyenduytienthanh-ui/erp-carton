from __future__ import annotations

from decimal import Decimal
from typing import Iterable

from django.db import transaction
from django.utils import timezone

from .models import BundlePriceChange, PriceChange, Product, ProductBundle


PRICE_FIELD_NAMES = (
    'cost_price',
    'sale_price',
    'commission_per_unit',
    'commission_percent',
)

BUNDLE_FIXED_FIELD_NAMES = (
    'fixed_cost_price',
    'fixed_sale_price',
    'fixed_commission_per_unit',
    'fixed_commission_percent',
)


def _to_decimal(value, default: str = '0') -> Decimal:
    if value is None or value == '':
        return Decimal(default)
    if isinstance(value, Decimal):
        return value
    return Decimal(str(value))


def build_product_price_snapshot(product: Product) -> dict[str, Decimal]:
    return {
        'cost_price': _to_decimal(getattr(product, 'cost_price', 0)),
        'sale_price': _to_decimal(getattr(product, 'sale_price', 0)),
        'commission_per_unit': _to_decimal(getattr(product, 'commission_per_unit', 0)),
        'commission_percent': _to_decimal(getattr(product, 'commission_percent', 0)),
    }


def merge_price_values(base_values: dict[str, Decimal], overrides: dict[str, Decimal | None] | None = None) -> dict[str, Decimal]:
    merged = dict(base_values)
    for field in PRICE_FIELD_NAMES:
        if overrides and field in overrides and overrides[field] is not None:
            merged[field] = _to_decimal(overrides[field])
    return merged


def build_bundle_price_snapshot(bundle: ProductBundle) -> dict[str, Decimal]:
    return {
        'fixed_cost_price': _to_decimal(getattr(bundle, 'fixed_cost_price', 0)),
        'fixed_sale_price': _to_decimal(getattr(bundle, 'fixed_sale_price', 0)),
        'fixed_commission_per_unit': _to_decimal(getattr(bundle, 'fixed_commission_per_unit', 0)),
        'fixed_commission_percent': _to_decimal(getattr(bundle, 'fixed_commission_percent', 0)),
    }


def merge_bundle_price_values(
    base_values: dict[str, Decimal],
    overrides: dict[str, Decimal | None] | None = None,
) -> dict[str, Decimal]:
    merged = dict(base_values)
    for field in BUNDLE_FIXED_FIELD_NAMES:
        if overrides and field in overrides and overrides[field] is not None:
            merged[field] = _to_decimal(overrides[field])
    return merged


def resolve_product_price_as_of(product: Product, as_of_datetime=None) -> dict[str, Decimal | int | None]:
    as_of = as_of_datetime or timezone.now()
    change = (
        PriceChange.objects
        .filter(
            product=product,
            status__in=[
                PriceChange.STATUS_ACTIVE_APPLIED,
                PriceChange.STATUS_APPROVED_SCHEDULED,
            ],
            effective_at__isnull=False,
            effective_at__lte=as_of,
        )
        .order_by('-effective_at', '-approved_at', '-applied_at', '-id')
        .first()
    )
    if change:
        return {
            'cost_price': _to_decimal(change.new_cost_price),
            'sale_price': _to_decimal(change.new_sale_price),
            'commission_per_unit': _to_decimal(change.new_commission_per_unit),
            'commission_percent': _to_decimal(change.new_commission_percent),
            'price_change_id': change.id,
            'effective_at': change.effective_at,
            'status': change.status,
        }
    snapshot = build_product_price_snapshot(product)
    return {
        **snapshot,
        'price_change_id': None,
        'effective_at': None,
        'status': None,
    }


def apply_price_snapshot_to_product(product: Product, snapshot: dict[str, Decimal], updated_by=None):
    changed_fields: list[str] = []
    for field in PRICE_FIELD_NAMES:
        next_value = _to_decimal(snapshot.get(field))
        if getattr(product, field) != next_value:
            setattr(product, field, next_value)
            changed_fields.append(field)
    if updated_by is not None and getattr(product, 'updated_by_id', None) != getattr(updated_by, 'id', None):
        product.updated_by = updated_by
        changed_fields.append('updated_by')
    if changed_fields:
        changed_fields.append('updated_at')
        product.save(update_fields=changed_fields)


def apply_price_snapshot_to_bundle(bundle: ProductBundle, snapshot: dict[str, Decimal], updated_by=None):
    changed_fields: list[str] = []
    for field in BUNDLE_FIXED_FIELD_NAMES:
        next_value = _to_decimal(snapshot.get(field))
        if getattr(bundle, field) != next_value:
            setattr(bundle, field, next_value)
            changed_fields.append(field)
    if updated_by is not None and getattr(bundle, 'updated_by_id', None) != getattr(updated_by, 'id', None):
        bundle.updated_by = updated_by
        changed_fields.append('updated_by')
    if changed_fields:
        changed_fields.append('updated_at')
        bundle.save(update_fields=changed_fields)


def _mark_conflicts_as_superseded(price_change: PriceChange):
    effective_at = price_change.effective_at
    if effective_at is None:
        return
    (
        PriceChange.objects
        .filter(
            product=price_change.product,
            effective_at=effective_at,
            status__in=[
                PriceChange.STATUS_PENDING_APPROVAL,
                PriceChange.STATUS_APPROVED_SCHEDULED,
            ],
        )
        .exclude(pk=price_change.pk)
        .update(status=PriceChange.STATUS_SUPERSEDED)
    )


def _mark_bundle_conflicts_as_superseded(price_change: BundlePriceChange):
    effective_at = price_change.effective_at
    if effective_at is None:
        return
    (
        BundlePriceChange.objects
        .filter(
            bundle=price_change.bundle,
            effective_at=effective_at,
            status__in=[
                BundlePriceChange.STATUS_PENDING_APPROVAL,
                BundlePriceChange.STATUS_APPROVED_SCHEDULED,
            ],
        )
        .exclude(pk=price_change.pk)
        .update(status=BundlePriceChange.STATUS_SUPERSEDED)
    )


@transaction.atomic
def submit_price_change_request(
    product: Product,
    *,
    new_values: dict[str, Decimal | None],
    reason: str,
    actor,
    effective_at=None,
    source: str = PriceChange.SOURCE_MANUAL,
    batch_code: str = '',
) -> PriceChange:
    current_values = resolve_product_price_as_of(product, timezone.now())
    old_snapshot = {
        field: _to_decimal(current_values.get(field))
        for field in PRICE_FIELD_NAMES
    }
    next_snapshot = merge_price_values(old_snapshot, new_values)
    price_change = PriceChange.objects.create(
        product=product,
        old_cost_price=old_snapshot['cost_price'],
        new_cost_price=next_snapshot['cost_price'],
        old_sale_price=old_snapshot['sale_price'],
        new_sale_price=next_snapshot['sale_price'],
        old_commission_per_unit=old_snapshot['commission_per_unit'],
        new_commission_per_unit=next_snapshot['commission_per_unit'],
        old_commission_percent=old_snapshot['commission_percent'],
        new_commission_percent=next_snapshot['commission_percent'],
        delta_cost=next_snapshot['cost_price'] - old_snapshot['cost_price'],
        delta_sale=next_snapshot['sale_price'] - old_snapshot['sale_price'],
        reason=reason,
        source=source,
        effective_at=effective_at,
        status=PriceChange.STATUS_PENDING_APPROVAL,
        submitted_by=actor,
        batch_code=batch_code or '',
    )
    price_change.recalculate_delta_percents(save=True)
    return price_change


@transaction.atomic
def record_direct_price_change(
    product: Product,
    *,
    new_values: dict[str, Decimal | None],
    actor,
    reason: str = '',
    effective_at=None,
    source: str = PriceChange.SOURCE_MANUAL,
    batch_code: str = '',
) -> PriceChange:
    now = timezone.now()
    effective_dt = effective_at or now
    current_values = resolve_product_price_as_of(product, now)
    old_snapshot = {
        field: _to_decimal(current_values.get(field))
        for field in PRICE_FIELD_NAMES
    }
    next_snapshot = merge_price_values(old_snapshot, new_values)
    status = (
        PriceChange.STATUS_ACTIVE_APPLIED
        if effective_dt <= now
        else PriceChange.STATUS_APPROVED_SCHEDULED
    )
    price_change = PriceChange.objects.create(
        product=product,
        old_cost_price=old_snapshot['cost_price'],
        new_cost_price=next_snapshot['cost_price'],
        old_sale_price=old_snapshot['sale_price'],
        new_sale_price=next_snapshot['sale_price'],
        old_commission_per_unit=old_snapshot['commission_per_unit'],
        new_commission_per_unit=next_snapshot['commission_per_unit'],
        old_commission_percent=old_snapshot['commission_percent'],
        new_commission_percent=next_snapshot['commission_percent'],
        delta_cost=next_snapshot['cost_price'] - old_snapshot['cost_price'],
        delta_sale=next_snapshot['sale_price'] - old_snapshot['sale_price'],
        reason=reason,
        source=source,
        effective_at=effective_dt,
        status=status,
        submitted_by=actor,
        approved_by=actor,
        approved_at=now,
        applied_at=now if status == PriceChange.STATUS_ACTIVE_APPLIED else None,
        batch_code=batch_code or '',
    )
    price_change.recalculate_delta_percents(save=True)
    _mark_conflicts_as_superseded(price_change)
    if status == PriceChange.STATUS_ACTIVE_APPLIED:
        apply_price_snapshot_to_product(product, next_snapshot, updated_by=actor)
    return price_change


@transaction.atomic
def approve_price_change(price_change: PriceChange, approver) -> PriceChange:
    now = timezone.now()
    effective_dt = price_change.effective_at or now
    status = (
        PriceChange.STATUS_ACTIVE_APPLIED
        if effective_dt <= now
        else PriceChange.STATUS_APPROVED_SCHEDULED
    )
    price_change.effective_at = effective_dt
    price_change.status = status
    price_change.approved_by = approver
    price_change.approved_at = now
    if status == PriceChange.STATUS_ACTIVE_APPLIED:
        price_change.applied_at = now
    price_change.save(update_fields=[
        'effective_at',
        'status',
        'approved_by',
        'approved_at',
        'applied_at',
        'updated_at',
    ])
    _mark_conflicts_as_superseded(price_change)
    if status == PriceChange.STATUS_ACTIVE_APPLIED:
        apply_price_snapshot_to_product(
            price_change.product,
            {
                'cost_price': price_change.new_cost_price,
                'sale_price': price_change.new_sale_price,
                'commission_per_unit': price_change.new_commission_per_unit,
                'commission_percent': price_change.new_commission_percent,
            },
            updated_by=approver,
        )
    return price_change


@transaction.atomic
def activate_due_price_changes(product_ids: Iterable[int] | None = None, *, as_of_datetime=None) -> list[int]:
    as_of = as_of_datetime or timezone.now()
    queryset = (
        PriceChange.objects
        .select_related('product')
        .filter(
            status=PriceChange.STATUS_APPROVED_SCHEDULED,
            effective_at__isnull=False,
            effective_at__lte=as_of,
        )
        .order_by('product_id', 'effective_at', 'id')
    )
    if product_ids:
        queryset = queryset.filter(product_id__in=list(product_ids))
    due_changes = list(queryset)
    if not due_changes:
        return []

    changed_products: dict[int, PriceChange] = {}
    updated_ids: list[int] = []
    for change in due_changes:
        change.status = PriceChange.STATUS_ACTIVE_APPLIED
        change.applied_at = as_of
        updated_ids.append(change.id)
        changed_products[change.product_id] = change
    PriceChange.objects.bulk_update(due_changes, ['status', 'applied_at', 'updated_at'])

    for latest_change in changed_products.values():
        apply_price_snapshot_to_product(
            latest_change.product,
            {
                'cost_price': latest_change.new_cost_price,
                'sale_price': latest_change.new_sale_price,
                'commission_per_unit': latest_change.new_commission_per_unit,
                'commission_percent': latest_change.new_commission_percent,
            },
            updated_by=latest_change.approved_by,
        )
    return updated_ids


@transaction.atomic
def submit_bundle_price_change_request(
    bundle: ProductBundle,
    *,
    new_values: dict[str, Decimal | None],
    reason: str,
    actor,
    effective_at=None,
    source: str = BundlePriceChange.SOURCE_MANUAL,
    batch_code: str = '',
) -> BundlePriceChange:
    old_snapshot = build_bundle_price_snapshot(bundle)
    next_snapshot = merge_bundle_price_values(old_snapshot, new_values)
    price_change = BundlePriceChange.objects.create(
        bundle=bundle,
        old_fixed_cost_price=old_snapshot['fixed_cost_price'],
        new_fixed_cost_price=next_snapshot['fixed_cost_price'],
        old_fixed_sale_price=old_snapshot['fixed_sale_price'],
        new_fixed_sale_price=next_snapshot['fixed_sale_price'],
        old_fixed_commission_per_unit=old_snapshot['fixed_commission_per_unit'],
        new_fixed_commission_per_unit=next_snapshot['fixed_commission_per_unit'],
        old_fixed_commission_percent=old_snapshot['fixed_commission_percent'],
        new_fixed_commission_percent=next_snapshot['fixed_commission_percent'],
        delta_cost=next_snapshot['fixed_cost_price'] - old_snapshot['fixed_cost_price'],
        delta_sale=next_snapshot['fixed_sale_price'] - old_snapshot['fixed_sale_price'],
        reason=reason,
        source=source,
        effective_at=effective_at,
        status=BundlePriceChange.STATUS_PENDING_APPROVAL,
        submitted_by=actor,
        batch_code=batch_code or '',
    )
    price_change.recalculate_delta_percents(save=True)
    return price_change


@transaction.atomic
def approve_bundle_price_change(price_change: BundlePriceChange, approver) -> BundlePriceChange:
    now = timezone.now()
    effective_dt = price_change.effective_at or now
    status = (
        BundlePriceChange.STATUS_ACTIVE_APPLIED
        if effective_dt <= now
        else BundlePriceChange.STATUS_APPROVED_SCHEDULED
    )
    price_change.effective_at = effective_dt
    price_change.status = status
    price_change.approved_by = approver
    price_change.approved_at = now
    if status == BundlePriceChange.STATUS_ACTIVE_APPLIED:
        price_change.applied_at = now
    price_change.save(update_fields=[
        'effective_at',
        'status',
        'approved_by',
        'approved_at',
        'applied_at',
        'updated_at',
    ])
    _mark_bundle_conflicts_as_superseded(price_change)
    if status == BundlePriceChange.STATUS_ACTIVE_APPLIED:
        apply_price_snapshot_to_bundle(
            price_change.bundle,
            {
                'fixed_cost_price': price_change.new_fixed_cost_price,
                'fixed_sale_price': price_change.new_fixed_sale_price,
                'fixed_commission_per_unit': price_change.new_fixed_commission_per_unit,
                'fixed_commission_percent': price_change.new_fixed_commission_percent,
            },
            updated_by=approver,
        )
    return price_change


@transaction.atomic
def activate_due_bundle_price_changes(bundle_ids: Iterable[int] | None = None, *, as_of_datetime=None) -> list[int]:
    as_of = as_of_datetime or timezone.now()
    queryset = (
        BundlePriceChange.objects
        .select_related('bundle')
        .filter(
            status=BundlePriceChange.STATUS_APPROVED_SCHEDULED,
            effective_at__isnull=False,
            effective_at__lte=as_of,
        )
        .order_by('bundle_id', 'effective_at', 'id')
    )
    if bundle_ids:
        queryset = queryset.filter(bundle_id__in=list(bundle_ids))
    due_changes = list(queryset)
    if not due_changes:
        return []

    changed_bundles: dict[int, BundlePriceChange] = {}
    updated_ids: list[int] = []
    for change in due_changes:
        change.status = BundlePriceChange.STATUS_ACTIVE_APPLIED
        change.applied_at = as_of
        updated_ids.append(change.id)
        changed_bundles[change.bundle_id] = change
    BundlePriceChange.objects.bulk_update(due_changes, ['status', 'applied_at', 'updated_at'])

    for latest_change in changed_bundles.values():
        apply_price_snapshot_to_bundle(
            latest_change.bundle,
            {
                'fixed_cost_price': latest_change.new_fixed_cost_price,
                'fixed_sale_price': latest_change.new_fixed_sale_price,
                'fixed_commission_per_unit': latest_change.new_fixed_commission_per_unit,
                'fixed_commission_percent': latest_change.new_fixed_commission_percent,
            },
            updated_by=latest_change.approved_by,
        )
    return updated_ids

