from datetime import timedelta
from decimal import Decimal

from rest_framework.test import APITestCase
from django.utils import timezone

from core.models import ApprovalHistory, AuditLog, Permission, Role, User
from finance.models import PayableDocument
from inventory.models import InventoryTransaction, Warehouse, WarehouseLocation
from products.models import Product, ProductUnit
from purchasing.models import (
    MaterialPurchasePrice,
    PurchaseOrder,
    PurchaseOrderLine,
    PurchaseReceipt,
    PurchaseRequest,
    PurchaseReturn,
    Supplier,
)
from sales.models import SalesOrder, SalesOrderLine


class SupplierApiTests(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            username='supplier_admin',
            password='Demo123!',
            is_staff=True,
            is_superuser=True,
        )
        self.client.force_authenticate(user=self.user)
        self.unit = ProductUnit.objects.create(code='SUP-UOM', name='Đơn vị NCC')
        self.product = Product.objects.create(
            code='SUP-PRODUCT-001',
            name='Vật tư test NCC',
            unit=self.unit,
            cost_price=10000,
            sale_price=15000,
            min_stock=5,
            status='ACTIVE',
            created_by=self.user,
            updated_by=self.user,
            owner=self.user,
        )

    def _create_supplier(self, code='SUP-001', **overrides):
        payload = {
            'code': code,
            'name': f'Nhà cung cấp {code}',
            'company_name': f'Công ty {code}',
            'tax_code': '',
            'phone': '0900000000',
            'email': 'supplier@example.com',
            'contact_person': 'Người liên hệ',
            'contact_phone': '0911111111',
            'payment_terms_days': 30,
            'rating': 3,
            'is_preferred': False,
            'is_active': True,
        }
        payload.update(overrides)
        return Supplier.objects.create(**payload)

    def test_supplier_create_normalizes_and_validates_existing_fields(self):
        response = self.client.post('/api/purchasing/suppliers/', {
            'code': ' sup-trim-001 ',
            'name': '  Nhà cung cấp Trim  ',
            'company_name': ' Công ty Trim ',
            'tax_code': ' MST-TRIM-001 ',
            'email': 'BUYER@EXAMPLE.COM ',
            'payment_terms_days': 45,
            'rating': 4,
        }, format='json')
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(response.data['code'], 'SUP-TRIM-001')
        self.assertEqual(response.data['name'], 'Nhà cung cấp Trim')
        self.assertEqual(response.data['company_name'], 'Công ty Trim')
        self.assertEqual(response.data['tax_code'], 'MST-TRIM-001')
        self.assertEqual(response.data['email'], 'buyer@example.com')

        invalid_response = self.client.post('/api/purchasing/suppliers/', {
            'code': 'SUP-INVALID-001',
            'name': 'Nhà cung cấp lỗi',
            'email': 'not-an-email',
            'payment_terms_days': -1,
            'rating': 6,
        }, format='json')
        self.assertEqual(invalid_response.status_code, 400, invalid_response.data)
        self.assertIn('email', invalid_response.data)
        self.assertIn('payment_terms_days', invalid_response.data)
        self.assertIn('rating', invalid_response.data)

    def test_supplier_duplicate_tax_code_is_rejected_without_db_unique_constraint(self):
        self._create_supplier(code='SUP-TAX-001', tax_code='MST-DUP-001')

        response = self.client.post('/api/purchasing/suppliers/', {
            'code': 'SUP-TAX-002',
            'name': 'Nhà cung cấp trùng MST',
            'tax_code': ' mst-dup-001 ',
        }, format='json')

        self.assertEqual(response.status_code, 400, response.data)
        self.assertIn('tax_code', response.data)

    def test_supplier_list_filters_search_and_soft_status_fields(self):
        active = self._create_supplier(code='SUP-FILTER-001', tax_code='MST-FILTER-001', is_preferred=True, rating=5)
        self._create_supplier(
            code='SUP-FILTER-002',
            name='Nhà cung cấp ngưng dùng',
            tax_code='',
            phone='',
            email='',
            contact_person='',
            contact_phone='',
            is_active=False,
            is_preferred=False,
            rating=2,
        )

        preferred_response = self.client.get('/api/purchasing/suppliers/?is_preferred=true')
        self.assertEqual(preferred_response.status_code, 200, preferred_response.data)
        self.assertEqual(preferred_response.data['count'], 1)
        self.assertEqual(preferred_response.data['results'][0]['id'], active.id)

        inactive_response = self.client.get('/api/purchasing/suppliers/?is_active=false')
        self.assertEqual(inactive_response.status_code, 200, inactive_response.data)
        self.assertEqual(inactive_response.data['count'], 1)
        self.assertFalse(inactive_response.data['results'][0]['is_active'])

        missing_profile_response = self.client.get('/api/purchasing/suppliers/?missing_profile=true')
        self.assertEqual(missing_profile_response.status_code, 200, missing_profile_response.data)
        self.assertEqual(missing_profile_response.data['count'], 1)
        self.assertEqual(missing_profile_response.data['results'][0]['code'], 'SUP-FILTER-002')

        search_response = self.client.get('/api/purchasing/suppliers/?q=MST-FILTER-001')
        self.assertEqual(search_response.status_code, 200, search_response.data)
        self.assertEqual(search_response.data['count'], 1)
        self.assertEqual(search_response.data['results'][0]['code'], 'SUP-FILTER-001')

    def test_supplier_delete_is_blocked_when_related_records_exist(self):
        supplier = self._create_supplier(code='SUP-REL-001')
        purchase_order = PurchaseOrder.objects.create(
            code='PO-SUP-REL-001',
            order_date=timezone.localdate(),
            supplier=supplier,
            created_by=self.user,
            updated_by=self.user,
            owner=self.user,
        )
        PurchaseReceipt.objects.create(
            code='GRN-SUP-REL-001',
            purchase_order=purchase_order,
            receipt_date=timezone.localdate(),
            created_by=self.user,
            updated_by=self.user,
            posted_by=self.user,
        )
        MaterialPurchasePrice.objects.create(
            product=self.product,
            supplier=supplier,
            unit_price=Decimal('12000'),
            currency='VND',
            uom='SUP-UOM',
            effective_from=timezone.localdate(),
            created_by=self.user,
            updated_by=self.user,
        )
        PurchaseReturn.objects.create(
            code='RET-SUP-REL-001',
            return_date=timezone.localdate(),
            supplier=supplier,
            return_reason='OTHER',
            created_by=self.user,
            updated_by=self.user,
        )
        PayableDocument.objects.create(
            code='AP-SUP-REL-001',
            supplier=supplier,
            document_date=timezone.localdate(),
            due_date=timezone.localdate(),
            total_amount=Decimal('100000'),
            created_by=self.user,
            updated_by=self.user,
        )

        response = self.client.delete(f'/api/purchasing/suppliers/{supplier.id}/')

        self.assertEqual(response.status_code, 400, response.data)
        self.assertIn('Không thể xóa nhà cung cấp đã phát sinh chứng từ', response.data['error'])
        self.assertIn('đơn mua', response.data['blockers'])
        self.assertIn('phiếu nhập mua', response.data['blockers'])
        self.assertIn('bảng giá mua', response.data['blockers'])
        self.assertIn('phiếu trả hàng', response.data['blockers'])
        self.assertIn('chứng từ phải trả', response.data['blockers'])
        self.assertTrue(Supplier.objects.filter(pk=supplier.id).exists())

    def test_supplier_delete_still_allows_unreferenced_supplier_in_disposable_test_db(self):
        supplier = self._create_supplier(code='SUP-FREE-001')

        response = self.client.delete(f'/api/purchasing/suppliers/{supplier.id}/')

        self.assertEqual(response.status_code, 204, response.data)
        self.assertFalse(Supplier.objects.filter(pk=supplier.id).exists())


