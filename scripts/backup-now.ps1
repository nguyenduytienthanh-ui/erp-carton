param(
    [string]$Output = "",
    [switch]$SkipCloudSync
)

Set-Location "$PSScriptRoot\.."

$timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
Write-Host "=== ERP Carton Backup Cycle ($timestamp) ===" -ForegroundColor Cyan

$commandArgs = @("manage.py", "backup_cycle", "--json")
if (-not [string]::IsNullOrWhiteSpace($Output)) {
    $commandArgs += "--output=$Output"
}
if ($SkipCloudSync) {
    $commandArgs += "--skip-cloud-sync"
}

Push-Location backend
python @commandArgs
Pop-Location
