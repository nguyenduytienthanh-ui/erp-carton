param(
    [string]$BackendBase = "",
    [string]$FrontendBase = "http://127.0.0.1:5173",
    [string]$ApiPublicUrl = "",
    [string]$FrontendPublicUrl = "",
    [string]$Username = "",
    [string]$Password = "",
    [string]$UsernameEnv = "",
    [string]$PasswordEnv = ""
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
        if ($normalized.EndsWith('/api')) {
            return $normalized.Substring(0, $normalized.Length - 4)
        }
        if ($normalized -match '/api($|/)') {
            throw "ApiPublicUrl must use the unversioned /api contract."
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
    return "$($ResolvedBackendBase.TrimEnd('/'))/api"
}

function Assert-ApiBaseContract([string]$ApiBase) {
    if ([string]::IsNullOrWhiteSpace($ApiBase) -or -not $ApiBase.TrimEnd('/').EndsWith('/api')) {
        throw "API base URL must end with /api."
    }
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

function Resolve-SmokeCredentialArgs(
    [string]$RawUsername,
    [string]$RawPassword,
    [string]$UsernameEnvName,
    [string]$PasswordEnvName
) {
    if ([string]::IsNullOrWhiteSpace($RawUsername) -and [string]::IsNullOrWhiteSpace($UsernameEnvName)) {
        $UsernameEnvName = "E2E_ADMIN_USERNAME"
    }
    if ([string]::IsNullOrWhiteSpace($RawPassword) -and [string]::IsNullOrWhiteSpace($PasswordEnvName)) {
        $PasswordEnvName = "E2E_ADMIN_PASSWORD"
    }

    if (-not [string]::IsNullOrWhiteSpace($RawUsername) -and -not [string]::IsNullOrWhiteSpace($UsernameEnvName)) {
        throw "Use either -Username or -UsernameEnv, not both."
    }
    if (-not [string]::IsNullOrWhiteSpace($RawPassword) -and -not [string]::IsNullOrWhiteSpace($PasswordEnvName)) {
        throw "Use either -Password or -PasswordEnv, not both."
    }

    $credentialArgs = @()
    if (-not [string]::IsNullOrWhiteSpace($UsernameEnvName)) {
        $usernameValue = [Environment]::GetEnvironmentVariable($UsernameEnvName, "Process")
        if ([string]::IsNullOrWhiteSpace($usernameValue)) {
            throw "Missing required environment variable: $UsernameEnvName"
        }
        $credentialArgs += @("--username-env", $UsernameEnvName)
    } elseif (-not [string]::IsNullOrWhiteSpace($RawUsername)) {
        $credentialArgs += @("--username", $RawUsername)
    } else {
        throw "Provide -UsernameEnv or -Username."
    }

    if (-not [string]::IsNullOrWhiteSpace($PasswordEnvName)) {
        $passwordValue = [Environment]::GetEnvironmentVariable($PasswordEnvName, "Process")
        if ([string]::IsNullOrWhiteSpace($passwordValue)) {
            throw "Missing required environment variable: $PasswordEnvName"
        }
        $credentialArgs += @("--password-env", $PasswordEnvName)
    } elseif (-not [string]::IsNullOrWhiteSpace($RawPassword)) {
        $credentialArgs += @("--password", $RawPassword)
    } else {
        throw "Provide -PasswordEnv or -Password."
    }

    return $credentialArgs
}

Set-Location "$PSScriptRoot\.."

Write-Host "=== ERP Carton Deploy Validate ===" -ForegroundColor Cyan

$resolvedBackendBase = Resolve-BackendBase $BackendBase $ApiPublicUrl
$resolvedApiBase = Resolve-ApiBase $ApiPublicUrl $resolvedBackendBase
Assert-ApiBaseContract $resolvedApiBase
$resolvedFrontendBase = Resolve-FrontendBase $FrontendBase $FrontendPublicUrl
$credentialInput = @{
    RawUsername = $Username
    RawPassword = $Password
    UsernameEnvName = $UsernameEnv
    PasswordEnvName = $PasswordEnv
}
$credentialArgs = Resolve-SmokeCredentialArgs @credentialInput

Push-Location backend
python manage.py preflight_check --strict
if (-not $?) { Pop-Location; exit 1 }

python manage.py check
if (-not $?) { Pop-Location; exit 1 }

python manage.py release_readiness --strict --json
if (-not $?) { Pop-Location; exit 1 }

python manage.py smoke_http --backend-base $resolvedBackendBase --frontend-base $resolvedFrontendBase @credentialArgs
if (-not $?) { Pop-Location; exit 1 }
Pop-Location

Push-Location frontend
$env:PLAYWRIGHT_BASE_URL = $resolvedFrontendBase
$env:PLAYWRIGHT_API_BASE_URL = $resolvedApiBase
npm run e2e:smoke
if (-not $?) { Pop-Location; exit 1 }
Pop-Location

Write-Host "Deploy validation completed successfully." -ForegroundColor Green
