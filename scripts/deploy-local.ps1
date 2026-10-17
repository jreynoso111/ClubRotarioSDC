# Build and test a separate release while production remains online. A failed
# public check restores both the previous build pointer and scheduled task.
param([string]$ExistingBuildDir)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$stateRoot = 'C:\ProgramData\ClubRotarioSDC'
$statePath = Join-Path $stateRoot 'current-release.json'
$release = if ($ExistingBuildDir) { $ExistingBuildDir } else { '.next-releases/' + (Get-Date -Format 'yyyyMMdd-HHmmss') }
if ($release -notmatch '^\.next-releases/[0-9-]+$') { throw 'Invalid release path' }
$previousEnvironment = $env:NEXT_BUILD_DIR
$previousState = if (Test-Path -LiteralPath $statePath) { Get-Content -LiteralPath $statePath -Raw } else { $null }
$previousTask = Export-ScheduledTask -TaskName 'ClubRotarioSDC-Next-Web'
$runtimeTask = Get-ScheduledTask -TaskName 'ClubRotarioSDC-Next-Web'
$launcher = Join-Path $projectRoot 'scripts/start-production.mjs'
if ($runtimeTask.Actions.Count -ne 1 -or $runtimeTask.Actions[0].Execute -ne 'C:\Program Files\nodejs\node.exe' -or $runtimeTask.Actions[0].Arguments -ne "`"$launcher`"") {
    throw 'Production task must use the stable launcher before publishing a release'
}
$candidate = $null
$switched = $false
Set-Location -LiteralPath $projectRoot
try {
    if (Get-NetTCPConnection -LocalPort 3011 -State Listen -ErrorAction SilentlyContinue) {
        throw 'Candidate port 3011 is already in use'
    }
    $env:NEXT_BUILD_DIR = $release
    if (-not $ExistingBuildDir) {
        & npm.cmd run build
        if ($LASTEXITCODE -ne 0) { throw 'Candidate build failed; production was not changed' }
    } elseif (-not (Test-Path -LiteralPath (Join-Path $projectRoot "$release/BUILD_ID"))) {
        throw 'Existing build is missing'
    }
    if ($runtimeTask.Principal.UserId -notin @('SYSTEM','S-1-5-18')) {
        $runtimeSid = if ($runtimeTask.Principal.UserId -like 'S-1-*') { [Security.Principal.SecurityIdentifier]::new($runtimeTask.Principal.UserId) } else { [Security.Principal.NTAccount]::new($runtimeTask.Principal.UserId).Translate([Security.Principal.SecurityIdentifier]) }
        $releasePath = Join-Path $projectRoot $release
        $releaseAcl = Get-Acl -LiteralPath $releasePath
        $releaseAcl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($runtimeSid,'ReadAndExecute','ContainerInherit, ObjectInherit','None','Allow'))
        Set-Acl -LiteralPath $releasePath -AclObject $releaseAcl
        $cachePath = Join-Path $releasePath 'cache'
        New-Item -ItemType Directory -Path $cachePath -Force | Out-Null
        $cacheAcl = Get-Acl -LiteralPath $cachePath
        $cacheAcl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($runtimeSid,'Modify','ContainerInherit, ObjectInherit','None','Allow'))
        Set-Acl -LiteralPath $cachePath -AclObject $cacheAcl
    }
    $nextPath = Join-Path $projectRoot 'node_modules/next/dist/bin/next'
    $candidate = Start-Process -FilePath 'C:\Program Files\nodejs\node.exe' -ArgumentList @("`"$nextPath`"",'start','--hostname','127.0.0.1','--port','3011') -WorkingDirectory $projectRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $stateRoot 'logs/candidate.out.log') -RedirectStandardError (Join-Path $stateRoot 'logs/candidate.err.log')
    $ready = $false
    for ($attempt=0; $attempt -lt 30; $attempt++) {
        try {
            $response = Invoke-WebRequest 'http://127.0.0.1:3011/auth/sign-in' -UseBasicParsing -TimeoutSec 5
            $ready = $response.StatusCode -eq 200 -and $response.Headers['X-Content-Type-Options'] -eq 'nosniff'
            if ($ready) { break }
        } catch { }
        if ($candidate.HasExited) { throw 'Candidate server exited before becoming ready' }
        Start-Sleep -Seconds 2
    }
    if (-not $ready) { throw 'Candidate readiness failed; production was not changed' }
    Stop-Process -Id $candidate.Id
    $candidate = $null
    $previousTask | Set-Content -LiteralPath (Join-Path $stateRoot 'previous-web-task.xml')
    @{buildDir=$release;previousBuildDir=if($previousState){($previousState|ConvertFrom-Json).buildDir}else{'.next'};publishedAt=(Get-Date).ToUniversalTime().ToString('o')} | ConvertTo-Json | Set-Content -LiteralPath $statePath
    $switched = $true
    Stop-ScheduledTask -TaskName 'ClubRotarioSDC-Next-Web'
    Start-ScheduledTask -TaskName 'ClubRotarioSDC-Next-Web'
    $healthy = $false
    for ($attempt=0; $attempt -lt 20; $attempt++) {
        try {
            $response = Invoke-WebRequest 'https://www.clubrotariosdcolonial.org/auth/sign-in' -UseBasicParsing -TimeoutSec 10
            $healthy = $response.StatusCode -eq 200 -and $response.Headers['X-Content-Type-Options'] -eq 'nosniff'
            if ($healthy) { break }
        } catch { }
        Start-Sleep -Seconds 2
    }
    if (-not $healthy) { throw 'Public verification failed' }
    & node scripts/verify-deployment.mjs
    if ($LASTEXITCODE -ne 0) { throw 'Public deployment checks failed' }
    Write-Output "Published and verified $release"
} catch {
    if ($switched) {
        Stop-ScheduledTask -TaskName 'ClubRotarioSDC-Next-Web'
        if ($previousState) { $previousState | Set-Content -LiteralPath $statePath }
        else { @{buildDir='.next'} | ConvertTo-Json | Set-Content -LiteralPath $statePath }
        Start-ScheduledTask -TaskName 'ClubRotarioSDC-Next-Web'
    }
    throw
} finally {
    if ($candidate -and -not $candidate.HasExited) { Stop-Process -Id $candidate.Id }
    $env:NEXT_BUILD_DIR = $previousEnvironment
}