class SupplierSecurityTests(APITestCase):
    def setUp(self):
        self.supplier = Supplier.objects.create(
            code='SUP-SEC-001',
            name='Nhà cung cấp security',
            company_name='Công ty security',
            payment_terms_days=30,
            rating=3,
            is_active=True,
        )

    def _make_user(self, username, actions):
        user = User.objects.create_user(username=username, password='Demo123!')
        role = Role.objects.create(code=f'{username.upper()}_ROLE', name=f'{username} role')
        for action in actions:
            permission, _ = Permission.objects.update_or_create(
                resource='SUPPLIER',
                action=action,
                defaults={
                    'code': f'SUPPLIER_{action}',
                    'name': f'{action.title()} suppliers',
                },
            )
            role.permissions.add(permission)
        user.roles.add(role)
        return user

    def test_supplier_api_requires_view_permission_for_read(self):
        user = self._make_user('supplier_security_none', [])
        self.client.force_authenticate(user=user)

        list_response = self.client.get('/api/purchasing/suppliers/')
        detail_response = self.client.get(f'/api/purchasing/suppliers/{self.supplier.id}/')

        self.assertEqual(list_response.status_code, 403, list_response.data)
        self.assertEqual(detail_response.status_code, 403, detail_response.data)

    def test_supplier_view_only_user_can_read_but_not_write(self):
        user = self._make_user('supplier_security_view', ['VIEW'])
        self.client.force_authenticate(user=user)

        list_response = self.client.get('/api/purchasing/suppliers/')
        detail_response = self.client.get(f'/api/purchasing/suppliers/{self.supplier.id}/')
        create_response = self.client.post('/api/purchasing/suppliers/', {
            'code': 'SUP-SEC-CREATE',
            'name': 'Không được tạo',
        }, format='json')
        update_response = self.client.patch(f'/api/purchasing/suppliers/{self.supplier.id}/', {
            'name': 'Không được sửa',
        }, format='json')
        delete_response = self.client.delete(f'/api/purchasing/suppliers/{self.supplier.id}/')

        self.assertEqual(list_response.status_code, 200, list_response.data)
        self.assertEqual(detail_response.status_code, 200, detail_response.data)
        self.assertEqual(create_response.status_code, 403, create_response.data)
        self.assertEqual(update_response.status_code, 403, update_response.data)
        self.assertEqual(delete_response.status_code, 403, delete_response.data)
        self.supplier.refresh_from_db()
        self.assertEqual(self.supplier.name, 'Nhà cung cấp security')

    def test_supplier_create_edit_and_delete_use_separate_permissions(self):
        editor = self._make_user('supplier_security_editor', ['VIEW', 'CREATE', 'EDIT'])
        self.client.force_authenticate(user=editor)

        create_response = self.client.post('/api/purchasing/suppliers/', {
            'code': 'SUP-SEC-NEW',
            'name': 'Nhà cung cấp mới',
            'payment_terms_days': 15,
        }, format='json')
        self.assertEqual(create_response.status_code, 201, create_response.data)
        created_id = create_response.data['id']

        update_response = self.client.patch(f'/api/purchasing/suppliers/{created_id}/', {
            'is_active': False,
        }, format='json')
        self.assertEqual(update_response.status_code, 200, update_response.data)
        self.assertFalse(update_response.data['is_active'])

        delete_without_permission = self.client.delete(f'/api/purchasing/suppliers/{created_id}/')
        self.assertEqual(delete_without_permission.status_code, 403, delete_without_permission.data)

        deleter = self._make_user('supplier_security_deleter', ['VIEW', 'DELETE'])
        self.client.force_authenticate(user=deleter)
        delete_response = self.client.delete(f'/api/purchasing/suppliers/{created_id}/')

        self.assertEqual(delete_response.status_code, 204, delete_response.data)
        self.assertFalse(Supplier.objects.filter(pk=created_id).exists())


