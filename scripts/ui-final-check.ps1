param(
    [string]$Scenario = "",
    [string]$Route = "",
    [string]$FrontendBase = "http://127.0.0.1:5173",
    [string]$ApiBaseUrl = "",
    [string]$Username = "uat_admin",
    [string]$Password = "Demo123!",
    [string]$WaitSelector = "main",
    [int]$SettleMs = 1200,
    [int]$ViewportWidth = 1440,
    [int]$ViewportHeight = 960,
    [switch]$IsMobile,
    [switch]$ForceFailure
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
$targetRoute = $Route.Trim()
$effectiveWaitSelector = $WaitSelector.Trim()
$uploadFilePath = ""
$selectTestId = ""
$selectOptionText = ""
$clickTestId = ""
$postClickWaitSelector = ""
$assertText = ""
$uiCheckMutex = [System.Threading.Mutex]::new($false, "Global\ERP-Carton-UiFinalCheck")
$hasUiCheckLock = $false

function Convert-LastJsonLine {
    param(
        [Parameter(Mandatory = $true)]
        [object]$RawText
    )

    $rawString = if ($RawText -is [System.Array]) {
        ($RawText | ForEach-Object { [string]$_ }) -join [Environment]::NewLine
    }
    else {
        [string]$RawText
    }

    $jsonLine = $rawString `
        -split "(`r`n|`n)" `
        | ForEach-Object { $_.Trim() } `
        | Where-Object { -not [string]::IsNullOrWhiteSpace($_) } `
        | Select-Object -Last 1

    if ([string]::IsNullOrWhiteSpace($jsonLine) -or -not $jsonLine.Trim().StartsWith('{')) {
        throw "Command did not return a trailing JSON payload."
    }

    return $jsonLine | ConvertFrom-Json
}

