# Purpose: Guided backend smoke-only runner for the owner.
# Does not deploy, migrate, restore, cleanup, backup, cloud sync, or run Playwright.
# Does not read .env or store credentials in files.
# Uses env-var credential path only and prints masked output for GPT Web review.

$ErrorActionPreference = "Stop"

function Write-Step([string]$Message) {
    Write-Host ""
    Write-Host $Message -ForegroundColor Cyan
}

function Get-GitValue([string[]]$Arguments) {
    $value = & git @Arguments 2>$null
    if ($LASTEXITCODE -ne 0) {
        throw "Git command failed: git $($Arguments -join ' ')"
    }
    return ($value | Out-String).Trim()
}

function Assert-CleanWorktree {
    $status = & git status --short
    if ($LASTEXITCODE -ne 0) {
        throw "Cannot read git status."
    }
    if ($status) {
        Write-Host "Worktree is not clean. Stop before smoke." -ForegroundColor Yellow
        $status | ForEach-Object { Write-Host $_ }
        throw "Git worktree is dirty."
    }
}

function Assert-SmokeUrl([string]$Name, [string]$Value) {
    if ([string]::IsNullOrWhiteSpace($Value)) {
        throw "$Name is MISSING"
    }
    if ($Value -match "__|<|>|PLACEHOLDER|UNKNOWN|FILL|REPLACE|DAN") {
        throw "$Name is still placeholder; refusing to run smoke."
    }
    if ($Value -notmatch "^https?://") {
        throw "$Name must start with http:// or https://"
    }
}

