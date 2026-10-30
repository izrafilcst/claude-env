# claude-env: bootstrap para Windows (PowerShell 5.1 ou 7+).
#
#   irm https://raw.githubusercontent.com/izrafilcst/claude-env/main/install.ps1 | iex
#   & ([scriptblock]::Create((irm https://raw.githubusercontent.com/izrafilcst/claude-env/main/install.ps1))) -DryRun
#   & "$HOME\.claude-env\install.ps1" -Command doctor
#   & "$HOME\.claude-env\install.ps1" -Command project -Name ruflo -Dir C:\code\meu-projeto
#
# Garante Git, Node.js, Python e Claude Code (via winget e o instalador oficial),
# baixa este repositorio em ~\.claude-env e entrega o resto para scripts/install.mjs.
# Mantido em ASCII de proposito: o PowerShell 5.1 le arquivos sem BOM como ANSI.

param(
    [ValidateSet('install', 'doctor', 'project')]
    [string]$Command = 'install',
    [string]$Name = '',
    [string]$Dir = '',
    [string[]]$Only = @(),
    [switch]$DryRun,
    [switch]$WithCowork
)

# Corpo num escopo proprio: com "irm | iex" o script roda dentro da sessao do usuario,
# e nada daqui (funcoes, $ErrorActionPreference) deve vazar para ela.
$code = & {
    $ErrorActionPreference = 'Stop'
    $ProgressPreference = 'SilentlyContinue'

    $repoUrl = if ($env:CLAUDE_ENV_REPO) { $env:CLAUDE_ENV_REPO } else { 'https://github.com/izrafilcst/claude-env.git' }
    $dest = if ($env:CLAUDE_ENV_HOME) { $env:CLAUDE_ENV_HOME } else { Join-Path $HOME '.claude-env' }

    function Say([string]$Message) { Write-Host "==> $Message" -ForegroundColor Cyan }
    function Warn([string]$Message) { Write-Host "!! $Message" -ForegroundColor Yellow }
    function Have([string]$Tool) { [bool](Get-Command $Tool -ErrorAction SilentlyContinue) }

    # winget grava o PATH no registro; traz as entradas novas para esta sessao.
    function Update-SessionPath {
        $machine = [Environment]::GetEnvironmentVariable('Path', 'Machine')
        $user = [Environment]::GetEnvironmentVariable('Path', 'User')
        $all = "$env:Path;$machine;$user;$(Join-Path $HOME '.local\bin')" -split ';'
        $env:Path = ($all | Where-Object { $_ } | Select-Object -Unique) -join ';'
    }

    function Install-WithWinget([string]$Id, [string]$Label) {
        if (-not (Have 'winget')) {
            throw "winget nao encontrado. Instale $Label manualmente (ou o 'App Installer' da Microsoft Store) e rode de novo."
        }
        Say "Instalando $Label"
        winget install --id $Id --exact --silent --source winget --accept-package-agreements --accept-source-agreements | Out-Host
        Update-SessionPath
    }

    function Test-Node {
        if (-not (Have 'node')) { return $false }
        [int](node -p "process.versions.node.split('.')[0]") -ge 18
    }

    # O alias "python" da Microsoft Store existe mas so abre a loja; testa de verdade.
    function Test-Python {
        # No PowerShell 5.1, stderr redirecionado vira erro fatal com "Stop".
        $ErrorActionPreference = 'Continue'
        foreach ($exe in 'python3', 'python') {
            if (Have $exe) {
                & $exe --version *> $null
                if ($LASTEXITCODE -eq 0) { return $true }
            }
        }
        $false
    }

    Update-SessionPath

    if (-not (Have 'git')) { Install-WithWinget 'Git.Git' 'Git' }
    if (-not (Test-Node)) { Install-WithWinget 'OpenJS.NodeJS.LTS' 'Node.js LTS' }
    if (-not (Test-Python)) {
        try { Install-WithWinget 'Python.Python.3.12' 'Python 3' }
        catch { Warn "Sem Python: as skills hunter-* nao vao rodar seus scripts. ($_)" }
    }
    if (-not (Have 'claude')) {
        Say 'Instalando Claude Code'
        # Processo separado: o instalador oficial chama "exit" quando falha.
        $shell = (Get-Process -Id $PID).Path
        & $shell -NoProfile -ExecutionPolicy Bypass -Command 'irm https://claude.ai/install.ps1 | iex' | Out-Host
        Update-SessionPath
    }

    foreach ($tool in 'git', 'node', 'claude') {
        if (-not (Have $tool)) { throw "$tool continua fora do PATH. Abra um novo terminal e rode de novo." }
    }

    # Rodando de um clone (.\install.ps1)? Entao usa ele mesmo em vez de baixar.
    $src = $PSScriptRoot
    if (-not $src -or -not (Test-Path (Join-Path $src 'environment.json'))) {
        if (Test-Path (Join-Path $dest '.git')) {
            Say "Atualizando $dest"
            git -C $dest pull --ff-only --quiet | Out-Host
        }
        else {
            Say "Baixando claude-env em $dest"
            git clone --depth 1 --quiet $repoUrl $dest | Out-Host
        }
        if ($LASTEXITCODE -ne 0) { throw 'git falhou ao baixar o claude-env.' }
        $src = $dest
    }

    $nodeArgs = @($Command)
    if ($Command -eq 'project') {
        if (-not $Name) { throw 'Informe o perfil: -Command project -Name ruflo [-Dir <pasta>]' }
        $nodeArgs += $Name
        $nodeArgs += $(if ($Dir) { $Dir } else { (Get-Location).Path })
    }
    if ($DryRun) { $nodeArgs += '--dry-run' }
    if ($WithCowork) { $nodeArgs += '--with-cowork' }
    if ($Only) { $nodeArgs += @('--only', ($Only -join ',')) }

    node (Join-Path $src 'scripts\install.mjs') @nodeArgs | Out-Host
    $LASTEXITCODE
}

# "exit" so quando rodou como arquivo; dentro de "irm | iex" fecharia a janela do usuario.
if ($PSCommandPath) { exit [int]($code | Select-Object -Last 1) }
