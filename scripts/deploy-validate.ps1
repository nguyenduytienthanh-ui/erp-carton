param(
    [string]$BackendBase = "",
    [string]$FrontendBase = "http://127.0.0.1:5173",
    [string]$ApiPublicUrl = "",
    [string]$FrontendPublicUrl = "",
    [string]$Username = "uat_admin",
    [string]$Password = "Demo123!"
)

function Resolve-BackendBase([string]$ExplicitBase, [string]$ExplicitApiUrl) {
    if (-not [string]::IsNullOrWhiteSpace($ExplicitBase)) {
        return $ExplicitBase.TrimEnd('/')
    }
    $candidate = $ExplicitApiUrl
    if ([string]::IsNullOrWhiteSpace($candidate)) {
        $candidate = $env:API_PUBLIC_URL
    }
    if (-not [string]::IsNullOrWhiteSpace($candidate)) {
        $normalized = $candidate.TrimEnd('/')
        if ($normalized.EndsWith('/api/v1')) {
            return $normalized.Substring(0, $normalized.Length - 7)
        }
        if ($normalized.EndsWith('/api')) {
            return $normalized.Substring(0, $normalized.Length - 4)
        }
        return $normalized
    }
    return "http://127.0.0.1:8000"
}

function Resolve-ApiBase([string]$ExplicitApiUrl, [string]$ResolvedBackendBase) {
    if (-not [string]::IsNullOrWhiteSpace($ExplicitApiUrl)) {
        return $ExplicitApiUrl.TrimEnd('/')
    }
    if (-not [string]::IsNullOrWhiteSpace($env:API_PUBLIC_URL)) {
        return $env:API_PUBLIC_URL.TrimEnd('/')
    }
    return "$($ResolvedBackendBase.TrimEnd('/'))/api/v1"
}

function Resolve-FrontendBase([string]$ExplicitBase, [string]$ExplicitPublicUrl) {
    if (-not [string]::IsNullOrWhiteSpace($ExplicitPublicUrl)) {
        return $ExplicitPublicUrl.TrimEnd('/')
    }
    if (-not [string]::IsNullOrWhiteSpace($env:FRONTEND_PUBLIC_URL)) {
        return $env:FRONTEND_PUBLIC_URL.TrimEnd('/')
    }
    return $ExplicitBase.TrimEnd('/')
}

Set-Location "$PSScriptRoot\.."

Write-Host "=== ERP Carton Deploy Validate ===" -ForegroundColor Cyan

$resolvedBackendBase = Resolve-BackendBase $BackendBase $ApiPublicUrl
$resolvedApiBase = Resolve-ApiBase $ApiPublicUrl $resolvedBackendBase
$resolvedFrontendBase = Resolve-FrontendBase $FrontendBase $FrontendPublicUrl

Push-Location backend
python manage.py preflight_check --strict
if (-not $?) { Pop-Location; exit 1 }

python manage.py check
if (-not $?) { Pop-Location; exit 1 }

python manage.py release_readiness --strict --json
if (-not $?) { Pop-Location; exit 1 }

python manage.py smoke_http --backend-base $resolvedBackendBase --frontend-base $resolvedFrontendBase --username $Username --password $Password
if (-not $?) { Pop-Location; exit 1 }
Pop-Location

Push-Location frontend
$env:PLAYWRIGHT_BASE_URL = $resolvedFrontendBase
$env:PLAYWRIGHT_API_BASE_URL = $resolvedApiBase
npm run e2e:smoke
if (-not $?) { Pop-Location; exit 1 }
Pop-Location

Write-Host "Deploy validation completed successfully." -ForegroundColor Green