class PurchasingWorkflowTests(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            username='purchasing_admin',
            password='Demo123!',
            is_staff=True,
            is_superuser=True,
        )
        self.client.force_authenticate(user=self.user)

        self.unit = ProductUnit.objects.create(code='CAI', name='Cái')
        self.product = Product.objects.create(
            code='SP-PO-001',
            name='Tấm carton test',
            unit=self.unit,
            cost_price=10000,
            sale_price=15000,
            min_stock=5,
            status='ACTIVE',
            created_by=self.user,
            updated_by=self.user,
            owner=self.user,
        )
        self.warehouse = Warehouse.objects.create(
            code='KHO-MUA',
            name='Kho mua hàng',
            created_by=self.user,
            updated_by=self.user,
        )
        self.location = WarehouseLocation.objects.create(
            warehouse=self.warehouse,
            code='A-01',
            name='Kệ A-01',
            created_by=self.user,
            updated_by=self.user,
        )
        supplier_response = self.client.post('/api/purchasing/suppliers/', {
            'code': 'NCC-001',
            'name': 'Nhà cung cấp A',
            'company_name': 'Công ty NCC A',
            'payment_terms_days': 15,
        }, format='json')
        self.assertEqual(supplier_response.status_code, 201)
        self.supplier_id = supplier_response.data['id']

    def _create_purchase_order(self, qty='10'):
        response = self.client.post('/api/purchasing/orders/', {
            'order_date': '2026-03-13',
            'expected_receipt_date': '2026-03-16',
            'supplier': self.supplier_id,
            'warehouse': self.warehouse.id,
            'location': self.location.id,
            'reference': 'PO-REF-001',
            'notes': 'Đơn mua test',
            'lines': [
                {
                    'line_number': 1,
                    'product': self.product.id,
                    'qty': qty,
                    'unit_price': '12000',
                    'discount_pct': '0',
                    'tax_pct': '8',
                    'note': 'Dòng test',
                }
            ],
        }, format='json')
        self.assertEqual(response.status_code, 201, response.data)
        return response.data

    def test_purchase_order_submit_approve_receive_creates_inventory(self):
        order = self._create_purchase_order()
        order_id = order['id']

        submit_response = self.client.post(f'/api/purchasing/orders/{order_id}/submit/', format='json')
        self.assertEqual(submit_response.status_code, 200, submit_response.data)
        self.assertEqual(submit_response.data['status'], 'SUBMITTED')

        approve_response = self.client.post(f'/api/purchasing/orders/{order_id}/approve/', format='json')
        self.assertEqual(approve_response.status_code, 200, approve_response.data)
        self.assertEqual(approve_response.data['status'], 'APPROVED')

        line = PurchaseOrderLine.objects.get(purchase_order_id=order_id, line_number=1)
        receive_response = self.client.post(
            f'/api/purchasing/orders/{order_id}/receive/',
            {
                'receipt_date': '2026-03-14',
                'warehouse': self.warehouse.id,
                'location': self.location.id,
                'reference': 'GRN-001',
                'items': [
                    {
                        'purchase_order_line': line.id,
                        'quantity': '10',
                        'unit_cost': '11800',
                        'note': 'Nhận đủ',
                    }
                ],
            },
            format='json',
        )
        self.assertEqual(receive_response.status_code, 201, receive_response.data)

        line.refresh_from_db()
        order_obj = PurchaseOrder.objects.get(pk=order_id)
        receipt = PurchaseReceipt.objects.get(pk=receive_response.data['id'])
        inventory_tx = InventoryTransaction.objects.get(purchase_receipt=receipt)

        self.assertEqual(str(line.received_qty), '10.0000')
        self.assertEqual(order_obj.status, 'RECEIVED')
        self.assertEqual(inventory_tx.transaction_type, 'RECEIPT')
        self.assertEqual(inventory_tx.purchase_order_id, order_id)
        self.assertEqual(inventory_tx.purchase_order_line_id, line.id)
        self.assertEqual(inventory_tx.purchase_receipt_id, receipt.id)

    def test_purchase_order_reject_edit_resubmit_and_receive_tracks_full_lifecycle(self):
        order = self._create_purchase_order(qty='8')
        order_id = order['id']

        draft_update = self.client.patch(
            f'/api/purchasing/orders/{order_id}/',
            {
                'version': order['version'],
                'notes': 'Cap nhat draft truoc khi gui duyet',
                'lines': [
                    {
                        'id': order['lines'][0]['id'],
                        'line_number': 1,
                        'product': self.product.id,
                        'qty': '9',
                        'unit_price': '12000',
                        'discount_pct': '0',
                        'tax_pct': '8',
                        'note': 'Cap nhat so luong draft',
                    }
                ],
            },
            format='json',
        )
        self.assertEqual(draft_update.status_code, 200, draft_update.data)

        self.client.post(f'/api/purchasing/orders/{order_id}/submit/', format='json')
        reject_response = self.client.post(
            f'/api/purchasing/orders/{order_id}/reject/',
            {'reason': 'Can bo sung du toan mua hang'},
            format='json',
        )
        self.assertEqual(reject_response.status_code, 200, reject_response.data)
        self.assertEqual(reject_response.data['status'], 'REJECTED')

        rejected_update = self.client.patch(
            f'/api/purchasing/orders/{order_id}/',
            {
                'version': PurchaseOrder.objects.get(pk=order_id).version,
                'notes': 'Da cap nhat sau khi bi tu choi',
                'lines': [
                    {
                        'id': draft_update.data['lines'][0]['id'],
                        'line_number': 1,
                        'product': self.product.id,
                        'qty': '10',
                        'unit_price': '12100',
                        'discount_pct': '0',
                        'tax_pct': '8',
                        'note': 'Bo sung du toan va don gia',
                    }
                ],
            },
            format='json',
        )
        self.assertEqual(rejected_update.status_code, 200, rejected_update.data)

        resubmit_response = self.client.post(f'/api/purchasing/orders/{order_id}/submit/', format='json')
        self.assertEqual(resubmit_response.status_code, 200, resubmit_response.data)
        approve_response = self.client.post(f'/api/purchasing/orders/{order_id}/approve/', format='json')
        self.assertEqual(approve_response.status_code, 200, approve_response.data)

        order_obj = PurchaseOrder.objects.get(pk=order_id)
        self.assertEqual(order_obj.status, 'APPROVED')
        self.assertEqual(order_obj.reject_reason, '')
        self.assertEqual(str(order_obj.lines.first().qty), '10.0000')

        next_states_response = self.client.get(f'/api/purchasing/orders/{order_id}/next_states/')
        self.assertEqual(next_states_response.status_code, 200, next_states_response.data)
        self.assertEqual(next_states_response.data['current'], 'APPROVED')
        self.assertIn('CANCELLED', next_states_response.data['next_states'])

        line = PurchaseOrderLine.objects.get(purchase_order_id=order_id, line_number=1)
        receive_response = self.client.post(
            f'/api/purchasing/orders/{order_id}/receive/',
            {
                'receipt_date': '2026-03-14',
                'warehouse': self.warehouse.id,
                'location': self.location.id,
                'reference': 'GRN-004',
                'items': [
                    {
                        'purchase_order_line': line.id,
                        'quantity': '10',
                        'unit_cost': '12100',
                        'note': 'Nhan sau khi resubmit',
                    }
                ],
            },
            format='json',
        )
        self.assertEqual(receive_response.status_code, 201, receive_response.data)
        history_actions = list(
            ApprovalHistory.objects
            .filter(entity_type='PurchaseOrder', entity_id=order_id)
            .order_by('created_at', 'id')
            .values_list('action', flat=True)
        )
        self.assertEqual(history_actions, ['SUBMIT', 'REJECT', 'SUBMIT', 'APPROVE'])
        self.assertTrue(AuditLog.objects.filter(entity_type='PurchaseOrder', entity_id=order_id, action='REJECT').exists())

    def test_cancel_purchase_receipt_rolls_back_order_receiving(self):
        order = self._create_purchase_order(qty='8')
        order_id = order['id']
        self.client.post(f'/api/purchasing/orders/{order_id}/submit/', format='json')
        self.client.post(f'/api/purchasing/orders/{order_id}/approve/', format='json')

        line = PurchaseOrderLine.objects.get(purchase_order_id=order_id, line_number=1)
        receive_response = self.client.post(
            f'/api/purchasing/orders/{order_id}/receive/',
            {
                'receipt_date': '2026-03-14',
                'warehouse': self.warehouse.id,
                'location': self.location.id,
                'reference': 'GRN-002',
                'items': [
                    {
                        'purchase_order_line': line.id,
                        'quantity': '3',
                        'unit_cost': '11800',
                    }
                ],
            },
            format='json',
        )
        self.assertEqual(receive_response.status_code, 201, receive_response.data)
        receipt_id = receive_response.data['id']

        cancel_response = self.client.post(
            f'/api/purchasing/receipts/{receipt_id}/cancel/',
            {'reason': 'Hủy phiếu nhập test'},
            format='json',
        )
        self.assertEqual(cancel_response.status_code, 200, cancel_response.data)
        self.assertEqual(cancel_response.data['status'], 'CANCELLED')

        line.refresh_from_db()
        order_obj = PurchaseOrder.objects.get(pk=order_id)
        receipt = PurchaseReceipt.objects.get(pk=receipt_id)
        inventory_tx = InventoryTransaction.objects.get(purchase_receipt=receipt)

        self.assertEqual(str(line.received_qty), '0.0000')
        self.assertEqual(order_obj.status, 'APPROVED')
        self.assertEqual(receipt.status, 'CANCELLED')
        self.assertEqual(inventory_tx.status, 'CANCELLED')

    def test_purchase_receipt_exposes_next_states_and_lifecycle_history(self):
        order = self._create_purchase_order(qty='5')
        order_id = order['id']
        self.client.post(f'/api/purchasing/orders/{order_id}/submit/', format='json')
        self.client.post(f'/api/purchasing/orders/{order_id}/approve/', format='json')

        line = PurchaseOrderLine.objects.get(purchase_order_id=order_id, line_number=1)
        receive_response = self.client.post(
            f'/api/purchasing/orders/{order_id}/receive/',
            {
                'receipt_date': '2026-03-14',
                'warehouse': self.warehouse.id,
                'location': self.location.id,
                'reference': 'GRN-003',
                'items': [
                    {
                        'purchase_order_line': line.id,
                        'quantity': '5',
                        'unit_cost': '11800',
                    }
                ],
            },
            format='json',
        )
        self.assertEqual(receive_response.status_code, 201, receive_response.data)
        receipt_id = receive_response.data['id']

        next_states_response = self.client.get(f'/api/purchasing/receipts/{receipt_id}/next_states/')
        self.assertEqual(next_states_response.status_code, 200, next_states_response.data)
        self.assertEqual(next_states_response.data['current'], 'POSTED')
        self.assertEqual(next_states_response.data['next_states'], ['CANCELLED'])

        history_response = self.client.get(f'/api/purchasing/receipts/{receipt_id}/lifecycle_history/')
        self.assertEqual(history_response.status_code, 200, history_response.data)
        self.assertEqual(history_response.data[0]['action'], 'RECEIVE')
        self.assertEqual(history_response.data[0]['action_label'], 'Đã ghi sổ')
        self.assertIn('Số lượng', history_response.data[0]['comments'])

        cancel_response = self.client.post(
            f'/api/purchasing/receipts/{receipt_id}/cancel/',
            {'reason': 'Huy doi soat nhap kho'},
            format='json',
        )
        self.assertEqual(cancel_response.status_code, 200, cancel_response.data)

        cancelled_states = self.client.get(f'/api/purchasing/receipts/{receipt_id}/next_states/')
        self.assertEqual(cancelled_states.status_code, 200, cancelled_states.data)
        self.assertEqual(cancelled_states.data['current'], 'CANCELLED')
        self.assertEqual(cancelled_states.data['next_states'], [])

        cancelled_history = self.client.get(f'/api/purchasing/receipts/{receipt_id}/lifecycle_history/')
        self.assertEqual(cancelled_history.status_code, 200, cancelled_history.data)
        self.assertEqual([item['action'] for item in cancelled_history.data[:2]], ['CANCEL', 'RECEIVE'])
        self.assertEqual(cancelled_history.data[0]['action_label'], 'Đã hủy')
        self.assertEqual(cancelled_history.data[0]['comments'], 'Huy doi soat nhap kho')

        audit_rows = AuditLog.objects.filter(entity_type='PurchaseReceipt', entity_id=receipt_id)
        self.assertEqual(audit_rows.count(), 2)

    def test_summary_endpoint_returns_procurement_counts(self):
        order = self._create_purchase_order(qty='6')
        order_id = order['id']
        order_obj = PurchaseOrder.objects.get(pk=order_id)
        order_obj.expected_receipt_date = timezone.localdate() - timedelta(days=1)
        order_obj.save(update_fields=['expected_receipt_date', 'updated_at'])
        self.client.post(f'/api/purchasing/orders/{order_id}/submit/', format='json')
        self.client.post(f'/api/purchasing/orders/{order_id}/approve/', format='json')

        response = self.client.get('/api/purchasing/orders/summary/')
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data['approved_count'], 1)
        self.assertEqual(response.data['waiting_receipt_count'], 1)
        self.assertEqual(response.data['overdue_receipt_count'], 1)

    def test_create_purchase_order_from_forecast_creates_real_po(self):
        MaterialPurchasePrice.objects.create(
            product=self.product,
            supplier_id=self.supplier_id,
            unit_price=Decimal('11500'),
            currency='VND',
            uom='CAI',
            effective_from=timezone.localdate() - timedelta(days=5),
            created_by=self.user,
            updated_by=self.user,
        )

        response = self.client.post(
            '/api/purchasing/forecast/create_po_from_forecast/',
            {
                'supplier': self.supplier_id,
                'warehouse': self.warehouse.id,
                'location': self.location.id,
                'order_date': timezone.localdate().isoformat(),
                'expected_receipt_date': (timezone.localdate() + timedelta(days=7)).isoformat(),
                'reference': 'FC-PO-001',
                'notes': 'Sinh tu forecast',
                'items': [
                    {
                        'product_id': self.product.id,
                        'qty': '12',
                        'urgency': 'HIGH',
                    }
                ],
            },
            format='json',
        )

        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(response.data['status'], 'DRAFT')
        self.assertEqual(response.data['supplier'], self.supplier_id)
        self.assertEqual(response.data['warehouse'], self.warehouse.id)
        self.assertEqual(response.data['location'], self.location.id)
        self.assertEqual(len(response.data['lines']), 1)
        self.assertEqual(response.data['lines'][0]['product'], self.product.id)
        self.assertEqual(str(response.data['lines'][0]['unit_price']), '11500.00')

        order = PurchaseOrder.objects.get(pk=response.data['id'])
        self.assertEqual(order.reference, 'FC-PO-001')
        self.assertEqual(order.lines.count(), 1)
        self.assertEqual(str(order.lines.first().qty), '12.0000')

    def test_inventory_forecast_endpoint_returns_operational_fields(self):
        sales_order = SalesOrder.objects.create(
            code='SO-FORECAST-001',
            doc_type='SO',
            order_date=timezone.localdate(),
            status='POSTED',
            currency='VND',
            exchange_rate=1,
            owner=self.user,
            created_by=self.user,
            updated_by=self.user,
        )
        SalesOrderLine.objects.create(
            sales_order=sales_order,
            line_number=1,
            product=self.product,
            internal_product_code=self.product.code,
            product_snapshot={'code': self.product.code, 'name': self.product.name},
            uom='CAI',
            qty='18',
            unit_price='15000',
            discount_pct='0',
            tax_pct='0',
            note='Demand for forecast',
        )
        sales_order.recalc_totals()

        response = self.client.get('/api/inventory/forecast/?months=3&lead_time=10')
        self.assertEqual(response.status_code, 200, response.data)
        self.assertTrue(len(response.data) >= 1)
        row = next(item for item in response.data if item['product_id'] == self.product.id)
        self.assertIn('avg_monthly_usage', row)
        self.assertIn('lead_time_days', row)
        self.assertIn('safety_stock', row)
        self.assertIn('status', row)
        self.assertIn('stockout_risk', row)

    def test_purchase_request_submit_approve_and_reject_flow(self):
        create_response = self.client.post('/api/purchasing/requests/', {
            'request_date': timezone.localdate().isoformat(),
            'reference': 'PR-REF-001',
            'notes': 'Yeu cau mua can duyet',
            'lines': [
                {
                    'line_number': 1,
                    'product': self.product.id,
                    'qty': '5',
                    'note': 'Dong mua test',
                }
            ],
        }, format='json')
        self.assertEqual(create_response.status_code, 201, create_response.data)
        request_id = create_response.data['id']

        submit_response = self.client.post(f'/api/purchasing/requests/{request_id}/submit/', format='json')
        self.assertEqual(submit_response.status_code, 200, submit_response.data)
        self.assertEqual(submit_response.data['status'], 'SUBMITTED')
        submit_audit = AuditLog.objects.filter(
            entity_type='PurchaseRequest',
            entity_code=create_response.data['code'],
            action='SUBMIT',
        )
        self.assertTrue(submit_audit.exists())

        approve_response = self.client.post(f'/api/purchasing/requests/{request_id}/approve/', format='json')
        self.assertEqual(approve_response.status_code, 200, approve_response.data)
        self.assertEqual(approve_response.data['status'], 'APPROVED')

        request_obj = PurchaseRequest.objects.get(pk=request_id)
        self.assertEqual(request_obj.status, 'APPROVED')
        self.assertEqual(request_obj.approved_by_id, self.user.id)
        self.assertIsNotNone(request_obj.approved_at)
        self.assertEqual(request_obj.lines.count(), 1)
        self.assertEqual(str(request_obj.lines.first().qty), '5.0000')
        self.assertEqual(
            ApprovalHistory.objects.filter(entity_type='PurchaseRequest', entity_id=request_id).count(),
            2,
        )
        history_response = self.client.get(f'/api/purchasing/requests/{request_id}/approval_history/')
        self.assertEqual(history_response.status_code, 200, history_response.data)
        self.assertEqual([item['action'] for item in history_response.data], ['APPROVE', 'SUBMIT'])
        self.assertEqual(history_response.data[0]['action_label'], 'Đã duyệt')
        approve_audit = AuditLog.objects.filter(
            entity_type='PurchaseRequest',
            entity_code=create_response.data['code'],
            action='APPROVE',
        )
        self.assertTrue(approve_audit.exists())

        reject_candidate = self.client.post('/api/purchasing/requests/', {
            'request_date': timezone.localdate().isoformat(),
            'reference': 'PR-REF-002',
            'notes': 'Yeu cau mua de tu choi',
        }, format='json')
        self.assertEqual(reject_candidate.status_code, 201, reject_candidate.data)
        reject_id = reject_candidate.data['id']

        self.client.post(f'/api/purchasing/requests/{reject_id}/submit/', format='json')
        reject_response = self.client.post(
            f'/api/purchasing/requests/{reject_id}/reject/',
            {'reason': 'Khong con nhu cau mua'},
            format='json',
        )
        self.assertEqual(reject_response.status_code, 200, reject_response.data)
        self.assertEqual(reject_response.data['status'], 'REJECTED')

        rejected_obj = PurchaseRequest.objects.get(pk=reject_id)
        self.assertEqual(rejected_obj.status, 'REJECTED')
        self.assertEqual(rejected_obj.reject_reason, 'Khong con nhu cau mua')
        self.assertEqual(rejected_obj.rejected_by_id, self.user.id)
        reject_history = ApprovalHistory.objects.filter(
            entity_type='PurchaseRequest',
            entity_id=reject_id,
        )
        self.assertEqual(reject_history.count(), 2)
        self.assertTrue(reject_history.filter(action='REJECT', comments='Khong con nhu cau mua').exists())
        reject_audit = AuditLog.objects.filter(
            entity_type='PurchaseRequest',
            entity_code=reject_candidate.data['code'],
            action='REJECT',
        )
        self.assertTrue(reject_audit.exists())

    def test_purchase_request_only_draft_can_be_edited_or_deleted(self):
        create_response = self.client.post('/api/purchasing/requests/', {
            'request_date': timezone.localdate().isoformat(),
            'reference': 'PR-LOCK-001',
            'notes': 'Yeu cau khoa sau khi submit',
        }, format='json')
        self.assertEqual(create_response.status_code, 201, create_response.data)
        request_id = create_response.data['id']

        submit_response = self.client.post(f'/api/purchasing/requests/{request_id}/submit/', format='json')
        self.assertEqual(submit_response.status_code, 200, submit_response.data)

        patch_response = self.client.patch(
            f'/api/purchasing/requests/{request_id}/',
            {'notes': 'Cap nhat sau khi submit'},
            format='json',
        )
        self.assertEqual(patch_response.status_code, 403, patch_response.data)

        delete_response = self.client.delete(f'/api/purchasing/requests/{request_id}/')
        self.assertEqual(delete_response.status_code, 403, delete_response.data)

    def test_purchase_return_create_submit_approve_exposes_history_and_next_states(self):
        create_response = self.client.post('/api/purchasing/returns/', {
            'return_date': timezone.localdate().isoformat(),
            'supplier': self.supplier_id,
            'reference': 'RET-REF-001',
            'return_reason': 'OTHER',
            'return_notes': 'Tra hang de kiem thu workflow',
            'lines': [
                {
                    'line_number': 1,
                    'product': self.product.id,
                    'qty': '2',
                    'unit_price': '12000',
                    'tax_pct': '0',
                    'note': 'Dong tra hang test',
                }
            ],
        }, format='json')
        self.assertEqual(create_response.status_code, 201, create_response.data)
        self.assertTrue(str(create_response.data['code']).startswith('RET-'))
        return_id = create_response.data['id']

        draft_next_states = self.client.get(f'/api/purchasing/returns/{return_id}/next_states/')
        self.assertEqual(draft_next_states.status_code, 200, draft_next_states.data)
        self.assertEqual(draft_next_states.data['current'], 'DRAFT')
        self.assertEqual(draft_next_states.data['next_states'], ['SUBMITTED', 'CANCELLED'])

        submit_response = self.client.post(f'/api/purchasing/returns/{return_id}/submit_return/', format='json')
        self.assertEqual(submit_response.status_code, 200, submit_response.data)
        self.assertEqual(submit_response.data['status'], 'SUBMITTED')

        approve_response = self.client.post(f'/api/purchasing/returns/{return_id}/approve_return/', format='json')
        self.assertEqual(approve_response.status_code, 200, approve_response.data)
        self.assertEqual(approve_response.data['status'], 'APPROVED')

        return_obj = PurchaseReturn.objects.get(pk=return_id)
        self.assertEqual(return_obj.status, 'APPROVED')
        self.assertEqual(return_obj.approved_by_id, self.user.id)
        self.assertIsNotNone(return_obj.approved_at)

        history_rows = ApprovalHistory.objects.filter(entity_type='PurchaseReturn', entity_id=return_id)
        self.assertEqual(history_rows.count(), 2)
        self.assertTrue(history_rows.filter(action='SUBMIT').exists())
        self.assertTrue(history_rows.filter(action='APPROVE').exists())

        history_response = self.client.get(f'/api/purchasing/returns/{return_id}/approval_history/')
        self.assertEqual(history_response.status_code, 200, history_response.data)
        self.assertEqual([item['action'] for item in history_response.data], ['APPROVE', 'SUBMIT'])
        self.assertEqual(history_response.data[0]['action_label'], 'Đã duyệt')

        approved_next_states = self.client.get(f'/api/purchasing/returns/{return_id}/next_states/')
        self.assertEqual(approved_next_states.status_code, 200, approved_next_states.data)
        self.assertEqual(approved_next_states.data['current'], 'APPROVED')
        self.assertEqual(approved_next_states.data['next_states'], ['POSTED', 'CANCELLED'])

    def test_purchase_return_exposes_lifecycle_history_without_duplicate_audit_rows(self):
        order = self._create_purchase_order(qty='6')
        order_id = order['id']

        self.client.post(f'/api/purchasing/orders/{order_id}/submit/', format='json')
        self.client.post(f'/api/purchasing/orders/{order_id}/approve/', format='json')

        line = PurchaseOrderLine.objects.get(purchase_order_id=order_id, line_number=1)
        receive_response = self.client.post(
            f'/api/purchasing/orders/{order_id}/receive/',
            {
                'receipt_date': '2026-03-14',
                'warehouse': self.warehouse.id,
                'location': self.location.id,
                'reference': 'GRN-RET-001',
                'items': [
                    {
                        'purchase_order_line': line.id,
                        'quantity': '6',
                        'unit_cost': '11800',
                    }
                ],
            },
            format='json',
        )
        self.assertEqual(receive_response.status_code, 201, receive_response.data)

        create_response = self.client.post('/api/purchasing/returns/', {
            'return_date': timezone.localdate().isoformat(),
            'supplier': self.supplier_id,
            'purchase_order': order_id,
            'reference': 'RET-LIFE-001',
            'return_reason': 'OTHER',
            'return_notes': 'Tra hang de test lifecycle',
            'lines': [
                {
                    'line_number': 1,
                    'product': self.product.id,
                    'qty': '2',
                    'unit_price': '11800',
                    'tax_pct': '0',
                }
            ],
        }, format='json')
        self.assertEqual(create_response.status_code, 201, create_response.data)
        return_id = create_response.data['id']

        self.client.post(f'/api/purchasing/returns/{return_id}/submit_return/', format='json')
        self.client.post(f'/api/purchasing/returns/{return_id}/approve_return/', format='json')

        post_response = self.client.post(f'/api/purchasing/returns/{return_id}/post_return/', format='json')
        self.assertEqual(post_response.status_code, 200, post_response.data)
        self.assertEqual(post_response.data['status'], 'POSTED')

        posted_states = self.client.get(f'/api/purchasing/returns/{return_id}/next_states/')
        self.assertEqual(posted_states.status_code, 200, posted_states.data)
        self.assertEqual(posted_states.data['current'], 'POSTED')
        self.assertEqual(posted_states.data['next_states'], [])

        history_response = self.client.get(f'/api/purchasing/returns/{return_id}/lifecycle_history/')
        self.assertEqual(history_response.status_code, 200, history_response.data)
        self.assertEqual([item['action'] for item in history_response.data], ['POST', 'APPROVE', 'SUBMIT'])
        self.assertEqual(history_response.data[0]['action_label'], 'Đã vào sổ')

        cancel_response = self.client.post(
            f'/api/purchasing/returns/{return_id}/cancel_return/',
            {'reason': 'Huy sau doi soat lifecycle'},
            format='json',
        )
        self.assertEqual(cancel_response.status_code, 200, cancel_response.data)
        self.assertEqual(cancel_response.data['status'], 'CANCELLED')

        cancelled_states = self.client.get(f'/api/purchasing/returns/{return_id}/next_states/')
        self.assertEqual(cancelled_states.status_code, 200, cancelled_states.data)
        self.assertEqual(cancelled_states.data['current'], 'CANCELLED')
        self.assertEqual(cancelled_states.data['next_states'], [])

        cancelled_history = self.client.get(f'/api/purchasing/returns/{return_id}/lifecycle_history/')
        self.assertEqual(cancelled_history.status_code, 200, cancelled_history.data)
        self.assertEqual([item['action'] for item in cancelled_history.data], ['CANCEL', 'POST', 'APPROVE', 'SUBMIT'])
        self.assertEqual(cancelled_history.data[0]['action_label'], 'Đã hủy')
        self.assertEqual(cancelled_history.data[0]['comments'], 'Huy sau doi soat lifecycle')

        audit_rows = AuditLog.objects.filter(entity_type='PurchaseReturn', entity_id=return_id)
        self.assertEqual(audit_rows.count(), 4)