try {
    $hasUiCheckLock = $uiCheckMutex.WaitOne(0)
    if (-not $hasUiCheckLock) {
        throw "Another ui-final-check session is already running. Wait for it to close before starting a new one."
    }

    if (-not [string]::IsNullOrWhiteSpace($Scenario)) {
        switch ($Scenario.Trim()) {
            "task-calendar-demo" {
                Push-Location "$repoRoot\backend"
                try {
                    $payloadRaw = python manage.py bootstrap_task_calendar_demo --json --reset --username $Username --password $Password
                    if ($LASTEXITCODE -ne 0) {
                        throw "bootstrap_task_calendar_demo failed."
                    }
                    $payload = Convert-LastJsonLine -RawText $payloadRaw
                    $targetRoute = [string]$payload.route
                    $effectiveWaitSelector = '[data-testid="task-calendar-root"]'
                    Write-Host "Task calendar demo ready: user_id=$($payload.user_id), task_count=$($payload.task_count)" -ForegroundColor Cyan
                    Write-Host "Opening route: $targetRoute" -ForegroundColor Cyan
                }
                finally {
                    Pop-Location
                }
            }
            "task-ai-work-brief-demo" {
                Push-Location "$repoRoot\backend"
                try {
                    $payloadRaw = python manage.py bootstrap_ai_work_brief_demo --json --reset --username $Username --password $Password
                    if ($LASTEXITCODE -ne 0) {
                        throw "bootstrap_ai_work_brief_demo failed."
                    }
                    $payload = Convert-LastJsonLine -RawText $payloadRaw
                    $targetRoute = [string]$payload.route
                    $effectiveWaitSelector = '[data-testid="ai-work-brief-card"]'
                    Write-Host "AI work brief demo ready: product_id=$($payload.product_id), product_code=$($payload.product_code)" -ForegroundColor Cyan
                    Write-Host "Opening route: $targetRoute" -ForegroundColor Cyan
                }
                finally {
                    Pop-Location
                }
            }
            "workforce-center-demo" {
                Push-Location "$repoRoot\backend"
                try {
                    $payloadRaw = python manage.py bootstrap_workforce_demo --json --reset --username $Username --password $Password
                    if ($LASTEXITCODE -ne 0) {
                        throw "bootstrap_workforce_demo failed."
                    }
                    $payload = Convert-LastJsonLine -RawText $payloadRaw
                    $targetRoute = [string]$payload.route
                    $effectiveWaitSelector = '[data-testid="workforce-center-root"]'
                    Write-Host "Workforce center demo ready: employee_count=$($payload.employee_count), month=$($payload.month)" -ForegroundColor Cyan
                    Write-Host "Opening route: $targetRoute" -ForegroundColor Cyan
                }
                finally {
                    Pop-Location
                }
            }
            "production-planning-demo" {
                Push-Location "$repoRoot\backend"
                try {
                    $payloadRaw = python manage.py bootstrap_production_planning_demo --json --reset --username $Username --password $Password
                    if ($LASTEXITCODE -ne 0) {
                        throw "bootstrap_production_planning_demo failed."
                    }
                    $payload = Convert-LastJsonLine -RawText $payloadRaw
                    $targetRoute = [string]$payload.route
                    $effectiveWaitSelector = '[data-testid="production-planning-command-strip"]'
                    Write-Host "Production planning demo ready: order_code=$($payload.order_code), operation_id=$($payload.operation_id)" -ForegroundColor Cyan
                    Write-Host "Opening route: $targetRoute" -ForegroundColor Cyan
                }
                finally {
                    Pop-Location
                }
            }
            "quality-center-demo" {
                Push-Location "$repoRoot\backend"
                try {
                    $payloadRaw = python manage.py bootstrap_quality_center_demo --json --reset --username $Username --password $Password
                    if ($LASTEXITCODE -ne 0) {
                        throw "bootstrap_quality_center_demo failed."
                    }
                    $payload = Convert-LastJsonLine -RawText $payloadRaw
                    $targetRoute = [string]$payload.route
                    $effectiveWaitSelector = '[data-testid="quality-center-root"]'
                    Write-Host "Quality center demo ready: inspection_count=$($payload.inspection_count)" -ForegroundColor Cyan
                    Write-Host "Opening route: $targetRoute" -ForegroundColor Cyan
                }
                finally {
                    Pop-Location
                }
            }
            "maintenance-center-demo" {
                Push-Location "$repoRoot\backend"
                try {
                    $payloadRaw = python manage.py bootstrap_maintenance_center_demo --json --reset --username $Username --password $Password
                    if ($LASTEXITCODE -ne 0) {
                        throw "bootstrap_maintenance_center_demo failed."
                    }
                    $payload = Convert-LastJsonLine -RawText $payloadRaw
                    $targetRoute = [string]$payload.route
                    $effectiveWaitSelector = '[data-testid="maintenance-center-root"]'
                    Write-Host "Maintenance center demo ready: downtime_id=$($payload.downtime_id)" -ForegroundColor Cyan
                    Write-Host "Opening route: $targetRoute" -ForegroundColor Cyan
                }
                finally {
                    Pop-Location
                }
            }
            "paper-optimizer-demo" {
                Push-Location "$repoRoot\backend"
                try {
                    $payloadRaw = python manage.py bootstrap_paper_optimizer_demo --json --reset --scenario canonical --username $Username --password $Password
                    if ($LASTEXITCODE -ne 0) {
                        throw "bootstrap_paper_optimizer_demo failed."
                    }
                    $payload = Convert-LastJsonLine -RawText $payloadRaw
                    $targetRoute = [string]$payload.route
                    $effectiveWaitSelector = '[data-testid="paper-optimizer-root"]'
                    $assertText = [string]$payload.ui_assert_text
                    Write-Host "Paper optimizer demo ready: run_id=$($payload.run_id), final_group_count=$($payload.final_group_count)" -ForegroundColor Cyan
                    Write-Host "Opening route: $targetRoute" -ForegroundColor Cyan
                }
                finally {
                    Pop-Location
                }
            }
            "paper-optimizer-canonical" {
                Push-Location "$repoRoot\backend"
                try {
                    $payloadRaw = python manage.py bootstrap_paper_optimizer_demo --json --reset --scenario canonical --username $Username --password $Password
                    if ($LASTEXITCODE -ne 0) {
                        throw "bootstrap_paper_optimizer_demo failed."
                    }
                    $payload = Convert-LastJsonLine -RawText $payloadRaw
                    $targetRoute = [string]$payload.route
                    $effectiveWaitSelector = '[data-testid="paper-optimizer-root"]'
                    $assertText = [string]$payload.ui_assert_text
                    Write-Host "Paper optimizer demo ready: run_id=$($payload.run_id), final_group_count=$($payload.final_group_count)" -ForegroundColor Cyan
                    Write-Host "Opening route: $targetRoute" -ForegroundColor Cyan
                }
                finally {
                    Pop-Location
                }
            }
            "paper-optimizer-fresh-optimize" {
                Push-Location "$repoRoot\backend"
                try {
                    $payloadRaw = python manage.py bootstrap_paper_optimizer_demo --json --reset --scenario fresh-optimize --username $Username --password $Password
                    if ($LASTEXITCODE -ne 0) {
                        throw "bootstrap_paper_optimizer_demo failed."
                    }
                    $payload = Convert-LastJsonLine -RawText $payloadRaw
                    $targetRoute = [string]$payload.route
                    $effectiveWaitSelector = '[data-testid="paper-optimizer-root"]'
                    $clickTestId = 'paper-optimizer-generate'
                    $postClickWaitSelector = '[data-testid="paper-optimizer-result-ready"]'
                    $assertText = ''
                    Write-Host "Paper optimizer fresh optimize demo ready." -ForegroundColor Cyan
                    Write-Host "Opening route: $targetRoute" -ForegroundColor Cyan
                }
                finally {
                    Pop-Location
                }
            }
            "paper-optimizer-preview-warning" {
                Push-Location "$repoRoot\backend"
                try {
                    $payloadRaw = python manage.py bootstrap_paper_optimizer_demo --json --reset --scenario preview-warning --username $Username --password $Password
                    if ($LASTEXITCODE -ne 0) {
                        throw "bootstrap_paper_optimizer_demo failed."
                    }
                    $payload = Convert-LastJsonLine -RawText $payloadRaw
                    $targetRoute = [string]$payload.route
                    $effectiveWaitSelector = '[data-testid="paper-optimizer-root"]'
                    $uploadFilePath = [string]$payload.preview_fixture_path
                    $assertText = [string]$payload.ui_assert_text
                    Write-Host "Paper optimizer preview warning demo ready: file=$uploadFilePath" -ForegroundColor Cyan
                    Write-Host "Opening route: $targetRoute" -ForegroundColor Cyan
                }
                finally {
                    Pop-Location
                }
            }
            "paper-optimizer-failed" {
                Push-Location "$repoRoot\backend"
                try {
                    $payloadRaw = python manage.py bootstrap_paper_optimizer_demo --json --reset --scenario failed --username $Username --password $Password
                    if ($LASTEXITCODE -ne 0) {
                        throw "bootstrap_paper_optimizer_demo failed."
                    }
                    $payload = Convert-LastJsonLine -RawText $payloadRaw
                    $targetRoute = [string]$payload.route
                    $effectiveWaitSelector = '[data-testid="paper-optimizer-root"]'
                    $assertText = [string]$payload.ui_assert_text
                    Write-Host "Paper optimizer failed demo ready: run_id=$($payload.run_id)" -ForegroundColor Cyan
                    Write-Host "Opening route: $targetRoute" -ForegroundColor Cyan
                }
                finally {
                    Pop-Location
                }
            }
            "paper-optimizer-legacy-fallback" {
                Push-Location "$repoRoot\backend"
                try {
                    $payloadRaw = python manage.py bootstrap_paper_optimizer_demo --json --reset --scenario legacy-fallback --username $Username --password $Password
                    if ($LASTEXITCODE -ne 0) {
                        throw "bootstrap_paper_optimizer_demo failed."
                    }
                    $payload = Convert-LastJsonLine -RawText $payloadRaw
                    $targetRoute = [string]$payload.route
                    $effectiveWaitSelector = '[data-testid="paper-optimizer-root"]'
                    $assertText = [string]$payload.ui_assert_text
                    Write-Host "Paper optimizer legacy fallback demo ready: run_id=$($payload.run_id)" -ForegroundColor Cyan
                    Write-Host "Opening route: $targetRoute" -ForegroundColor Cyan
                }
                finally {
                    Pop-Location
                }
            }
            "paper-optimizer-no-feasible" {
                Push-Location "$repoRoot\backend"
                try {
                    $payloadRaw = python manage.py bootstrap_paper_optimizer_demo --json --reset --scenario no-feasible --username $Username --password $Password
                    if ($LASTEXITCODE -ne 0) {
                        throw "bootstrap_paper_optimizer_demo failed."
                    }
                    $payload = Convert-LastJsonLine -RawText $payloadRaw
                    $targetRoute = [string]$payload.route
                    $effectiveWaitSelector = '[data-testid="paper-optimizer-result-no-feasible"]'
                    $assertText = ''
                    Write-Host "Paper optimizer no-feasible demo ready: run_id=$($payload.run_id)" -ForegroundColor Cyan
                    Write-Host "Opening route: $targetRoute" -ForegroundColor Cyan
                }
                finally {
                    Pop-Location
                }
            }
            "paper-optimizer-legacy-no-feasible" {
                Push-Location "$repoRoot\backend"
                try {
                    $payloadRaw = python manage.py bootstrap_paper_optimizer_demo --json --reset --scenario legacy-no-feasible --username $Username --password $Password
                    if ($LASTEXITCODE -ne 0) {
                        throw "bootstrap_paper_optimizer_demo failed."
                    }
                    $payload = Convert-LastJsonLine -RawText $payloadRaw
                    $targetRoute = [string]$payload.route
                    $effectiveWaitSelector = '[data-testid="paper-optimizer-result-no-feasible"]'
                    $assertText = ''
                    Write-Host "Paper optimizer legacy no-feasible demo ready: run_id=$($payload.run_id)" -ForegroundColor Cyan
                    Write-Host "Opening route: $targetRoute" -ForegroundColor Cyan
                }
                finally {
                    Pop-Location
                }
            }
            "warehouse-mobile-demo" {
                Push-Location "$repoRoot\backend"
                try {
                    $payloadRaw = python manage.py bootstrap_warehouse_mobile_demo --json --reset --username $Username --password $Password
                    if ($LASTEXITCODE -ne 0) {
                        throw "bootstrap_warehouse_mobile_demo failed."
                    }
                    $payload = Convert-LastJsonLine -RawText $payloadRaw
                    $targetRoute = [string]$payload.route
                    $effectiveWaitSelector = '[data-testid="warehouse-mobile-root"]'
                    Write-Host "Warehouse mobile demo ready: stocktake_id=$($payload.stocktake_id)" -ForegroundColor Cyan
                    Write-Host "Opening route: $targetRoute" -ForegroundColor Cyan
                }
                finally {
                    Pop-Location
                }
            }
            "delivery-planning-demo" {
                Push-Location "$repoRoot\backend"
                try {
                    $payloadRaw = python manage.py bootstrap_delivery_planning_demo --json --reset --username $Username --password $Password
                    if ($LASTEXITCODE -ne 0) {
                        throw "bootstrap_delivery_planning_demo failed."
                    }
                    $payload = Convert-LastJsonLine -RawText $payloadRaw
                    $targetRoute = [string]$payload.route
                    $effectiveWaitSelector = '[data-testid="delivery-planning-root"]'
                    Write-Host "Delivery planning demo ready: order_code=$($payload.order_code), plan_count=$($payload.plan_count)" -ForegroundColor Cyan
                    Write-Host "Opening route: $targetRoute" -ForegroundColor Cyan
                }
                finally {
                    Pop-Location
                }
            }
            "delivery-carriers-demo" {
                Push-Location "$repoRoot\backend"
                try {
                    $payloadRaw = python manage.py bootstrap_delivery_planning_demo --json --reset --username $Username --password $Password
                    if ($LASTEXITCODE -ne 0) {
                        throw "bootstrap_delivery_planning_demo failed."
                    }
                    $payload = Convert-LastJsonLine -RawText $payloadRaw
                    $targetRoute = '/delivery-carriers'
                    $effectiveWaitSelector = '[data-testid="delivery-carriers-root"]'
                    Write-Host "Delivery carriers demo ready: route=$targetRoute" -ForegroundColor Cyan
                }
                finally {
                    Pop-Location
                }
            }
            "qr-shipment-demo" {
                Push-Location "$repoRoot\backend"
                try {
                    $payloadRaw = python manage.py bootstrap_qr_shipment_demo --json --reset --username $Username --password $Password
                    if ($LASTEXITCODE -ne 0) {
                        throw "bootstrap_qr_shipment_demo failed."
                    }
                    $payload = Convert-LastJsonLine -RawText $payloadRaw
                    $targetRoute = [string]$payload.scan_center_path
                    $effectiveWaitSelector = '[data-testid="scan-center-shipment-workspace"]'
                    Write-Host "QR shipment demo ready: order_id=$($payload.order_id), runtime_shipment_id=$($payload.runtime_shipment_id)" -ForegroundColor Cyan
                    Write-Host "Opening route: $targetRoute" -ForegroundColor Cyan
                }
                finally {
                    Pop-Location
                }
            }
            "qr-shipment-legacy" {
                Push-Location "$repoRoot\backend"
                try {
                    $payloadRaw = python manage.py bootstrap_qr_shipment_demo --json --reset --username $Username --password $Password
                    if ($LASTEXITCODE -ne 0) {
                        throw "bootstrap_qr_shipment_demo failed."
                    }
                    $payload = Convert-LastJsonLine -RawText $payloadRaw
                    $targetRoute = [string]$payload.legacy_shipments_path
                    if ([string]::IsNullOrWhiteSpace($targetRoute)) {
                        throw "bootstrap_qr_shipment_demo did not return legacy_shipments_path."
                    }
                    $effectiveWaitSelector = '[data-testid="shipments-search"]'
                    Write-Host "QR legacy bridge ready: order_id=$($payload.order_id), legacy_shipment_id=$($payload.legacy_shipment_id)" -ForegroundColor Cyan
                    Write-Host "Opening route: $targetRoute" -ForegroundColor Cyan
                }
                finally {
                    Pop-Location
                }
            }
            default {
                throw "Unsupported scenario '$Scenario'."
            }
        }
    }

    if ([string]::IsNullOrWhiteSpace($targetRoute)) {
        throw "Provide -Route or -Scenario."
    }

    Push-Location "$repoRoot\frontend"
    try {
        $nodeArgs = @(
            "scripts/ui-final-check.mjs",
            "--base-url", $FrontendBase.TrimEnd('/'),
            "--route", $targetRoute,
            "--api-base-url", $ApiBaseUrl.TrimEnd('/'),
            "--username", $Username,
            "--password", $Password,
            "--wait-selector", $effectiveWaitSelector,
            "--settle-ms", "$SettleMs",
            "--viewport-width", "$ViewportWidth",
            "--viewport-height", "$ViewportHeight",
            "--is-mobile", $(if ($IsMobile) { "true" } else { "false" })
        )
        if (-not [string]::IsNullOrWhiteSpace($uploadFilePath)) {
            $nodeArgs += @("--upload-file-path", $uploadFilePath)
        }
        if (-not [string]::IsNullOrWhiteSpace($selectTestId) -and -not [string]::IsNullOrWhiteSpace($selectOptionText)) {
            $nodeArgs += @("--select-testid", $selectTestId, "--select-option-text", $selectOptionText)
        }
        if (-not [string]::IsNullOrWhiteSpace($clickTestId)) {
            $nodeArgs += @("--click-testid", $clickTestId)
        }
        if (-not [string]::IsNullOrWhiteSpace($postClickWaitSelector)) {
            $nodeArgs += @("--post-click-wait-selector", $postClickWaitSelector)
        }
        if (-not [string]::IsNullOrWhiteSpace($assertText)) {
            $nodeArgs += @("--assert-text", $assertText)
        }
        if ($ForceFailure) {
            $nodeArgs += "--force-failure"
        }

        node @nodeArgs
        exit $LASTEXITCODE
    }
    finally {
        Pop-Location
    }
}
finally {
    if ($hasUiCheckLock) {
        $uiCheckMutex.ReleaseMutex() | Out-Null
    }
    $uiCheckMutex.Dispose()
}
