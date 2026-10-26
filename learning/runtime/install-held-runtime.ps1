# This script does NOT grant authorization. Invoke only after the human approves
# the concrete persistent, owner-only HELD transport installation. No key,
# journal, feedback, GitHub API egress or learning activation is included.
[CmdletBinding(SupportsShouldProcess=$true, ConfirmImpact='High')]
param(
  [Parameter(Mandatory=$true)][string]$ApprovedRevision,
  [switch]$ApprovePersistentHeldTransport,
  [switch]$StartApprovedTransport
)
$ErrorActionPreference = 'Stop'
if (-not $ApprovePersistentHeldTransport -or $ApprovedRevision -notmatch '^[a-f0-9]{40}$') { throw 'Explicit reviewed persistent-transport decision required' }
$taskNode = (Get-Command node.exe -CommandType Application).Source
$taskExpectedRoot = [IO.Path]::GetFullPath((Join-Path $env:USERPROFILE 'WTFStremioPrivate/connection'))
$taskRoot = (& $taskNode --input-type=module -e "import fs from 'node:fs'; console.log(fs.realpathSync.native(process.argv[1]));" $taskExpectedRoot).Trim()
if ($LASTEXITCODE -ne 0 -or $taskRoot -ne $taskExpectedRoot) { throw 'Stable canonical owner-profile directory required; no package-cache redirection' }
$taskSource = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$taskConfig = Join-Path $taskRoot 'runtime.json'
$taskOwner = [Security.Principal.WindowsIdentity]::GetCurrent().User
$taskAllowed = @($taskOwner.Value, 'S-1-5-18')
$taskRootInfo = Get-Item -LiteralPath $taskRoot
if (-not $taskRootInfo.PSIsContainer -or ($taskRootInfo.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Protected directory required' }
for ($taskParent=$taskRoot; $taskParent; $taskParent=[IO.Path]::GetDirectoryName($taskParent)) {
  if ((Get-Item -LiteralPath $taskParent).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Junction-free destination required' }
}
$taskConfigInfo = Get-Item -LiteralPath $taskConfig
if ($taskConfigInfo.PSIsContainer -or ($taskConfigInfo.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Regular closed runtime config required' }
$taskAcl = Get-Acl -LiteralPath $taskRoot
if (-not $taskAcl.AreAccessRulesProtected -or @($taskAcl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier]) | Where-Object { $_.AccessControlType -eq 'Allow' -and $_.IdentityReference.Value -notin $taskAllowed }).Count -ne 0) { throw 'Owner/SYSTEM-only protected directory required' }
$taskConfiguration = Get-Content -Raw -LiteralPath $taskConfig | ConvertFrom-Json
if ($taskConfiguration.schema_version -ne 1 -or $taskConfiguration.remote_service_enabled -ne $false -or $taskConfiguration.task_access_enabled -ne $false -or $taskConfiguration.directory -ne $taskRoot -or $taskConfiguration.source_revision -ne $ApprovedRevision) { throw 'Exact disabled reviewed runtime configuration required' }
$taskHead = (& git -C $taskSource rev-parse HEAD).Trim()
$taskMain = (& git -C $taskSource rev-parse origin/main).Trim()
$taskOrigin = (& git -C $taskSource remote get-url origin).Trim()
if ($LASTEXITCODE -ne 0 -or $taskHead -ne $ApprovedRevision -or $taskMain -ne $ApprovedRevision -or $taskOrigin -notmatch '^(https://github.com/|git@github.com:)Lewdcifer666/wtf-scifi-feedback(\.git)?$') { throw 'Pinned private main source required' }
$taskManifestText = & git -C $taskSource show ($ApprovedRevision + ':.learning-engine-manifest.json')
if ($LASTEXITCODE -ne 0) { throw 'Pinned commit manifest required' }
$taskManifest = ($taskManifestText -join "`n") | ConvertFrom-Json
$taskFiles = @('learning/pc-runtime-policy.mjs','learning/pc-runtime-supervisor.mjs')
$taskBytes = @{}
foreach ($taskName in $taskFiles) {
  $taskFile = Join-Path $taskSource $taskName
  $taskInfo = Get-Item -LiteralPath $taskFile
  if ($taskInfo.PSIsContainer -or ($taskInfo.Attributes -band [IO.FileAttributes]::ReparsePoint) -or $taskInfo.Length -gt 65536) { throw 'Unexpected runtime source' }
  $taskText = [IO.File]::ReadAllText($taskFile, [Text.UTF8Encoding]::new($false,$true)).Replace("`r`n","`n")
  $taskBytes[$taskName] = [Text.Encoding]::UTF8.GetBytes($taskText)
  $taskHash = [BitConverter]::ToString([Security.Cryptography.SHA256]::Create().ComputeHash($taskBytes[$taskName])).Replace('-','').ToLowerInvariant()
  if ($taskManifest.$taskName -ne $taskHash) { throw 'Runtime source integrity mismatch' }
}
$taskName = 'WTF Stremio Private Held Runtime'
if (Get-ScheduledTask -TaskName $taskName -TaskPath '\' -ErrorAction SilentlyContinue) { throw 'Existing task must be reviewed; never overwrite it' }
$taskCode = Join-Path $taskRoot ('runtime-code/' + $ApprovedRevision)
if ((Test-Path -LiteralPath (Join-Path $taskRoot 'runtime-code')) -and ((Get-Item -LiteralPath (Join-Path $taskRoot 'runtime-code')).Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Version directory must not be a junction' }
if (Test-Path -LiteralPath $taskCode) { throw 'Existing installed code is preserved; review before replacing' }
if (-not $PSCmdlet.ShouldProcess($taskName, 'Install owner-only held transport at logon; no learning or App key mount')) { return }
New-Item -ItemType Directory -Path $taskCode | Out-Null
foreach ($taskRelative in $taskFiles) { [IO.File]::WriteAllBytes((Join-Path $taskCode ([IO.Path]::GetFileName($taskRelative))),$taskBytes[$taskRelative]) }
$taskSupervisor = Join-Path $taskCode 'pc-runtime-supervisor.mjs'
& $taskNode $taskSupervisor --check --config $taskConfig
if ($LASTEXITCODE -ne 0) { throw 'Closed held-runtime configuration check failed' }
function Quote-TaskLiteral([string]$value) { return "'" + $value.Replace("'","''") + "'" }
$taskCommand = '& ' + (Quote-TaskLiteral $taskNode) + ' ' + (Quote-TaskLiteral $taskSupervisor) + ' --run-approved-runtime --config ' + (Quote-TaskLiteral $taskConfig) + ' *>> ' + (Quote-TaskLiteral (Join-Path $taskRoot 'runtime-events.log'))
$taskPowershell = Join-Path $env:SystemRoot 'System32/WindowsPowerShell/v1.0/powershell.exe'
$taskAction = New-ScheduledTaskAction -Execute $taskPowershell -Argument ('-NoProfile -NonInteractive -WindowStyle Hidden -Command "' + $taskCommand + '"')
$taskTrigger = New-ScheduledTaskTrigger -AtLogOn -User $taskOwner.Value
$taskPrincipal = New-ScheduledTaskPrincipal -UserId $taskOwner.Value -LogonType Interactive -RunLevel Limited
$taskSettings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -StartWhenAvailable -Hidden
Register-ScheduledTask -TaskName $taskName -TaskPath '\' -Action $taskAction -Trigger $taskTrigger -Principal $taskPrincipal -Settings $taskSettings -Description 'Approved owner-only held Stremio transport. No private learning or publication.' | Out-Null
if ($StartApprovedTransport) {
  # Only the separately approved transport gate changes. No learning/task gate,
  # repository variable, key, feedback or saved ChatGPT task is modified.
  $taskConfiguration.remote_service_enabled = $true
  [IO.File]::WriteAllText($taskConfig,($taskConfiguration | ConvertTo-Json -Depth 10),[Text.UTF8Encoding]::new($false))
  Start-ScheduledTask -TaskName $taskName -TaskPath '\'
}
[PSCustomObject]@{ installed=$true; owner_logon_only=$true; learning_enabled=$false; app_key_mounted=$false; started=[bool]$StartApprovedTransport } | ConvertTo-Json -Compress
