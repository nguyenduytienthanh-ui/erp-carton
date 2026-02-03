from .email_utils import send_notification_email

# Email notification task đã có trong email_utils.py
# Import để có thể queue:
# async_task('core.email_utils.send_notification_email', notification_id)


def async_export_customers(user_id, template_id, filters=None):
    """Background task: Export customers to Excel"""
    from django.contrib.auth import get_user_model
    from .models import ExportTemplate, Customer, Notification
    from .utils import export_to_excel
    from datetime import datetime
    import os
    from django.conf import settings

    User = get_user_model()

    try:
        user = User.objects.get(id=user_id)
        template = ExportTemplate.objects.get(id=template_id, entity_type='Customer')

        # Get customers
        queryset = Customer.objects.all()
        if filters:
            # Apply filters here if needed
            pass

        # Generate filename
        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
        filename = f'customers_export_{timestamp}.xlsx'
        filepath = os.path.join(settings.MEDIA_ROOT, 'exports', filename)

        # Create exports directory
        os.makedirs(os.path.dirname(filepath), exist_ok=True)

        # Export to file
        from openpyxl import Workbook
        wb = Workbook()
        ws = wb.active
        ws.append(template.headers)

        for customer in queryset:
            row = []
            for field in template.columns:
                value = getattr(customer, field, '')
                row.append(str(value) if value else '')
            ws.append(row)

        wb.save(filepath)

        # Create notification
        file_url = f'/media/exports/{filename}'
        Notification.objects.create(
            recipient=user,
            notification_type='system',
            title='Export completed',
            message=f'Customer export is ready for download: {filename}',
            entity_type='Export',
            entity_id=0
        )

        return f"Export completed: {filepath}"

    except Exception as e:
        # Notify error
        try:
            user = User.objects.get(id=user_id)
            Notification.objects.create(
                recipient=user,
                notification_type='system',
                title='Export failed',
                message=f'Error: {str(e)}'
            )
        except Exception:
            pass

        return f"Export failed: {str(e)}"

