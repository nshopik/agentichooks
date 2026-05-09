# install-hooks.ps1
# Idempotently installs Claude Code hooks that signal the Agent Hook Notify Stream Deck plugin.
# Installs 15 Claude Code hooks: 10 action events (flash/audio/clear) + 5 info events (log-only).
# Run with: powershell -ExecutionPolicy Bypass -File install-hooks.ps1

$ErrorActionPreference = "Stop"
$settingsPath = Join-Path $env:USERPROFILE ".claude\settings.json"
$marker = "_claude-notify-installer"
$CURRENT_VERSION = "v7"
$staleHelperPath = Join-Path $env:USERPROFILE ".claude\claude-notify-hook.ps1"

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

function Make-Hook($routeName) {
    # v7: hook fires a single curl.exe POST to the local plugin listener.
    # No sig file, no toast, no AUMID. async=$true means Claude Code does
    # not wait on the curl call. --max-time 2 keeps a stuck listener from
    # hanging the hook. -s silences progress output.
    $cmd = "curl.exe -X POST -s --max-time 2 http://127.0.0.1:9123/event/$routeName"
    $h = [ordered]@{
        type    = "command"
        command = $cmd
        shell   = "powershell"
        async   = $true
    }
    $h[$marker] = $CURRENT_VERSION
    return [pscustomobject]$h
}

# Clean up the v3 helper script if it's still around (replaced by inline commands in v4+).
if (Test-Path $staleHelperPath) {
    Remove-Item $staleHelperPath -Force
    Write-Host "[clean] removed stale $staleHelperPath"
}

# v6 left stub claude-notify-*.sig files in %TEMP% (created by SignalWatcher).
# v7 doesn't use them; clean up so they don't linger.
Remove-Item "$env:TEMP\claude-notify-*.sig" -Force -ErrorAction SilentlyContinue

$settings = Read-Settings
if (-not ($settings.PSObject.Properties.Name -contains "hooks")) {
    $settings | Add-Member -MemberType NoteProperty -Name "hooks" -Value ([pscustomobject]@{}) -Force
}
$hooks = $settings.hooks

$events = [ordered]@{
    # Action events — drive button/audio behavior (10 entries)
    Stop                = "stop"
    StopFailure         = "stop-failure"
    PermissionRequest   = "permission-request"
    TaskCompleted       = "task-completed"
    SessionStart        = "session-start"
    UserPromptSubmit    = "user-prompt-submit"
    PermissionDenied    = "permission-denied"
    PostToolUse         = "post-tool-use"
    PostToolUseFailure  = "post-tool-use-failure"
    PreToolUse          = "pre-tool-use"
    # Info events — log only on the plugin side (5 entries)
    Notification        = "notification"
    PostToolBatch       = "post-tool-batch"
    SubagentStart       = "subagent-start"
    SubagentStop        = "subagent-stop"
    TaskCreated         = "task-created"
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
        Write-Host "[add ] $evt -> POST /event/$($events[$evt])"
    }
    $newEntry = [pscustomobject]@{ hooks = @(Make-Hook $events[$evt]) }
    $arr = $arr + $newEntry
    $hooks.$evt = $arr
    $changed += $evt
}

# Orphan cleanup: remove our managed hooks from event keys we no longer install.
# Only entries carrying our marker are removed; user-added hooks under the same key remain.
# The list is empty in v7; the loop is kept for future drops.
$droppedEvents = @()
foreach ($evt in $droppedEvents) {
    if (-not ($hooks.PSObject.Properties.Name -contains $evt)) { continue }
    $arr = @($hooks.$evt)
    $existingVer = Find-OurHookVersion $arr
    if ($null -eq $existingVer) { continue }
    $arr = @(Remove-OurHooks $arr)
    $hooks.$evt = $arr
    Write-Host "[drop] removed managed $evt hook ($existingVer; event no longer used)"
    $changed += $evt
}

if ($changed.Count -gt 0) {
    $settings.hooks = $hooks
    Write-Settings $settings
    Write-Host ""
    Write-Host "Done. Wrote $settingsPath"
} else {
    Write-Host ""
    Write-Host "No changes needed."
}
Write-Host "Each hook fire posts to http://127.0.0.1:9123/event/<route>. Set CLAUDE_NOTIFY_DEBUG=1 + restart plugin for verbose logging."
