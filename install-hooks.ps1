# install-hooks.ps1
# Idempotently installs Claude Code hooks that signal the Claude Notify Stream Deck plugin.
# Covers 4 alert-arming events (Stop, Notification, PermissionRequest, TaskCompleted) plus dismiss events.
# Run with: powershell -ExecutionPolicy Bypass -File install-hooks.ps1

$ErrorActionPreference = "Stop"
$settingsPath = Join-Path $env:USERPROFILE ".claude\settings.json"
$marker = "_claude-notify-installer"
$CURRENT_VERSION = "v3"
$debugLogPath = Join-Path $env:TEMP "claude-notify-debug.log"
$helperPath = Join-Path $env:USERPROFILE ".claude\claude-notify-hook.ps1"

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

function Find-OurHookVersion($hooksArray) {
    if ($null -eq $hooksArray) { return $null }
    foreach ($entry in $hooksArray) {
        if ($null -eq $entry.hooks) { continue }
        foreach ($h in $entry.hooks) {
            if ($h.PSObject.Properties.Name -contains $marker) {
                return [string]$h.$marker
            }
        }
    }
    return $null
}

function Remove-OurHooks($hooksArray) {
    if ($null -eq $hooksArray) { return @() }
    $result = @()
    foreach ($entry in $hooksArray) {
        if ($null -eq $entry.hooks) {
            $result += $entry
            continue
        }
        $remaining = @()
        foreach ($h in $entry.hooks) {
            if ($h.PSObject.Properties.Name -contains $marker) { continue }
            $remaining += $h
        }
        if ($remaining.Count -gt 0) {
            $entry.hooks = $remaining
            $result += $entry
        }
    }
    return $result
}

function Make-Hook($sigName, $eventName) {
    # Hook delegates to the helper script (installed alongside settings.json by
    # Write-HelperScript). The helper writes the sig file AND appends a debug
    # line under a retry loop so concurrent hook fires (e.g., several PostToolUse
    # in one turn) don't drop log entries to file-lock contention.
    $cmd = "& `"`$env:USERPROFILE\.claude\claude-notify-hook.ps1`" -Sig `"$sigName`" -EventName `"$eventName`""
    $h = [ordered]@{
        type    = "command"
        command = $cmd
        shell   = "powershell"
        async   = $true
    }
    $h[$marker] = $CURRENT_VERSION
    return [pscustomobject]$h
}

function Write-HelperScript {
    $dir = Split-Path $helperPath -Parent
    if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
    $content = @'
# claude-notify-hook.ps1 - invoked by Claude Code hooks installed by install-hooks.ps1.
# Writes a sig file the Stream Deck plugin watches, then appends a tab-separated
# line to a shared debug log. Retry loop handles concurrent hook fires that
# would otherwise contend for the log file and silently drop entries.
param(
    [Parameter(Mandatory=$true)][string]$Sig,
    [Parameter(Mandatory=$true)][string]$EventName
)

$ErrorActionPreference = "SilentlyContinue"

$ts = Get-Date -Format 'o'
$sigPath = Join-Path $env:TEMP $Sig
$logPath = Join-Path $env:TEMP "claude-notify-debug.log"

Set-Content -Path $sigPath -Value $ts

$line = "$ts`t$EventName`t$Sig"
for ($i = 0; $i -lt 30; $i++) {
    try {
        Add-Content -LiteralPath $logPath -Value $line -ErrorAction Stop
        return
    } catch {
        Start-Sleep -Milliseconds 30
    }
}
'@
    Set-Content -Path $helperPath -Value $content -Encoding UTF8
    Write-Host "[help] wrote $helperPath"
}

Write-HelperScript

$settings = Read-Settings
if (-not ($settings.PSObject.Properties.Name -contains "hooks")) {
    $settings | Add-Member -MemberType NoteProperty -Name "hooks" -Value ([pscustomobject]@{}) -Force
}
$hooks = $settings.hooks

$events = [ordered]@{
    # Alert-arming events
    Stop                = "claude-notify-stop.sig"
    Notification        = "claude-notify-idle.sig"
    PermissionRequest   = "claude-notify-permission.sig"
    TaskCompleted       = "claude-notify-task-completed.sig"
    # Full dismiss (clears every alert including task-completed)
    StopFailure         = "claude-notify-active.sig"
    UserPromptSubmit    = "claude-notify-active.sig"
    # Soft dismiss (clears all except sticky event types — task-completed survives)
    PermissionDenied    = "claude-notify-active-soft.sig"
    PostToolUse         = "claude-notify-active-soft.sig"
    PostToolUseFailure  = "claude-notify-active-soft.sig"
}

$changed = @()
foreach ($evt in $events.Keys) {
    if (-not ($hooks.PSObject.Properties.Name -contains $evt)) {
        $hooks | Add-Member -MemberType NoteProperty -Name $evt -Value @() -Force
    }
    $arr = @($hooks.$evt)

    $existingVer = Find-OurHookVersion $arr
    if ($existingVer -eq $CURRENT_VERSION) {
        Write-Host "[skip] $evt already at $CURRENT_VERSION"
        continue
    }
    if ($null -ne $existingVer) {
        $arr = @(Remove-OurHooks $arr)
        Write-Host "[up  ] ${evt}: $existingVer -> $CURRENT_VERSION"
    } else {
        Write-Host "[add ] $evt -> writes $($events[$evt])"
    }
    $newEntry = [pscustomobject]@{ hooks = @(Make-Hook $events[$evt] $evt) }
    $arr = $arr + $newEntry
    $hooks.$evt = $arr
    $changed += $evt
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

if ($changed.Count -gt 0 -or $legacyFound) {
    $settings.hooks = $hooks
    Write-Settings $settings
    Write-Host ""
    Write-Host "Done. Wrote $settingsPath"
} else {
    Write-Host ""
    Write-Host "No changes needed."
}
Write-Host "Debug log: $debugLogPath  (each hook fire appends a line: <timestamp>`t<event>`t<sig>)"
