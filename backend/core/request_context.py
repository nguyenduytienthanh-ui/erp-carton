import threading


_thread_locals = threading.local()


def get_current_request():
    return getattr(_thread_locals, 'request', None)


def set_current_request(request):
    _thread_locals.request = request


def clear_current_request():
    if hasattr(_thread_locals, 'request'):
        delattr(_thread_locals, 'request')


def get_current_request_id():
    request = get_current_request()
    return getattr(request, 'request_id', '-') if request is not None else '-'
