from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill
from django.http import HttpResponse
from datetime import datetime
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib import colors
from reportlab.lib.units import inch
from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph
from reportlab.lib.styles import getSampleStyleSheet
from io import BytesIO

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


def export_to_pdf(queryset, fields, headers, filename, title="Report"):
    """
    Export queryset to PDF
    
    Args:
        queryset: Django queryset
        fields: List of field names
        headers: List of header names
        filename: Output filename
        title: PDF title
    """
    # Create PDF in memory
    buffer = BytesIO()
    
    # Create document (landscape for more columns)
    doc = SimpleDocTemplate(
        buffer,
        pagesize=landscape(A4),
        rightMargin=30,
        leftMargin=30,
        topMargin=30,
        bottomMargin=18,
    )
    
    # Container for PDF elements
    elements = []
    
    # Add title
    styles = getSampleStyleSheet()
    title_para = Paragraph(f"<b>{title}</b>", styles['Title'])
    elements.append(title_para)
    elements.append(Paragraph("<br/><br/>", styles['Normal']))
    
    # Prepare table data
    data = [headers]  # Header row
    
    for obj in queryset:
        row = []
        for field in fields:
            # Get field value (support nested fields)
            value = obj
            for part in field.split('__'):
                value = getattr(value, part, '')
                if value is None:
                    value = ''
            
            # Format datetime
            if isinstance(value, datetime):
                value = value.strftime('%Y-%m-%d %H:%M')
            
            # Limit text length
            text = str(value)
            if len(text) > 50:
                text = text[:47] + '...'
            
            row.append(text)
        data.append(row)
    
    # Create table
    table = Table(data)
    
    # Style table
    table.setStyle(TableStyle([
        # Header
        ('BACKGROUND', (0, 0), (-1, 0), colors.grey),
        ('TEXTCOLOR', (0, 0), (-1, 0), colors.whitesmoke),
        ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
        ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
        ('FONTSIZE', (0, 0), (-1, 0), 10),
        ('BOTTOMPADDING', (0, 0), (-1, 0), 12),
        
        # Body
        ('BACKGROUND', (0, 1), (-1, -1), colors.beige),
        ('TEXTCOLOR', (0, 1), (-1, -1), colors.black),
        ('FONTNAME', (0, 1), (-1, -1), 'Helvetica'),
        ('FONTSIZE', (0, 1), (-1, -1), 8),
        ('ALIGN', (0, 0), (-1, -1), 'LEFT'),
        ('GRID', (0, 0), (-1, -1), 1, colors.black),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
    ]))
    
    elements.append(table)
    
    # Build PDF
    doc.build(elements)
    
    # Get PDF value
    pdf_value = buffer.getvalue()
    buffer.close()
    
    # Create response
    response = HttpResponse(content_type='application/pdf')
    response['Content-Disposition'] = f'attachment; filename="{filename}"'
    response.write(pdf_value)
    
    return response
