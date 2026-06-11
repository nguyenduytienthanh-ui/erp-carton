"""Local-only Django settings for safe backend regression tests.

This module intentionally does not import ``config.settings`` so test runs do
not need .env values and cannot inherit a real PostgreSQL target.
"""

from datetime import timedelta
from pathlib import Path


BASE_DIR = Path(__file__).resolve().parent.parent

SECRET_KEY = 'local-test-secret-key-for-backend-regression-gate'
DEBUG = False
APP_ENV = 'test'
IS_PRODUCTION = False
DEPLOYMENT_MODE = 'local-test'

ALLOWED_HOSTS = ['testserver', '127.0.0.1', 'localhost']

INSTALLED_APPS = [
    'django.contrib.admin',
    'django.contrib.auth',
    'django.contrib.contenttypes',
    'django.contrib.sessions',
    'django.contrib.messages',
    'django.contrib.staticfiles',
    'django.contrib.postgres',
    'rest_framework',
    'rest_framework_simplejwt.token_blacklist',
    'drf_spectacular',
    'django_filters',
    'corsheaders',
    'core.apps.CoreConfig',
    'products',
    'sales',
    'inventory.apps.InventoryConfig',
    'purchasing.apps.PurchasingConfig',
    'production.apps.ProductionConfig',
    'quality.apps.QualityConfig',
    'workforce.apps.WorkforceConfig',
    'finance.apps.FinanceConfig',
    'django_q',
]

MIDDLEWARE = [
    'django.middleware.security.SecurityMiddleware',
    'corsheaders.middleware.CorsMiddleware',
    'django.contrib.sessions.middleware.SessionMiddleware',
    'django.middleware.common.CommonMiddleware',
    'django.middleware.csrf.CsrfViewMiddleware',
    'django.contrib.auth.middleware.AuthenticationMiddleware',
    'django.contrib.messages.middleware.MessageMiddleware',
    'django.middleware.clickjacking.XFrameOptionsMiddleware',
    'core.middleware.RequestContextMiddleware',
]

ROOT_URLCONF = 'config.urls'

TEMPLATES = [
    {
        'BACKEND': 'django.template.backends.django.DjangoTemplates',
        'DIRS': [],
        'APP_DIRS': True,
        'OPTIONS': {
            'context_processors': [
                'django.template.context_processors.debug',
                'django.template.context_processors.request',
                'django.contrib.auth.context_processors.auth',
                'django.contrib.messages.context_processors.messages',
            ],
        },
    },
]

WSGI_APPLICATION = 'config.wsgi.application'
ASGI_APPLICATION = 'config.asgi.application'

DATABASES = {
    'default': {
        'ENGINE': 'django.db.backends.sqlite3',
        'NAME': ':memory:',
    }
}

AUTH_PASSWORD_VALIDATORS = []
PASSWORD_HASHERS = ['django.contrib.auth.hashers.MD5PasswordHasher']

LANGUAGE_CODE = 'en-us'
TIME_ZONE = 'UTC'
USE_I18N = True
USE_TZ = True

STATIC_URL = 'static/'
STATIC_ROOT = BASE_DIR / 'staticfiles-test'
MEDIA_URL = '/media/'
MEDIA_ROOT = BASE_DIR / 'media-test'
DEFAULT_AUTO_FIELD = 'django.db.models.BigAutoField'

CORS_ALLOWED_ORIGINS = [
    'http://localhost:5173',
    'http://localhost:5174',
    'http://127.0.0.1:5173',
    'http://127.0.0.1:5174',
]
CSRF_TRUSTED_ORIGINS = [
    'http://localhost:5173',
    'http://127.0.0.1:5173',
]
CORS_ALLOW_CREDENTIALS = True
SESSION_COOKIE_SECURE = False
CSRF_COOKIE_SECURE = False
SESSION_COOKIE_HTTPONLY = True
SESSION_COOKIE_SAMESITE = 'Lax'
CSRF_COOKIE_SAMESITE = 'Lax'
SECURE_SSL_REDIRECT = False
SECURE_CONTENT_TYPE_NOSNIFF = True
SECURE_HSTS_SECONDS = 0
SECURE_HSTS_INCLUDE_SUBDOMAINS = False
SECURE_HSTS_PRELOAD = False
X_FRAME_OPTIONS = 'DENY'
REFERRER_POLICY = 'same-origin'
SECURE_PROXY_SSL_HEADER = None
USE_X_FORWARDED_HOST = False

AUTH_USER_MODEL = 'core.User'
PERMISSION_STRICT_DEFAULT = False

