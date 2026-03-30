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

$resolvedBackendBase = Resolve-BackendBase $BackendBase $ApiPublicUrl
$resolvedFrontendBase = Resolve-FrontendBase $FrontendBase $FrontendPublicUrl

Write-Host "=== ERP Carton Smoke Check ===" -ForegroundColor Cyan
Push-Location backend
python manage.py smoke_http --backend-base $resolvedBackendBase --frontend-base $resolvedFrontendBase --username $Username --password $Password
Pop-Location
