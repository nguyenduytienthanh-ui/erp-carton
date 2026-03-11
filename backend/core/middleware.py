import uuid

from core.request_context import clear_current_request, get_current_request_id, set_current_request


class RequestIdLogFilter:
    def filter(self, record):
        record.request_id = get_current_request_id()
        return True


class RequestContextMiddleware:
    """Attach request_id and current request for tracing/audit logging."""

    HEADER_NAME = 'X-Request-ID'

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        incoming_request_id = str(request.headers.get(self.HEADER_NAME, '')).strip()
        request.request_id = incoming_request_id or str(uuid.uuid4())
        set_current_request(request)
        try:
            response = self.get_response(request)
        finally:
            clear_current_request()
        response[self.HEADER_NAME] = request.request_id
        return response


CurrentRequestMiddleware = RequestContextMiddleware