REST_FRAMEWORK = {
    'DEFAULT_SCHEMA_CLASS': 'drf_spectacular.openapi.AutoSchema',
    'DEFAULT_AUTHENTICATION_CLASSES': [
        'core.authentication.SessionAwareJWTAuthentication',
        'rest_framework.authentication.SessionAuthentication',
        'rest_framework.authentication.BasicAuthentication',
    ],
    'DEFAULT_PERMISSION_CLASSES': [
        'rest_framework.permissions.IsAuthenticated',
    ],
    'DEFAULT_PAGINATION_CLASS': 'rest_framework.pagination.PageNumberPagination',
    'PAGE_SIZE': 20,
    'DEFAULT_FILTER_BACKENDS': [
        'django_filters.rest_framework.DjangoFilterBackend',
        'rest_framework.filters.SearchFilter',
        'rest_framework.filters.OrderingFilter',
    ],
}

SIMPLE_JWT = {
    'ACCESS_TOKEN_LIFETIME': timedelta(minutes=60),
    'REFRESH_TOKEN_LIFETIME': timedelta(days=7),
    'ROTATE_REFRESH_TOKENS': False,
    'BLACKLIST_AFTER_ROTATION': True,
    'UPDATE_LAST_LOGIN': False,
    'AUTH_HEADER_TYPES': ('Bearer',),
}

BACKUP_ROOT = BASE_DIR / 'backups-test'
BACKUP_RETENTION_DAYS = 7
BACKUP_STALE_HOURS = 168
BACKUP_CLOUD_SYNC_ENABLED = False
BACKUP_CLOUD_PROVIDER = ''
BACKUP_RCLONE_BINARY = 'rclone'
BACKUP_RCLONE_DESTINATION = ''
BACKUP_CLOUD_SYNC_STALE_HOURS = 168
AUDIT_LOG_RETENTION_DAYS = 90
AUDIT_EXPORT_MAX_ROWS = 5000
INCIDENT_RUNBOOK_URL = ''
INCIDENT_CONTACT_EMAILS = []
ALERT_EMAIL_RECIPIENTS = []
ALERT_SLACK_WEBHOOK_URL = ''
ALERT_TELEGRAM_BOT_TOKEN = ''
ALERT_TELEGRAM_CHAT_ID = ''
ALERT_REQUIRED_CHANNEL_COUNT = 0
ALERT_REQUIRED_CHANNELS = []
ALERT_HTTP_TIMEOUT_SECONDS = 10
DB_SLOW_QUERY_THRESHOLD_MS = 1500
LARGE_DATA_WARNING_ROWS = 1000
LARGE_DATA_CRITICAL_ROWS = 10000
API_PUBLIC_URL = ''
CLOUDFLARED_TUNNEL_ID = ''
CLOUDFLARED_CONFIG_PATH = ''
TUNNEL_PROVIDER = ''

FRONTEND_PUBLIC_URL = 'http://localhost:5173'
FRONTEND_URL = FRONTEND_PUBLIC_URL
DEFAULT_FROM_EMAIL = 'ERP Carton <noreply@localhost>'
SERVER_EMAIL = DEFAULT_FROM_EMAIL
EMAIL_BACKEND = 'django.core.mail.backends.locmem.EmailBackend'
EMAIL_TIMEOUT = 15
EMAIL_HOST = ''
EMAIL_PORT = 587
EMAIL_HOST_USER = ''
EMAIL_HOST_PASSWORD = ''
EMAIL_USE_TLS = False
EMAIL_USE_SSL = False

Q_CLUSTER = {
    'name': 'DjangORM',
    'workers': 1,
    'timeout': 90,
    'retry': 120,
    'queue_limit': 50,
    'bulk': 10,
    'orm': 'default',
    'save_limit': 50,
    'ack_failures': True,
    'sync': True,
}

class DisableMigrations:
    def __contains__(self, item):
        return True

    def __getitem__(self, item):
        return None


MIGRATION_MODULES = DisableMigrations()

LOGGING = {
    'version': 1,
    'disable_existing_loggers': False,
    'formatters': {
        'standard': {
            'format': '[%(asctime)s] %(levelname)s %(name)s [req:%(request_id)s]: %(message)s',
        },
    },
    'filters': {
        'request_id': {
            '()': 'core.middleware.RequestIdLogFilter',
        },
    },
    'handlers': {
        'console': {
            'class': 'logging.StreamHandler',
            'formatter': 'standard',
            'filters': ['request_id'],
        },
    },
    'root': {
        'handlers': ['console'],
        'level': 'WARNING',
    },
}

SENTRY_DSN = ''
