# install-hooks.ps1
# Idempotently installs Claude Code hooks that signal the Claude Notify Stream Deck plugin.
# Covers 3 alert-arming events (Stop, PermissionRequest, TaskCompleted) plus dismiss events.
# Run with: powershell -ExecutionPolicy Bypass -File install-hooks.ps1

$ErrorActionPreference = "Stop"
$settingsPath = Join-Path $env:USERPROFILE ".claude\settings.json"
$marker = "_claude-notify-installer"
$CURRENT_VERSION = "v6"
$staleHelperPath = Join-Path $env:USERPROFILE ".claude\claude-notify-hook.ps1"
$aumid = "Claude.Notify"

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
    # Hook writes the sig file the plugin watches, then fires a native Windows
    # toast via the WinRT ToastNotificationManager API. No external module, no
    # helper script: a single inline command keeps PowerShell ExecutionPolicy
    # out of the picture on default Windows installs. Toasts are silent (no
    # sound) so high-rate hooks like PostToolUse don't become a sonic assault.
    # The 'Claude.Notify' AppUserModelID is registered once in HKCU below,
    # which gets toasts attributed correctly and persisted in Action Center.
    # Note: nodes are cached via .Item(0)/.Item(1) before mutation because
    # IXmlNodeList is live and re-indexing after AppendChild raises
    # "Collection was modified" on the second access.
    $cmd = "Set-Content -Path `"`$env:TEMP\$sigName`" -Value (Get-Date -Format 'o'); try { [void][Windows.UI.Notifications.ToastNotificationManager,Windows.UI.Notifications,ContentType=WindowsRuntime]; [void][Windows.Data.Xml.Dom.XmlDocument,Windows.Data.Xml.Dom.XmlDocument,ContentType=WindowsRuntime]; `$x=[Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02); `$n=`$x.GetElementsByTagName('text'); `$t1=`$n.Item(0); `$t2=`$n.Item(1); `$t1.AppendChild(`$x.CreateTextNode('Claude Notify: $eventName')) | Out-Null; `$t2.AppendChild(`$x.CreateTextNode((Get-Date -Format 'HH:mm:ss.fff'))) | Out-Null; `$a=`$x.CreateElement('audio'); `$a.SetAttribute('silent','true'); `$x.DocumentElement.AppendChild(`$a) | Out-Null; [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('$aumid').Show([Windows.UI.Notifications.ToastNotification]::new(`$x)) } catch {}"
    $h = [ordered]@{
        type    = "command"
        command = $cmd
        shell   = "powershell"
        async   = $true
    }
    $h[$marker] = $CURRENT_VERSION
    return [pscustomobject]$h
}

function Register-AppId {
    # Registers an AppUserModelID in HKCU so toasts are attributed as "Claude
    # Notify" in Action Center. Without this, modern Windows may silently
    # refuse to display toasts from an unregistered AUMID. Pure registry —
    # no Start Menu shortcut, no IPropertyStore P/Invoke, no module install.
    $regPath = "HKCU:\Software\Classes\AppUserModelId\$aumid"
    if (Test-Path $regPath) {
        Write-Host "[reg ] AppUserModelID '$aumid' already registered"
        return
    }
    New-Item -Path $regPath -Force | Out-Null
    New-ItemProperty -Path $regPath -Name "DisplayName" -Value "Claude Notify" -PropertyType String -Force | Out-Null
    Write-Host "[reg ] registered AppUserModelID '$aumid' in HKCU"
}

Register-AppId

# Clean up the v3 helper script if it's still around (replaced by inline commands in v4+).
if (Test-Path $staleHelperPath) {
    Remove-Item $staleHelperPath -Force
    Write-Host "[clean] removed stale $staleHelperPath"
}

$settings = Read-Settings
if (-not ($settings.PSObject.Properties.Name -contains "hooks")) {
    $settings | Add-Member -MemberType NoteProperty -Name "hooks" -Value ([pscustomobject]@{}) -Force
}
$hooks = $settings.hooks

$events = [ordered]@{
    # Alert-arming events
    Stop                = "claude-notify-stop.sig"
    StopFailure         = "claude-notify-stop.sig"
    PermissionRequest   = "claude-notify-permission.sig"
    TaskCompleted       = "claude-notify-task-completed.sig"
    # Full dismiss (clears every armed alert)
    UserPromptSubmit    = "claude-notify-active.sig"
    SessionStart        = "claude-notify-active.sig"
    # Permission-resolved (dismisses only an armed permission alert)
    PermissionDenied    = "claude-notify-permission-resolved.sig"
    PostToolUse         = "claude-notify-permission-resolved.sig"
    PostToolUseFailure  = "claude-notify-permission-resolved.sig"
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
Write-Host "Each hook fire shows a silent native Windows toast (Action Center keeps history)."
