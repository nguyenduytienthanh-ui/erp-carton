from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill
from django.http import HttpResponse
from datetime import datetime

def export_to_excel(queryset, fields, headers, filename):
    """
    Export queryset to Excel file
    
    Args:
        queryset: Django queryset
        fields: List of field names ['code', 'name', 'phone']
        headers: List of header names ['Mã', 'Tên', 'SĐT']
        filename: Output filename
    """
    # Create workbook
    wb = Workbook()
    ws = wb.active
    ws.title = "Data"
    
    # Header style
    header_fill = PatternFill(start_color="366092", end_color="366092", fill_type="solid")
    header_font = Font(color="FFFFFF", bold=True)
    
    # Write headers
    for col_num, header in enumerate(headers, 1):
        cell = ws.cell(row=1, column=col_num, value=header)
        cell.fill = header_fill
        cell.font = header_font
    
    # Write data
    for row_num, obj in enumerate(queryset, 2):
        for col_num, field in enumerate(fields, 1):
            # Get field value (support nested fields like 'customer__name')
            value = obj
            for part in field.split('__'):
                value = getattr(value, part, '')
                if value is None:
                    value = ''
            
            # Format datetime
            if isinstance(value, datetime):
                value = value.strftime('%Y-%m-%d %H:%M:%S')
            
            ws.cell(row=row_num, column=col_num, value=str(value))
    
    # Auto-size columns
    for column in ws.columns:
        max_length = 0
        column_letter = column[0].column_letter
        for cell in column:
            try:
                if len(str(cell.value)) > max_length:
                    max_length = len(str(cell.value))
            except:
                pass
        adjusted_width = min(max_length + 2, 50)
        ws.column_dimensions[column_letter].width = adjusted_width
    
    # Create response
    response = HttpResponse(
        content_type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    )
    response['Content-Disposition'] = f'attachment; filename="{filename}"'
    wb.save(response)
    return response
