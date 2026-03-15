#!/usr/bin/env python3
import requests
import os
import json

# GitHub API configuration
GITHUB_TOKEN = os.getenv('GITHUB_TOKEN')
OWNER = 'nguyenduytienthanh-ui'
REPO = 'erp-carton'
BASE_BRANCH = 'main'
HEAD_BRANCH = 'sprint2-business-models'

if not GITHUB_TOKEN:
    print("ERROR: GITHUB_TOKEN environment variable not set")
    print("Please set: set GITHUB_TOKEN=your_token")
    exit(1)

# Read PR body from file
with open('PR_BODY.md', 'r', encoding='utf-8') as f:
    pr_body = f.read()

# Create PR
url = f'https://api.github.com/repos/{OWNER}/{REPO}/pulls'
headers = {
    'Authorization': f'token {GITHUB_TOKEN}',
    'Accept': 'application/vnd.github.v3+json',
    'Content-Type': 'application/json'
}

payload = {
    'title': 'Sprint 2: Complete 5 Critical Business Features (Pro ERP)',
    'body': pr_body,
    'head': HEAD_BRANCH,
    'base': BASE_BRANCH
}

print("Creating PR...")
response = requests.post(url, json=payload, headers=headers)

if response.status_code == 201:
    pr_data = response.json()
    print(f"✅ PR created successfully!")
    print(f"   PR #: {pr_data['number']}")
    print(f"   URL: {pr_data['html_url']}")
    print(f"   Status: {pr_data['state']}")
else:
    print(f"❌ Failed to create PR")
    print(f"   Status: {response.status_code}")
    print(f"   Response: {response.text}")
    exit(1)
