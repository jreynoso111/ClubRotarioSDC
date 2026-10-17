$ErrorActionPreference = 'Stop'
# Preserve stale Windows Unix sockets only before Docker has any running process.
$dockerProcesses = Get-Process -Name 'Docker Desktop','com.docker.backend' -ErrorAction SilentlyContinue
if ($dockerProcesses) { exit 0 }
$localRoot = [IO.Path]::GetFullPath($env:LOCALAPPDATA)
$runtimeDirectories = @(
    @{ Path = (Join-Path $localRoot 'Docker\run'); Parent = (Join-Path $localRoot 'Docker') },
    @{ Path = (Join-Path $localRoot 'docker-secrets-engine'); Parent = $localRoot }
)
foreach ($runtimeDirectory in $runtimeDirectories) {
    if (-not (Test-Path -LiteralPath $runtimeDirectory.Path)) { continue }
    $item = Get-Item -LiteralPath $runtimeDirectory.Path -Force
    if (-not $item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
        throw 'Docker runtime directory is not a regular directory.'
    }
    $resolvedPath = [IO.Path]::GetFullPath($item.FullName)
    $expectedParent = [IO.Path]::GetFullPath((Resolve-Path -LiteralPath $runtimeDirectory.Parent).Path)
    if (-not [string]::Equals((Split-Path $resolvedPath -Parent),$expectedParent,[StringComparison]::OrdinalIgnoreCase)) {
        throw 'Docker runtime directory is outside its expected parent.'
    }
    Rename-Item -LiteralPath $resolvedPath -NewName ((Split-Path $resolvedPath -Leaf) + '.before-club-backend-' + (Get-Date -Format 'yyyyMMdd-HHmmss-fff'))
}
Start-Process -FilePath 'C:\Program Files\Docker\Docker\Docker Desktop.exe' -WindowStyle Hidden
