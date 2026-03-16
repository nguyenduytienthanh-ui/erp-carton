# pytest.ini - Pytest Configuration for ERP Framework

[pytest]
DJANGO_SETTINGS_MODULE = config.settings
python_files = tests.py test_*.py *_tests.py
python_classes = Test*
python_functions = test_*
testpaths = backend
addopts =
    --cov=backend
    --cov-report=html
    --cov-report=term-missing
    --cov-fail-under=70
    -v
    --tb=short
    --strict-markers

markers =
    slow: marks tests as slow
    integration: marks tests as integration tests
    unit: marks tests as unit tests
    api: marks tests as API tests
    workflow: marks tests as workflow tests

---

# conftest.py - Pytest Fixtures

import pytest
from django.test import Client
from rest_framework.test import APIClient
from django.contrib.auth.models import User

@pytest.fixture
def api_client():
    """Provide API client for tests"""
    return APIClient()

@pytest.fixture
def authenticated_client(api_client):
    """Provide authenticated API client"""
    user = User.objects.create_user(username='testuser', password='testpass123')
    api_client.force_authenticate(user=user)
    return api_client

@pytest.fixture
def test_user():
    """Create test user"""
    return User.objects.create_user(
        username='testuser',
        email='test@example.com',
        password='testpass123'
    )

---

# Test Suite Structure (Created in backend/tests/)

backend/tests/
├── __init__.py
├── conftest.py
├── unit/
│   ├── test_serializers.py         # Serializer unit tests
│   ├── test_models.py              # Model unit tests
│   ├── test_services.py            # Service unit tests
│   └── test_utils.py               # Utility function tests
├── integration/
│   ├── test_api_endpoints.py       # API endpoint integration tests
│   ├── test_workflows.py           # Workflow integration tests
│   └── test_database.py            # Database integration tests
├── api/
│   ├── test_sales_api.py           # Sales API tests
│   ├── test_purchasing_api.py      # Purchasing API tests
│   ├── test_inventory_api.py       # Inventory API tests
│   ├── test_finance_api.py         # Finance API tests
│   ├── test_production_api.py      # Production API tests
│   └── test_phase5_api.py          # Phase 5 features API tests
└── e2e/
    ├── test_sales_workflow.py      # End-to-end sales workflow
    ├── test_purchase_workflow.py   # End-to-end purchase workflow
    ├── test_finance_workflow.py    # End-to-end finance workflow
    └── test_production_workflow.py # End-to-end production workflow

---

# Test Statistics Target

Total Tests: 200+
Coverage Target: >85%
Test Types:
  - Unit Tests: 80 (40%)
  - Integration Tests: 60 (30%)
  - API Tests: 40 (20%)
  - E2E Tests: 20 (10%)

---

# GitHub Actions CI/CD Configuration
# .github/workflows/tests.yml

name: ERP Tests & CI/CD

on:
  push:
    branches: [ main, develop ]
  pull_request:
    branches: [ main, develop ]

jobs:
  test:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:15
        env:
          POSTGRES_DB: test_db
          POSTGRES_USER: test_user
          POSTGRES_PASSWORD: test_pass
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5
        ports:
          - 5432:5432

    steps:
    - uses: actions/checkout@v2
    
    - name: Set up Python
      uses: actions/setup-python@v2
      with:
        python-version: 3.10
    
    - name: Install dependencies
      run: |
        pip install -r backend/requirements.txt
        pip install pytest pytest-django pytest-cov
    
    - name: Run migrations
      run: cd backend && python manage.py migrate
    
    - name: Run tests with coverage
      run: |
        cd backend
        pytest tests/ --cov=. --cov-report=xml
    
    - name: Upload coverage
      uses: codecov/codecov-action@v2
      with:
        files: ./backend/coverage.xml

  lint:
    runs-on: ubuntu-latest
    steps:
    - uses: actions/checkout@v2
    - name: Set up Python
      uses: actions/setup-python@v2
      with:
        python-version: 3.10
    - name: Install linters
      run: |
        pip install flake8 black isort
    - name: Run linters
      run: |
        flake8 backend --count --select=E9,F63,F7,F82 --show-source --statistics
        black --check backend
        isort --check backend

  frontend-test:
    runs-on: ubuntu-latest
    steps:
    - uses: actions/checkout@v2
    - name: Set up Node
      uses: actions/setup-node@v2
      with:
        node-version: '18'
    - name: Install dependencies
      run: cd frontend && npm install
    - name: Run linter
      run: cd frontend && npm run lint
    - name: Build
      run: cd frontend && npm run build

---

# Performance Testing Setup
# k6_load_test.js - Using k6 for load testing

import http from 'k6/http';
import { check } from 'k6';

export let options = {
  vus: 10,
  duration: '30s',
  thresholds: {
    http_req_duration: ['p(95)<500', 'p(99)<1000'],
    http_req_failed: ['rate<0.1'],
  },
};

export default function () {
  // Test Sales API
  let res = http.get('http://localhost:8000/api/sales-orders/');
  check(res, {
    'Sales API status is 200': (r) => r.status === 200,
    'response time < 500ms': (r) => r.timings.duration < 500,
  });

  // Test Finance API
  res = http.get('http://localhost:8000/api/finance/general-ledger/');
  check(res, {
    'Finance API status is 200': (r) => r.status === 200,
  });
}

---

# Summary:
# - 200+ unit/integration/API tests
# - 85%+ code coverage target
# - Automated CI/CD with GitHub Actions
# - Performance testing with k6
# - Load testing capabilities
# - Complete test suite for all 65+ features
