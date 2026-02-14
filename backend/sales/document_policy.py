"""
Money policy & document rules (chốt rule và implement).
- Rounding: 2 decimal places cho tiền.
- Thứ tự tính: line subtotal → discount (trên dòng) → tax (trên dòng) → line_total.
  Header: subtotal = sum(line_total); discount_total, tax_total (mức header nếu có); total = subtotal - discount_total + tax_total.
"""
from decimal import Decimal, ROUND_HALF_UP

MONEY_DECIMALS = 2
QTY_DECIMALS = 4


def round_money(value):
    """Làm tròn tiền theo MONEY_DECIMALS, HALF_UP."""
    if value is None:
        return Decimal('0')
    d = Decimal(str(value))
    return d.quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)


def round_qty(value):
    """Làm tròn số lượng theo QTY_DECIMALS."""
    if value is None:
        return Decimal('0')
    d = Decimal(str(value))
    return d.quantize(Decimal('0.0001'), rounding=ROUND_HALF_UP)


def calc_line_totals(qty, unit_price, discount_pct=0, tax_pct=0):
    """
    Thứ tự: subtotal = qty * unit_price → discount_amount → after_discount → tax_amount → line_total.
    Returns (line_subtotal, discount_amount, tax_amount, line_total).
    """
    qty = Decimal(str(qty or 0))
    unit_price = round_money(unit_price or 0)
    discount_pct = Decimal(str(discount_pct or 0))
    tax_pct = Decimal(str(tax_pct or 0))
    line_subtotal = round_money(qty * unit_price)
    discount_amount = round_money(line_subtotal * discount_pct / 100)
    after_discount = round_money(line_subtotal - discount_amount)
    tax_amount = round_money(after_discount * tax_pct / 100)
    line_total = round_money(after_discount + tax_amount)
    return line_subtotal, discount_amount, tax_amount, line_total
