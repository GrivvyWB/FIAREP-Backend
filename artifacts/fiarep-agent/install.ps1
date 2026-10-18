# FIAREP desktop agent - one-line install for Windows 10 / 11.
# Copy the line from Command Center -> Computers -> Add computer and paste it into
# PowerShell (Start menu -> type "PowerShell" -> Windows PowerShell). It looks like:
#   $env:FIAREP_TOKEN='fca_...'; $env:FIAREP_KEYS='...'; $env:FIAREP_API='https://fiarep.com/api'; irm https://fiarep.com/api/v1/command/agent-files/install.ps1 | iex
# Run it again (without FIAREP_TOKEN) to pin a new phone's Face ID key or update the agent.
# Uninstall: $env:FIAREP_UNINSTALL='1'; irm .../install.ps1 | iex
# No administrator rights needed: it installs for the signed-in Windows user and
# starts at sign-in from Task Scheduler.

& {
  $ErrorActionPreference = 'Stop'
  $Api = if ($env:FIAREP_API) { $env:FIAREP_API.TrimEnd('/') } else { 'https://fiarep.com/api' }
  $Dir = Join-Path $env:USERPROFILE '.fiarep-agent'
  $TaskName = 'FIAREP Agent'
  [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

  function Stop-Agent {
    Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" -ErrorAction SilentlyContinue |
      Where-Object { $_.CommandLine -like '*.fiarep-agent*agent.mjs*' } |
      ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  }

  if ($env:FIAREP_UNINSTALL -eq '1') {
    Stop-Agent
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
    Remove-Item Env:FIAREP_UNINSTALL -ErrorAction SilentlyContinue
    Write-Host "FIAREP agent stopped and removed from startup. Settings left in $Dir."
    return
  }

  function Find-Node {
    $cmd = Get-Command node.exe -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
    foreach ($p in @("$env:ProgramFiles\nodejs\node.exe", "${env:ProgramFiles(x86)}\nodejs\node.exe", "$env:LOCALAPPDATA\Programs\nodejs\node.exe")) { if ($p -and (Test-Path $p)) { return $p } }
    return $null
  }
  $node = Find-Node
  if (-not $node -and (Get-Command winget -ErrorAction SilentlyContinue)) {
    Write-Host 'Installing Node.js LTS (winget)...'
    winget install --id OpenJS.NodeJS.LTS -e --silent --accept-package-agreements --accept-source-agreements | Out-Host
    $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
    $node = Find-Node
  }
  if (-not $node) { throw 'Node.js 20 or newer is needed. Install the LTS version from https://nodejs.org, then paste this line again.' }
  & $node -e "process.exit(Number(process.versions.node.split('.')[0]) >= 20 ? 0 : 1)"
  if ($LASTEXITCODE -ne 0) { throw "Node.js 20 or newer is needed (found $(& $node -v)). Update it from https://nodejs.org, then paste this line again." }

  New-Item -ItemType Directory -Force -Path $Dir | Out-Null
  Write-Host "Downloading the agent from $Api..."
  $new = Join-Path $Dir 'agent.new.mjs'
  Invoke-WebRequest -UseBasicParsing -Uri "$Api/v1/command/agent-files/agent.mjs" -OutFile $new
  & $node --check $new
  if ($LASTEXITCODE -ne 0) { throw 'The downloaded agent did not check out. Try again.' }
  Stop-Agent
  Move-Item -Force $new (Join-Path $Dir 'agent.mjs')

  $env:FIAREP_API = $Api
  & $node (Join-Path $Dir 'agent.mjs') --setup
  if ($LASTEXITCODE -ne 0) { throw 'Could not write the settings file.' }
  # Settings readable by this Windows user only (the token is in it).
  $cfg = Join-Path $Dir 'config.json'
  icacls $cfg /inheritance:r /grant:r "$($env:USERNAME):(R,W)" | Out-Null
  & $node (Join-Path $Dir 'agent.mjs') --check | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'The settings file did not check out.' }
  Remove-Item Env:FIAREP_TOKEN, Env:FIAREP_KEYS -ErrorAction SilentlyContinue

  # Start at sign-in, hidden, restart if it stops.
  $agentPath = Join-Path $Dir 'agent.mjs'
  $logPath = Join-Path $Dir 'agent.log'
  $action = New-ScheduledTaskAction -Execute 'powershell.exe' -WorkingDirectory $Dir `
    -Argument ("-NoProfile -NonInteractive -WindowStyle Hidden -Command `"& '{0}' '{1}' --log '{2}'`"" -f ($node -replace "'", "''"), ($agentPath -replace "'", "''"), ($logPath -replace "'", "''"))
  $trigger = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"
  $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable `
    -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -MultipleInstances IgnoreNew
  $principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited
  Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal `
    -Description 'FIAREP desktop agent: lets your Command Center run the things listed in .fiarep-agent\config.json' -Force | Out-Null
  Start-ScheduledTask -TaskName $TaskName
  Start-Sleep -Seconds 4
  if (Test-Path $logPath) { Get-Content $logPath -Tail 3 }
  Write-Host 'FIAREP agent running. It starts by itself when you sign in to Windows.'
  Write-Host "What it may touch is in $cfg (folders, apps, tasks). Log: $logPath"
}
