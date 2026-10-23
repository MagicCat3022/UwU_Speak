# UwUSpeak installer for Windows.
#
#   irm https://github.com/MagicCat3022/UwU_Speak/releases/latest/download/install.ps1 | iex
#
# This only makes sure Node.js is available (downloading a private copy when it isn't), then starts
# installer.mjs, which asks a few questions and does the rest. To pass options, run the saved
# script, for example: powershell -ExecutionPolicy Bypass -File install.ps1 --yes --target discord
# or set UWUSPEAK_ARGS before the one-line command. Options are listed by --help.
#
# Environment: UWUSPEAK_RELEASE picks a release tag (default latest), UWUSPEAK_ARGS adds options,
# UWUSPEAK_INSTALLER runs a local installer.mjs, UWUSPEAK_PORTABLE_NODE=1 ignores system Node.js.

$ErrorActionPreference = 'Stop'

function Invoke-UwUSpeakInstaller([string[]]$Arguments) {
    $ProgressPreference = 'SilentlyContinue'
    [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

    $repo = 'MagicCat3022/UwU_Speak'
    $nodeLine = 'latest-v24.x'
    $minNode = [version]'22.13.0'
    $stateDir = Join-Path $env:LOCALAPPDATA 'UwUSpeak'
    $toolsDir = Join-Path $stateDir 'tools'
    $release = if ($env:UWUSPEAK_RELEASE) { $env:UWUSPEAK_RELEASE } else { 'latest' }

    function Write-Step($text) { Write-Host "  $text" -ForegroundColor DarkGray }

    function Get-File($url, $dest) {
        for ($attempt = 1; ; $attempt++) {
            try {
                Invoke-WebRequest -Uri $url -OutFile $dest -UseBasicParsing -Headers @{ 'User-Agent' = 'UwUSpeak-installer' }
                return
            } catch {
                if ($attempt -ge 3) { throw "Couldn't download $url. Check your internet connection. ($($_.Exception.Message))" }
                Start-Sleep -Seconds $attempt
            }
        }
    }

    function Get-Sha256($file) { (Get-FileHash -Algorithm SHA256 -Path $file).Hash.ToLowerInvariant() }

    $arch = if ($env:PROCESSOR_ARCHITEW6432) { $env:PROCESSOR_ARCHITEW6432 } else { $env:PROCESSOR_ARCHITECTURE }
    switch ($arch) {
        'AMD64' { $arch = 'x64' }
        'ARM64' { $arch = 'arm64' }
        default { throw "This installer needs 64-bit Windows (found $arch)." }
    }

    # Node.js: a recent enough system copy, else a private one that only this installer uses.
    $node = $null
    $system = Get-Command node -ErrorAction SilentlyContinue
    if ($system -and -not $env:UWUSPEAK_PORTABLE_NODE) {
        $text = (& $system.Source --version 2>$null) -replace '^v', ''
        if ($text -match '^\d+\.\d+\.\d+$' -and [version]$text -ge $minNode) { $node = $system.Source }
    }
    if (-not $node) {
        $private = Get-ChildItem -Path $toolsDir -Directory -Filter "node-v*-win-$arch" -ErrorAction SilentlyContinue |
            Where-Object { Test-Path (Join-Path $_.FullName 'node.exe') } |
            Sort-Object { [version]($_.Name -replace '^node-v([\d.]+)-.*$', '$1') } -Descending |
            Select-Object -First 1
        if ($private) { $node = Join-Path $private.FullName 'node.exe' }
    }
    if (-not $node) {
        Write-Host 'Downloading Node.js for the installer (about 30 MB, only once)...' -ForegroundColor Cyan
        New-Item -ItemType Directory -Path $toolsDir -Force | Out-Null
        $sums = (Invoke-WebRequest -Uri "https://nodejs.org/dist/$nodeLine/SHASUMS256.txt" -UseBasicParsing).Content
        if ($sums -is [byte[]]) { $sums = [Text.Encoding]::UTF8.GetString($sums) }
        $match = [regex]::Match($sums, "(?m)^([0-9a-f]{64})\s+(node-v[\d.]+-win-$arch)\.zip\s*$")
        if (-not $match.Success) { throw "Couldn't find a Node.js download for Windows $arch." }
        $name = $match.Groups[2].Value
        $version = $name -replace '^node-v([\d.]+)-.*$', '$1'
        $zip = Join-Path $toolsDir "$name.zip"
        Get-File "https://nodejs.org/dist/v$version/$name.zip" $zip
        if ((Get-Sha256 $zip) -ne $match.Groups[1].Value) {
            Remove-Item $zip -Force
            throw 'The Node.js download is damaged (checksum mismatch). Run the installer again.'
        }
        Write-Step 'Unpacking Node.js...'
        $target = Join-Path $toolsDir $name
        if (Test-Path $target) { Remove-Item -Recurse -Force $target }
        Add-Type -AssemblyName System.IO.Compression.FileSystem
        [IO.Compression.ZipFile]::ExtractToDirectory($zip, $toolsDir)
        Remove-Item $zip -Force
        $node = Join-Path $target 'node.exe'
        if (-not (Test-Path $node)) { throw 'Node.js was downloaded but node.exe is missing.' }
    }

    # The installer itself, checked against the release's checksums.
    if ($env:UWUSPEAK_INSTALLER) {
        $installer = $env:UWUSPEAK_INSTALLER
    } else {
        $base = if ($release -eq 'latest') { "https://github.com/$repo/releases/latest/download" } else { "https://github.com/$repo/releases/download/$release" }
        New-Item -ItemType Directory -Path $stateDir -Force | Out-Null
        $installer = Join-Path $stateDir 'installer.mjs'
        $sumsFile = Join-Path $stateDir 'SHA256SUMS.txt'
        Get-File "$base/installer.mjs" $installer
        Get-File "$base/SHA256SUMS.txt" $sumsFile
        $expected = [regex]::Match((Get-Content -Raw $sumsFile), '(?m)^([0-9a-f]{64})\s+\*?installer\.mjs\s*$').Groups[1].Value
        Remove-Item $sumsFile -Force
        if (-not $expected -or (Get-Sha256 $installer) -ne $expected) {
            Remove-Item $installer -Force
            throw 'The installer download is damaged (checksum mismatch). Run the command again.'
        }
    }

    $nodeArgs = @($installer)
    if ($release -ne 'latest') { $nodeArgs += @('--release', $release) }
    if ($env:UWUSPEAK_ARGS) { $nodeArgs += ($env:UWUSPEAK_ARGS -split '\s+' | Where-Object { $_ }) }
    if ($Arguments) { $nodeArgs += $Arguments }
    $env:NODE_USE_ENV_PROXY = '1'
    & $node @nodeArgs
    $global:LASTEXITCODE = $LASTEXITCODE
}

# No "exit" here: run through "irm | iex", it would close the user's PowerShell window.
try {
    Invoke-UwUSpeakInstaller $args
} catch {
    Write-Host ''
    Write-Host "x $($_.Exception.Message)" -ForegroundColor Red
    Write-Host 'Need help? https://github.com/MagicCat3022/UwU_Speak/issues'
    $global:LASTEXITCODE = 1
}
