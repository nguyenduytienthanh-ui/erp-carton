from core.signals import set_current_request


class ExportExcelMiddleware:
    """
    Gọi view xuất Excel trực tiếp khi path chứa 'export-excel'.
    """
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        path = getattr(request, 'path_info', '') or getattr(request, 'path', '') or ''
        # Debug: in path ra terminal khi có export-excel
        if 'export-excel' in path:
            from core.views import export_products_excel_plain_view
            return export_products_excel_plain_view(request)
        return self.get_response(request)


class CurrentRequestMiddleware:
    """Middleware to store current request in thread-local"""
    
    def __init__(self, get_response):
        self.get_response = get_response
    
    def __call__(self, request):
        set_current_request(request)
        response = self.get_response(request)
        return response