function Convert-SecureStringToPlainText([SecureString]$SecureValue) {
    if ($null -eq $SecureValue -or $SecureValue.Length -eq 0) {
        throw "E2E_ADMIN_PASSWORD is MISSING"
    }
    $localBstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($SecureValue)
    try {
        return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($localBstr)
    }
    finally {
        if ($localBstr -ne [IntPtr]::Zero) {
            [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($localBstr)
        }
    }
}

function Mask-SmokeText(
    [string[]]$Lines,
    [string]$FrontendPublicUrl,
    [string]$ApiPublicUrl,
    [string]$AdminUser,
    [string]$AdminSecret
) {
    $masked = ($Lines -join [Environment]::NewLine)
    if (-not [string]::IsNullOrEmpty($AdminSecret)) {
        $masked = $masked.Replace($AdminSecret, "***")
    }
    if (-not [string]::IsNullOrEmpty($AdminUser)) {
        $masked = $masked.Replace($AdminUser, "***")
    }
    if (-not [string]::IsNullOrEmpty($FrontendPublicUrl)) {
        $masked = $masked.Replace($FrontendPublicUrl, "<FRONTEND_PUBLIC_URL>")
    }
    if (-not [string]::IsNullOrEmpty($ApiPublicUrl)) {
        $masked = $masked.Replace($ApiPublicUrl, "<API_PUBLIC_URL>")
    }
    return $masked
}

function Remove-SmokeEnv {
    Remove-Item Env:\E2E_ADMIN_USERNAME -ErrorAction SilentlyContinue
    Remove-Item Env:\E2E_ADMIN_PASSWORD -ErrorAction SilentlyContinue
    Remove-Item Env:\ERP_SMOKE_FRONTEND_URL -ErrorAction SilentlyContinue
    Remove-Item Env:\ERP_SMOKE_API_URL -ErrorAction SilentlyContinue
}

Write-Host "=== OPS GATE: Backend Smoke-Only Guided Runner ===" -ForegroundColor Cyan
Write-Host "Scope: backend HTTP smoke only. No deploy, migration, restore, cleanup, backup, cloud sync, or Playwright."

$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Resolve-Path (Join-Path $scriptRoot "..")
Set-Location $repoRoot

$branch = ""
$head = ""
$smokeExitCode = 1
$maskedOutput = ""
$postGitStatus = ""
$secureInput = $null
$adminSecret = ""
$statusLabel = "VANG"
$frontendUrlStatus = "MISSING"
$apiUrlStatus = "MISSING"
$adminUserStatus = "MISSING"
$adminSecretStatus = "MISSING"
$smokeExecuted = "NO"

try {
    Write-Step "1. Git safety"
    $branch = Get-GitValue @("branch", "--show-current")
    $head = Get-GitValue @("rev-parse", "--short", "HEAD")
    Write-Host "Branch: $branch"
    Write-Host "HEAD: $head"
    Assert-CleanWorktree
    Write-Host "Git status: clean"

    Write-Step "2. Inputs"
    $frontendPublicUrl = Read-Host "FRONTEND_PUBLIC_URL"
    $apiPublicUrl = Read-Host "API_PUBLIC_URL"
    Assert-SmokeUrl "FRONTEND_PUBLIC_URL" $frontendPublicUrl
    Assert-SmokeUrl "API_PUBLIC_URL" $apiPublicUrl
    $frontendUrlStatus = "PRESENT"
    $apiUrlStatus = "PRESENT"

    $adminUser = Read-Host "E2E admin username"
    if ([string]::IsNullOrWhiteSpace($adminUser)) {
        throw "E2E_ADMIN_USERNAME is MISSING"
    }
    $adminUserStatus = "PRESENT"
    $secureInput = Read-Host "E2E admin password" -AsSecureString
    $adminSecret = Convert-SecureStringToPlainText $secureInput
    if ([string]::IsNullOrWhiteSpace($adminSecret)) {
        throw "E2E_ADMIN_PASSWORD is MISSING"
    }
    $adminSecretStatus = "PRESENT"

    Write-Step "3. Temporary env"
    $env:E2E_ADMIN_USERNAME = $adminUser
    $env:E2E_ADMIN_PASSWORD = $adminSecret
    $env:ERP_SMOKE_FRONTEND_URL = $frontendPublicUrl
    $env:ERP_SMOKE_API_URL = $apiPublicUrl
    Write-Host "Input status: FRONTEND_PUBLIC_URL=PRESENT, API_PUBLIC_URL=PRESENT"
    Write-Host "Credential env presence: E2E_ADMIN_USERNAME=PRESENT, E2E_ADMIN_PASSWORD=PRESENT"

    Write-Step "4. Backend HTTP smoke"
    $smokeScript = Join-Path $repoRoot "scripts\smoke-check.ps1"
    $smokeExecuted = "YES"
    $rawOutput = & $smokeScript `
        -ApiPublicUrl $apiPublicUrl `
        -FrontendPublicUrl $frontendPublicUrl `
        -UsernameEnv "E2E_ADMIN_USERNAME" `
        -PasswordEnv "E2E_ADMIN_PASSWORD" 2>&1 | ForEach-Object { $_.ToString() }
    if ($null -ne $LASTEXITCODE) {
        $smokeExitCode = [int]$LASTEXITCODE
    }
    else {
        $smokeExitCode = 0
    }
    $maskedOutput = Mask-SmokeText $rawOutput $frontendPublicUrl $apiPublicUrl $adminUser $adminSecret
}
catch {
    $rawOutput = @($_.Exception.Message)
    $maskedOutput = Mask-SmokeText $rawOutput $frontendPublicUrl $apiPublicUrl $adminUser $adminSecret
    $smokeExitCode = 1
}
finally {
    Remove-SmokeEnv
    if ($null -ne $secureInput) {
        $secureInput.Dispose()
    }
    Remove-Variable secureInput,adminSecret,adminUser -ErrorAction SilentlyContinue
}

if ($smokeExitCode -eq 0) {
    $statusLabel = "XANH"
}

Write-Step "5. Post-run git status"
$postGitStatus = & git status --short
if ($LASTEXITCODE -ne 0) {
    $postGitStatus = "git status failed"
}
$postGitBranch = & git status --branch --short

Write-Host ""
Write-Host "=== SMOKE OUTPUT MASKED START ==="
if ([string]::IsNullOrWhiteSpace($maskedOutput)) {
    Write-Host "<no smoke output>"
}
else {
    Write-Host $maskedOutput
}
Write-Host "=== SMOKE OUTPUT MASKED END ==="

Write-Host ""
Write-Host "=== GPT COPY REPORT START ==="
Write-Host "KET QUA HIEN TAI: $statusLabel"
Write-Host "MOC: Ops Real Release Dry-Run Gate v1"
Write-Host "GOI: Local guided backend smoke-only runner"
Write-Host "BRANCH: $branch"
Write-Host "HEAD: $head"
Write-Host "FRONTEND_PUBLIC_URL: $frontendUrlStatus"
Write-Host "API_PUBLIC_URL: $apiUrlStatus"
Write-Host "E2E_ADMIN_USERNAME: $adminUserStatus"
Write-Host "E2E_ADMIN_PASSWORD: $adminSecretStatus"
Write-Host "BACKEND_HTTP_SMOKE_EXECUTED: $smokeExecuted"
Write-Host "SMOKE_EXIT_CODE: $smokeExitCode"
Write-Host "DEPLOY: NOT RUN"
Write-Host "MIGRATION: NOT RUN"
Write-Host "RESTORE: NOT RUN"
Write-Host "CLEANUP: NOT RUN"
Write-Host "BACKUP: NOT RUN"
Write-Host "CLOUD_SYNC: NOT RUN"
Write-Host "PLAYWRIGHT: NOT RUN"
Write-Host "COMMIT_PUSH_TAG: NOT RUN"
Write-Host "SECRET_VALUES_PRINTED: NO, output masked by wrapper"
Write-Host "QC_PRINTING_TOUCHED: NO"
if ($postGitStatus) {
    Write-Host "POST_RUN_GIT_STATUS: NOT CLEAN"
    $postGitStatus | ForEach-Object { Write-Host "POST_RUN_GIT_DETAIL: $_" }
}
else {
    Write-Host "POST_RUN_GIT_STATUS: CLEAN"
}
$postGitBranch | ForEach-Object { Write-Host "POST_RUN_GIT_BRANCH: $_" }
Write-Host "NEXT_STEP: paste this report plus masked smoke output back to GPT Web"
Write-Host "=== GPT COPY REPORT END ==="

exit $smokeExitCode
