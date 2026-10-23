# Installs or updates the UwUSpeak Vencord plugin on Windows.
#
#   irm https://github.com/MagicCat3022/UwU_Speak/releases/latest/download/install.ps1 | iex
#
# With options, download the script and run it, for example:
#   .\install.ps1 -VencordPath D:\src\Vencord -Version v0.1.0 -Inject
#
# It clones Vencord from source if needed (custom plugins can't be loaded by the prebuilt
# installer), copies the plugin into src\userplugins\uwuSpeak, builds Vencord, and patches
# Discord the first time.
param(
    # Vencord source checkout to use. Cloned here if it doesn't exist yet.
    [string]$VencordPath = $(if ($env:VENCORD_PATH) { $env:VENCORD_PATH } else { Join-Path $HOME 'Vencord' }),
    # Release tag to install, such as v0.1.0. Defaults to the latest release.
    [string]$Version = $(if ($env:UWUSPEAK_VERSION) { $env:UWUSPEAK_VERSION } else { 'latest' }),
    # Patch Discord with this Vencord build even when the checkout already existed.
    [switch]$Inject
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

$repo = 'MagicCat3022/UwU_Speak'

function Step($message) { Write-Host "==> $message" -ForegroundColor Cyan }

function Invoke-Native {
    param([string]$Command, [string[]]$Arguments)
    & $Command @Arguments
    if ($LASTEXITCODE -ne 0) { throw "'$Command $($Arguments -join ' ')' failed with exit code $LASTEXITCODE." }
}

function Test-Command($name) { [bool](Get-Command $name -ErrorAction SilentlyContinue) }

Step 'Checking prerequisites'
if (-not (Test-Command git)) { throw 'git is required. Install it from https://git-scm.com/download/win and run this again.' }
if (-not (Test-Command node)) { throw 'Node.js 22 or newer is required. Install it from https://nodejs.org and run this again.' }
$nodeMajor = [int]((node --version).TrimStart('v').Split('.')[0])
if ($nodeMajor -lt 22) { throw "Node.js 22 or newer is required; found $(node --version)." }
if (-not (Test-Command pnpm)) {
    Step 'Installing pnpm (npm install -g pnpm)'
    Invoke-Native npm @('install', '-g', 'pnpm')
    if (-not (Test-Command pnpm)) { throw 'pnpm was installed but is not on PATH. Open a new terminal and run this again.' }
}

$fresh = $false
if (-not (Test-Path $VencordPath)) {
    Step "Cloning Vencord into $VencordPath"
    Invoke-Native git @('clone', 'https://github.com/Vendicated/Vencord', $VencordPath)
    $fresh = $true
} elseif (-not (Test-Path (Join-Path $VencordPath 'src\plugins'))) {
    throw "$VencordPath exists but is not a Vencord source checkout. Pass -VencordPath with a different folder."
}

$url = "https://github.com/$repo/releases/download/$Version/uwuSpeak.zip"
if ($Version -eq 'latest') { $url = "https://github.com/$repo/releases/latest/download/uwuSpeak.zip" }
$temp = Join-Path ([IO.Path]::GetTempPath()) ("uwuSpeak-" + [guid]::NewGuid())
New-Item -ItemType Directory -Path $temp | Out-Null
try {
    Step "Downloading the plugin ($Version)"
    $zip = Join-Path $temp 'uwuSpeak.zip'
    Invoke-WebRequest -Uri $url -OutFile $zip -UseBasicParsing
    Expand-Archive -Path $zip -DestinationPath $temp
    if (-not (Test-Path (Join-Path $temp 'uwuSpeak\index.tsx'))) { throw 'The downloaded archive does not contain the plugin.' }

    $userplugins = Join-Path $VencordPath 'src\userplugins'
    $target = Join-Path $userplugins 'uwuSpeak'
    Step "Installing the plugin into $target"
    New-Item -ItemType Directory -Path $userplugins -Force | Out-Null
    if (Test-Path $target) { Remove-Item -Recurse -Force $target }
    Move-Item (Join-Path $temp 'uwuSpeak') $target
} finally {
    Remove-Item -Recurse -Force $temp -ErrorAction SilentlyContinue
}

Push-Location $VencordPath
try {
    Step 'Installing Vencord dependencies'
    Invoke-Native pnpm @('install', '--frozen-lockfile')
    Step 'Building Vencord'
    Invoke-Native pnpm @('build')
    if ($fresh -or $Inject) {
        Step 'Patching Discord to use this Vencord build (choose your Discord install when asked)'
        Invoke-Native pnpm @('inject')
    }
} finally {
    Pop-Location
}

Write-Host ''
Write-Host 'UwUSpeak is installed.' -ForegroundColor Green
if ($fresh -or $Inject) {
    Write-Host 'Start Discord, then enable UwUSpeak under Settings > Vencord > Plugins.'
} else {
    Write-Host 'Fully restart Discord (quit it from the system tray), then enable UwUSpeak under Settings > Vencord > Plugins if it is not on yet.'
    Write-Host 'If Discord does not show Vencord, run this again with -Inject.'
}
