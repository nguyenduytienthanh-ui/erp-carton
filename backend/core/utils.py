import openpyxl
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill
from django.http import HttpResponse
from django.db import transaction
from django.db.models import Q
from datetime import datetime
from unidecode import unidecode
from django.contrib.postgres.search import TrigramSimilarity
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib import colors
from reportlab.lib.units import inch
from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph
from reportlab.lib.styles import getSampleStyleSheet
from io import BytesIO


def get_search_query(search_term, fields):
    """
    Tạo Q object để search cả có dấu và không dấu

    Ví dụ:
    - User gõ "thung" → Backend tìm cả "thung" và "thùng"
    - User gõ "thùng" → Backend tìm cả "thùng" và "thung"

    Args:
        search_term: Từ khóa (VD: "thung" hoặc "thùng")
        fields: List field cần search (VD: ['name', 'code'])

    Returns:
        Q object với OR conditions
    """
    if not search_term:
        return Q()

    search_original = search_term.strip()
    search_no_accent = unidecode(search_original)

    q_objects = Q()

    for field in fields:
        # Tìm theo từ gốc
        q_objects |= Q(**{f'{field}__icontains': search_original})

        # Nếu từ không dấu khác từ gốc, tìm thêm từ không dấu
        if search_no_accent.lower() != search_original.lower():
            q_objects |= Q(**{f'{field}__icontains': search_no_accent})

    return q_objects


def get_fuzzy_search_queryset(queryset, search_term, fields, similarity_threshold=0.3):
    """
    Fuzzy search với trigram similarity (PostgreSQL pg_trgm).

    Ví dụ:
    - Gõ "thu" → Tìm "thùng", "thung" (similarity > threshold)
    - Gõ "thung" → Tìm "thùng", "Thùng"
    - Gõ "cart" → Tìm "carton"

    Args:
        queryset: QuerySet cần filter
        search_term: Từ khóa
        fields: List fields cần search (VD: ['name', 'code'])
        similarity_threshold: Ngưỡng tương đồng (0.0-1.0)

    Returns:
        QuerySet đã filter
    """
    if not search_term:
        return queryset

    search_original = search_term.strip().lower()
    search_no_accent = unidecode(search_original)

    # Exact / unaccent match (icontains)
    q_exact = Q()
    for field in fields:
        q_exact |= Q(**{f'{field}__icontains': search_term.strip()})
        if search_no_accent != search_original:
            q_exact |= Q(**{f'{field}__icontains': search_no_accent})

    # Trigram similarity (cần annotate, không có lookup __trigram_similar)
    annotations = {}
    q_trigram = Q()
    for i, field in enumerate(fields):
        key_orig = f'_trg_{i}_o'
        key_noacc = f'_trg_{i}_n'
        annotations[key_orig] = TrigramSimilarity(field, search_original)
        annotations[key_noacc] = TrigramSimilarity(field, search_no_accent)
        q_trigram |= Q(**{f'{key_orig}__gt': similarity_threshold}) | Q(
            **{f'{key_noacc}__gt': similarity_threshold}
        )

    queryset = queryset.annotate(**annotations).filter(q_exact | q_trigram)
    return queryset.distinct()


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


def import_from_excel(file, model_class, field_mapping, user=None):
    """
    Import data from Excel file
    
    Args:
        file: Uploaded file object
        model_class: Django model class (e.g., Customer)
        field_mapping: Dict mapping Excel columns to model fields
                      {'Mã KH': 'code', 'Tên KH': 'name'}
        user: User performing import
    
    Returns:
        dict: {
            'total': int,
            'success': int, 
            'errors': [{'row': int, 'error': str}]
        }
    """
    from .models import ImportLog
    
    # Create import log
    import_log = ImportLog.objects.create(
        entity_type=model_class.__name__,
        filename=file.name,
        created_by=user,
        status='PROCESSING'
    )
    
    errors = []
    success_count = 0
    total_rows = 0
    
    try:
        # Load workbook
        wb = openpyxl.load_workbook(file)
        ws = wb.active
        
        # Get headers (first row)
        headers = []
        for cell in ws[1]:
            headers.append(cell.value)
        
        # Process data rows
        for row_num, row in enumerate(ws.iter_rows(min_row=2, values_only=True), start=2):
            total_rows += 1
            
            try:
                # Build data dict
                data = {}
                for col_num, value in enumerate(row):
                    if col_num < len(headers):
                        header = headers[col_num]
                        if header in field_mapping:
                            field_name = field_mapping[header]
                            data[field_name] = value
                
                # Skip empty rows
                if not any(data.values()):
                    continue
                
                # Create or update object
                with transaction.atomic():
                    # Try to find existing by code (if exists)
                    if 'code' in data and data['code']:
                        obj, created = model_class.objects.update_or_create(
                            code=data['code'],
                            defaults=data
                        )
                    else:
                        obj = model_class.objects.create(**data)
                    
                    success_count += 1
                    
            except Exception as e:
                errors.append({
                    'row': row_num,
                    'error': str(e)
                })
        
        # Update import log
        import_log.total_rows = total_rows
        import_log.success_count = success_count
        import_log.error_count = len(errors)
        import_log.errors = errors
        import_log.status = 'COMPLETED' if len(errors) == 0 else 'FAILED'
        import_log.save()
        
        return {
            'total': total_rows,
            'success': success_count,
            'errors': errors,
            'log_id': import_log.id
        }
        
    except Exception as e:
        import_log.status = 'FAILED'
        import_log.errors = [{'row': 0, 'error': str(e)}]
        import_log.save()
        raise
