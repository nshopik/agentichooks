# install-hooks.ps1
# Idempotently installs Claude Code hooks that touch the three claude-notify-*.sig files.
# Run with: powershell -ExecutionPolicy Bypass -File install-hooks.ps1

$ErrorActionPreference = "Stop"
$settingsPath = Join-Path $env:USERPROFILE ".claude\settings.json"
$marker = "_claude-notify-installer"

function Read-Settings {
    if (-not (Test-Path $settingsPath)) {
        return [pscustomobject]@{}
    }
    $raw = Get-Content $settingsPath -Raw
    if ([string]::IsNullOrWhiteSpace($raw)) { return [pscustomobject]@{} }
    return $raw | ConvertFrom-Json
}

function Write-Settings($obj) {
    $dir = Split-Path $settingsPath -Parent
    if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
    $json = $obj | ConvertTo-Json -Depth 10
    Set-Content -Path $settingsPath -Value $json -Encoding UTF8
}

function Get-OrAdd-Property($obj, $name, $default) {
    if (-not ($obj.PSObject.Properties.Name -contains $name)) {
        $obj | Add-Member -MemberType NoteProperty -Name $name -Value $default -Force
    }
    return , $obj.$name
}

function Has-OurHook($hooksArray) {
    if ($null -eq $hooksArray) { return $false }
    foreach ($entry in $hooksArray) {
        if ($null -eq $entry.hooks) { continue }
        foreach ($h in $entry.hooks) {
            if ($h.PSObject.Properties.Name -contains $marker) { return $true }
        }
    }
    return $false
}

function Make-Hook($sigName) {
    $cmd = "Set-Content -Path `"`$env:TEMP\$sigName`" -Value (Get-Date -Format 'o')"
    $h = [ordered]@{
        type    = "command"
        command = $cmd
        shell   = "powershell"
        async   = $true
    }
    $h[$marker] = "v1"
    return [pscustomobject]$h
}

$settings = Read-Settings
if (-not ($settings.PSObject.Properties.Name -contains "hooks")) {
    $settings | Add-Member -MemberType NoteProperty -Name "hooks" -Value ([pscustomobject]@{}) -Force
}
$hooks = $settings.hooks

$events = [ordered]@{
    Stop              = "claude-notify-stop.sig"
    Notification      = "claude-notify-idle.sig"
    PermissionRequest = "claude-notify-permission.sig"
}

$added = @()
foreach ($evt in $events.Keys) {
    if (-not ($hooks.PSObject.Properties.Name -contains $evt)) {
        $hooks | Add-Member -MemberType NoteProperty -Name $evt -Value @() -Force
    }
    $arr = @($hooks.$evt)

    if (Has-OurHook $arr) {
        Write-Host "[skip] $evt already has Claude Notify hook"
        continue
    }
    $newEntry = [pscustomobject]@{ hooks = @(Make-Hook $events[$evt]) }
    $arr = $arr + $newEntry
    $hooks.$evt = $arr
    $added += $evt
    Write-Host "[add ] $evt -> writes $($events[$evt])"
}

# Legacy migration: detect any local hook still writing claude-notify-flash.sig
$legacyFound = $false
foreach ($evt in $hooks.PSObject.Properties.Name) {
    foreach ($entry in @($hooks.$evt)) {
        if ($null -eq $entry.hooks) { continue }
        foreach ($h in $entry.hooks) {
            if ($h.command -match "claude-notify-flash\.sig") { $legacyFound = $true }
        }
    }
}
if ($legacyFound) {
    $resp = Read-Host "Detected legacy 'claude-notify-flash.sig' hook. Migrate to claude-notify-stop.sig? (y/n)"
    if ($resp -eq "y") {
        foreach ($evt in $hooks.PSObject.Properties.Name) {
            foreach ($entry in @($hooks.$evt)) {
                if ($null -eq $entry.hooks) { continue }
                foreach ($h in $entry.hooks) {
                    if ($h.command -match "claude-notify-flash\.sig") {
                        $h.command = $h.command -replace "claude-notify-flash\.sig", "claude-notify-stop.sig"
                        Write-Host "[mig ] migrated legacy hook in '$evt'"
                    }
                }
            }
        }
    }
}

if ($added.Count -gt 0 -or $legacyFound) {
    $settings.hooks = $hooks
    Write-Settings $settings
    Write-Host ""
    Write-Host "Done. Wrote $settingsPath"
} else {
    Write-Host ""
    Write-Host "No changes needed."
}
