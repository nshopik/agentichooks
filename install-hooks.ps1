# install-hooks.ps1
# Idempotently installs Claude Code hooks that signal the Claude Notify Stream Deck plugin.
# Covers 4 alert-arming events (Stop, Notification, PermissionRequest, TaskCompleted) plus dismiss events.
# Run with: powershell -ExecutionPolicy Bypass -File install-hooks.ps1

$ErrorActionPreference = "Stop"
$settingsPath = Join-Path $env:USERPROFILE ".claude\settings.json"
$marker = "_claude-notify-installer"
$CURRENT_VERSION = "v4"
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

function Make-Hook($sigName, $eventName) {
    # Hook writes the sig file the plugin watches, then fires a Windows toast
    # via BurntToast so we can see exactly which hook fired and when. Inline
    # commands only (no helper script) so PowerShell ExecutionPolicy can't block
    # the hook on default Windows installs.
    $cmd = "Set-Content -Path `"`$env:TEMP\$sigName`" -Value (Get-Date -Format 'o'); try { New-BurntToastNotification -Text 'Claude Notify: $eventName', (Get-Date -Format 'HH:mm:ss.fff') -Silent } catch {}"
    $h = [ordered]@{
        type    = "command"
        command = $cmd
        shell   = "powershell"
        async   = $true
    }
    $h[$marker] = $CURRENT_VERSION
    return [pscustomobject]$h
}

function Ensure-BurntToast {
    if (Get-Module -ListAvailable -Name BurntToast) {
        Write-Host "[mod ] BurntToast already installed"
        return
    }
    Write-Host "[mod ] Installing BurntToast (CurrentUser scope)..."
    try {
        # NuGet provider is required by Install-Module; on a fresh box it prompts
        # to install. Pre-install it non-interactively here to avoid the prompt.
        if (-not (Get-PackageProvider -Name NuGet -ListAvailable -ErrorAction SilentlyContinue)) {
            Install-PackageProvider -Name NuGet -MinimumVersion 2.8.5.201 -Scope CurrentUser -Force -Confirm:$false -ErrorAction Stop | Out-Null
        }
        # PSGallery policy: must be Trusted to install without prompting.
        $gallery = Get-PSRepository -Name PSGallery -ErrorAction SilentlyContinue
        if ($gallery -and $gallery.InstallationPolicy -ne 'Trusted') {
            Set-PSRepository -Name PSGallery -InstallationPolicy Trusted
        }
        Install-Module -Name BurntToast -Scope CurrentUser -Force -AllowClobber -Confirm:$false -ErrorAction Stop
        Write-Host "[mod ] BurntToast installed"
    } catch {
        Write-Host "[mod ] Auto-install failed: $($_.Exception.Message)"
        Write-Host "       Hooks will still install. Install BurntToast manually with:"
        Write-Host "         Install-Module -Name BurntToast -Scope CurrentUser -Force"
        Write-Host "       Then re-run this script (or just leave it; sig writes still work)."
    }
}

Ensure-BurntToast

# Clean up the v3 helper script if it's still around (replaced by inline commands in v4).
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
Write-Host "Each hook fire shows a Windows toast (Action Center keeps history)."
