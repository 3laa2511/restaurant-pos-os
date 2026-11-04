[CmdletBinding()]
param([ValidateSet("both","global","project")][string]$Scope="both",[switch]$Force)
$ErrorActionPreference="Stop"
$RepoUrl="https://github.com/Jakeschincariol/replica-skill.git"
$ReplicaCommit="77c9436fb3d18c3d58169efb8caf4fe906b0dc51"
$ProjectRoot=(Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$TempRoot=Join-Path ([IO.Path]::GetTempPath()) ("replica-skill-"+[guid]::NewGuid())
if (-not (Get-Command git -ErrorAction SilentlyContinue)) { throw "Git for Windows is required." }
try {
  git clone --quiet --no-checkout $RepoUrl $TempRoot
  if ($LASTEXITCODE -ne 0) { throw "git clone failed: $LASTEXITCODE" }
  git -C $TempRoot checkout --quiet $ReplicaCommit
  if ($LASTEXITCODE -ne 0) { throw "git checkout failed: $LASTEXITCODE" }
  $Sources=@(Get-ChildItem -Path $TempRoot -Directory -Filter "replica-*")
  if ($Sources.Count -ne 11) { throw "Expected 11 Replica skill folders; found $($Sources.Count)." }
  function Install-To([string]$Destination) {
    New-Item -ItemType Directory -Force -Path $Destination | Out-Null
    $Installed=0
    foreach($Source in $Sources) {
      $Target=Join-Path $Destination $Source.Name
      if(Test-Path $Target) { if($Force) { Remove-Item -Recurse -Force $Target } else { Write-Host "SKIP existing $Target"; continue } }
      Copy-Item -Recurse $Source.FullName $Target; $Installed++
    }
    Write-Host "Installed $Installed skill folders into $Destination"
  }
  if($Scope -in @("both","global")) { Install-To (Join-Path $HOME ".claude/skills") }
  if($Scope -in @("both","project")) { Install-To (Join-Path $ProjectRoot ".claude/skills") }
  if(Get-Command python -ErrorAction SilentlyContinue) { python --version }
  elseif(Get-Command python3 -ErrorAction SilentlyContinue) { python3 --version }
  else { Write-Warning "Python 3.8+ needed by some helper scripts." }
  Write-Host "Reload Claude Code and verify /replica-* skills."
} finally { if(Test-Path $TempRoot) { Remove-Item -Recurse -Force $TempRoot } }
