# Nightly/weekly scoring job. Register with Task Scheduler, e.g.:
#   schtasks /Create /TN "CFB Scoring" /SC DAILY /ST 05:00 /TR "powershell -NoProfile -File C:\Dev\CFBProject\analytics\run_scoring.ps1"
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$log = Join-Path $root "analytics\output\scoring_$(Get-Date -Format yyyyMMdd_HHmmss).log"
New-Item -ItemType Directory -Force (Split-Path $log) | Out-Null
Push-Location (Join-Path $root "analytics")
try {
    # Python warnings go to stderr; don't let PowerShell 5.1 treat them as terminating errors.
    $ErrorActionPreference = "Continue"
    & (Join-Path $root ".venv\Scripts\python.exe") score.py *>&1 | Tee-Object -FilePath $log
    if ($LASTEXITCODE -ne 0) { throw "score.py failed with exit code $LASTEXITCODE (see $log)" }
} finally {
    Pop-Location
}
