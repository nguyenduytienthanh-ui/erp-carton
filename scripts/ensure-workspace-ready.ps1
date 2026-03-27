function Get-RepoRoot {
    return (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
}

function Get-AlternateBackendEnvPath {
    param(
        [string]$RepoRoot
    )

    $worktreeLines = git worktree list --porcelain 2>$null
    if (-not $worktreeLines) {
        return $null
    }

    foreach ($line in $worktreeLines) {
        if (-not $line.StartsWith("worktree ")) {
            continue
        }

        $worktreePath = $line.Substring(9).Trim()
        if (-not $worktreePath) {
            continue
        }

        try {
            $resolvedWorktree = (Resolve-Path $worktreePath -ErrorAction Stop).Path
        } catch {
            continue
        }

        if ($resolvedWorktree -eq $RepoRoot) {
            continue
        }

        $candidate = Join-Path $resolvedWorktree "backend/.env"
        if (Test-Path $candidate) {
            return $candidate
        }
    }

    return $null
}

function Ensure-BackendEnvFile {
    param(
        [string]$RepoRoot
    )

    $backendDir = Join-Path $RepoRoot "backend"
    $envPath = Join-Path $backendDir ".env"
    if (Test-Path $envPath) {
        Write-Host "Backend .env da san sang." -ForegroundColor DarkGreen
        return
    }

    $alternateEnv = Get-AlternateBackendEnvPath -RepoRoot $RepoRoot
    if ($alternateEnv) {
        Copy-Item $alternateEnv $envPath -Force
        Write-Host "Da copy backend/.env tu worktree khac." -ForegroundColor Yellow
        return
    }

    $examplePath = Join-Path $backendDir ".env.example"
    if (Test-Path $examplePath) {
        Copy-Item $examplePath $envPath -Force
        Write-Warning "Khong tim thay backend/.env da co san. Da tao moi tu .env.example; co the ban can cap nhat DB credentials thuc te."
        return
    }

    throw "Khong tim thay backend/.env va cung khong co backend/.env.example."
}

function Ensure-FrontendDependencies {
    param(
        [string]$RepoRoot
    )

    $frontendDir = Join-Path $RepoRoot "frontend"
    $eslintPath = Join-Path $frontendDir "node_modules/.bin/eslint.cmd"
    $tscPath = Join-Path $frontendDir "node_modules/.bin/tsc.cmd"
    if ((Test-Path $eslintPath) -and (Test-Path $tscPath)) {
        Write-Host "Frontend dependencies da san sang." -ForegroundColor DarkGreen
        return
    }

    Write-Host "Dang cai frontend dependencies..." -ForegroundColor Yellow
    Push-Location $frontendDir
    try {
        npm install
        if ($LASTEXITCODE -ne 0) {
            throw "npm install that bai."
        }
    } finally {
        Pop-Location
    }
}

function Ensure-BackendDependencies {
    param(
        [string]$RepoRoot
    )

    $backendDir = Join-Path $RepoRoot "backend"
    $requirementsPath = Join-Path $backendDir "requirements.txt"
    if (-not (Test-Path $requirementsPath)) {
        return
    }

    Push-Location $backendDir
    try {
        python -c "import django, rest_framework, drf_spectacular, django_q, psycopg2, PIL, reportlab, openpyxl" 2>$null
        if ($LASTEXITCODE -eq 0) {
            Write-Host "Backend dependencies da san sang." -ForegroundColor DarkGreen
            return
        }

        Write-Host "Dang dong bo Python dependencies..." -ForegroundColor Yellow
        python -m pip install -r requirements.txt
        if ($LASTEXITCODE -ne 0) {
            throw "pip install requirements that bai."
        }
    } finally {
        Pop-Location
    }
}

function Ensure-BackendRuntimeDirectories {
    param(
        [string]$RepoRoot
    )

    $mediaDir = Join-Path $RepoRoot "backend/media"
    if (-not (Test-Path $mediaDir)) {
        New-Item -ItemType Directory -Path $mediaDir | Out-Null
        Write-Host "Da tao thu muc backend/media." -ForegroundColor Yellow
    }
}

function Ensure-WorkspaceReady {
    param(
        [switch]$EnsureBackendEnv,
        [switch]$EnsureBackendDependencies,
        [switch]$EnsureFrontendDependencies
    )

    $repoRoot = Get-RepoRoot
    Ensure-BackendRuntimeDirectories -RepoRoot $repoRoot
    if ($EnsureBackendEnv) {
        Ensure-BackendEnvFile -RepoRoot $repoRoot
    }
    if ($EnsureBackendDependencies) {
        Ensure-BackendDependencies -RepoRoot $repoRoot
    }
    if ($EnsureFrontendDependencies) {
        Ensure-FrontendDependencies -RepoRoot $repoRoot
    }
}
