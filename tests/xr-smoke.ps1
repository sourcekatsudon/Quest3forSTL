param([switch]$SkipInstanceLimit)
$ErrorActionPreference = 'Stop'
$workspace = Split-Path $PSScriptRoot -Parent
$cli = Join-Path $workspace 'node_modules/@iwsdk/cli/bin/iwsdk.js'
$artifact = Join-Path $workspace 'artifacts/xr-results.json'
$results = [System.Collections.Generic.List[object]]::new()
$measurements = [ordered]@{}

function Invoke-Iw([string]$Domain, [string]$Action, [hashtable]$InputData = @{}) {
  $arguments = @($cli, $Domain, $Action)
  if ($InputData.Count) { $arguments += @('--input-json', ($InputData | ConvertTo-Json -Depth 14 -Compress)) }
  $output = & node @arguments
  $response = ($output -join "`n") | ConvertFrom-Json
  if (-not $response.ok) { throw "$Domain $Action failed: $($response.error.message)" }
  return $response.data.result
}
function Check([string]$Name, [bool]$Pass, $Evidence) {
  $results.Add([ordered]@{name=$Name;passed=$Pass;evidence=$Evidence})
  if (-not $Pass) { throw "FAILED: $Name" }
  Write-Host "PASS: $Name"
}
function Models { return @( (Invoke-Iw 'ecs' 'find' @{withComponents=@('RoomModel')}).entities ) }
function Model([int]$Index) { return Invoke-Iw 'ecs' 'query' @{entityIndex=$Index;components=@('Transform','RoomModel','PhysicsBody','PhysicsShape','Grabbed')} }
function Values($Entity,[string]$Component) { return @($Entity.components | Where-Object componentId -eq $Component)[0].values }
function Move-XR([string]$Device,[double]$X,[double]$Y,[double]$Z) { $null=Invoke-Iw 'xr' 'animate-to' @{device=$Device;position=@{x=$X;y=$Y;z=$Z};duration=.3} }
function Grip([string]$Hand,[int]$Value) { $null=Invoke-Iw 'xr' 'set-gamepad-state' @{device="controller-$Hand";buttons=@(@{index=1;value=$Value})} }
function Pinch([string]$Hand,[int]$Value) { $null=Invoke-Iw 'xr' 'set-select-value' @{device="hand-$Hand";value=$Value} }
function Click([double]$X,[double]$Y,[double]$Z) {
  $null=Invoke-Iw 'xr' 'look-at' @{device='controller-right';target=@{x=$X;y=$Y;z=$Z}}
  $null=Invoke-Iw 'xr' 'select' @{device='controller-right';duration=.2}
}
function Click-Start {
  $output=& node $cli browser run tests/xr-start.mjs
  $response=($output -join "`n")|ConvertFrom-Json
  if(-not $response.ok){throw "XR start failed: $($response.error.message)"}
}
function Screenshot {
  $output=& node $cli browser screenshot --output-file artifacts/xr-final.png
  $response=($output -join "`n")|ConvertFrom-Json
  if(-not $response.ok){throw "Screenshot failed: $($response.error.message)"}
}

Push-Location $workspace
try {
  $status=Invoke-Iw 'xr' 'status'
  if(-not $status.sessionActive){Click-Start}
  # The CLI permits pose mutation only in an active session. Reset once while
  # active, then enter afresh so panels and the model use a forward-facing home.
  $null=Invoke-Iw 'xr' 'set-device-state' @{state=@{headset=@{position=@{x=0;y=1.6;z=0};orientation=@{x=0;y=0;z=0;w=1}};inputMode='controller'}}
  $null=Invoke-Iw 'xr' 'exit'
  Click-Start
  $status=Invoke-Iw 'xr' 'status'
  Check 'active immersive-ar session in IWER' ($status.sessionActive -and $status.sessionMode -eq 'immersive-ar' -and $status.runtimeKind -eq 'emulated') @{mode=$status.sessionMode;features=$status.enabledFeatures}
  $initial=Models
  Check 'latest library model automatically placed' ($initial.Count -eq 1) @{count=$initial.Count;name=$initial[0].name}
  $index=[int]$initial[0].entityIndex
  $state=Model $index
  $homeTransform=Values $state 'Transform';$room=Values $state 'RoomModel';$body=Values $state 'PhysicsBody'
  $homePosition=@($room.homePosition);$homeScale=[double]$room.homeScale
  Check 'true-size centred initial placement floats safely' ([Math]::Abs($homeTransform.position[2]+1.15)-lt .02 -and $body.gravityFactor -eq 0 -and [Math]::Abs($homeTransform.scale[0]-$homeScale)-lt .001) @{position=$homeTransform.position;scale=$homeTransform.scale;gravity=$body.gravityFactor}
  Check 'two-handed grab and ray components present' ($initial[0].componentIds -contains 'TwoHandsGrabbable' -and $initial[0].componentIds -contains 'RayInteractable') $initial[0].componentIds
  $surfaces=Invoke-Iw 'ecs' 'find' @{withComponents=@('PhysicsBody');namePattern='SafetyFloor|RoomSurface|EnvironmentRaycastSurface'}
  Check 'recognized surfaces and safety floor have physics colliders' ($surfaces.total -ge 2 -and @($surfaces.entities|Where-Object name -eq 'SafetyFloor').Count -eq 1) @($surfaces.entities|Select-Object name,entityIndex)

  Move-XR 'controller-right' $homePosition[0] $homePosition[1] $homePosition[2]
  Grip 'right' 1
  $state=Model $index
  Check 'right controller proximity grab qualifies' (@($state.components.componentId) -contains 'Grabbed') $state.components.componentId
  Move-XR 'controller-right' .25 1.5 -1.15
  $state=Model $index;$moved=Values $state 'Transform'
  Check 'single controller translates model' ($moved.position[0] -gt .17 -and $moved.position[1] -gt 1.4) $moved.position
  Move-XR 'controller-left' .22 1.5 -1.15
  Grip 'left' 1
  Move-XR 'controller-left' .05 1.6 -1.15
  $state=Model $index;$scaled=Values $state 'Transform';$shape=Values $state 'PhysicsShape';$room=Values $state 'RoomModel'
  $scale=[double]$scaled.scale[0]
  Check 'two controllers scale and rotate the same model' ($scale -gt $homeScale*1.5 -and [Math]::Abs($scaled.orientation[2])-gt .02) @{scale=$scaled.scale;orientation=$scaled.orientation}
  $colliderMatches=$true
  for($axis=0;$axis -lt 3;$axis++){if([Math]::Abs($shape.dimensions[$axis]-$room.extents[$axis]*$scale)-gt .025){$colliderMatches=$false}}
  Check 'Havok collider tracks two-handed scaling' $colliderMatches @{scale=$scale;dimensions=$shape.dimensions;sourceExtents=$room.extents}
  Grip 'left' 0;Grip 'right' 0
  Start-Sleep -Milliseconds 2800
  $state=Model $index;$settled=Values $state 'Transform';$body=Values $state 'PhysicsBody'
  Check 'release enables gravity and retains model above safe floor' ($body.gravityFactor -eq 1 -and $settled.position[1] -gt -.2 -and $settled.position[1] -lt 2) @{position=$settled.position;velocity=$body._linearVelocity;gravity=$body.gravityFactor}
  $measurements.controllerManipulation=@{scale=$scale;position=$settled.position;orientation=$scaled.orientation;collider=$shape.dimensions}

  Move-XR 'controller-right' .25 1.45 -.2
  Move-XR 'controller-left' -.3 1.35 -.3
  Click -.62 1.5275 -1
  $state=Model $index;$reset=Values $state 'Transform';$body=Values $state 'PhysicsBody'
  $resetCorrect=[Math]::Abs($reset.scale[0]-$homeScale)-lt .01 -and $body.gravityFactor-eq 0
  for($axis=0;$axis-lt 3;$axis++){if([Math]::Abs($reset.position[$axis]-$homePosition[$axis])-gt .015){$resetCorrect=$false};if([Math]::Abs($body._linearVelocity[$axis])-gt .001){$resetCorrect=$false}}
  Check 'left reset ray restores position scale and zero physics velocity' $resetCorrect @{transform=$reset;velocity=$body._linearVelocity;gravity=$body.gravityFactor}

  $null=Invoke-Iw 'xr' 'set-input-mode' @{mode='hand'}
  Move-XR 'hand-right' $homePosition[0] $homePosition[1] $homePosition[2]
  Pinch 'right' 1
  $state=Model $index
  Check 'hand pinch qualifies as grab' (@($state.components.componentId)-contains 'Grabbed') $state.components.componentId
  Move-XR 'hand-right' .18 1.45 -1.15
  $state=Model $index;$handMoved=Values $state 'Transform'
  Check 'pinched hand translates model' ($handMoved.position[0]-gt .1 -and $handMoved.position[1]-gt 1.37) $handMoved.position
  Pinch 'right' 0
  $null=Invoke-Iw 'xr' 'set-input-mode' @{mode='controller'}
  Move-XR 'controller-right' .25 1.45 -.2
  Click -.62 1.5275 -1
  Screenshot

  Click 1.25 1.58 -.58
  $duplicates=Models
  Check 'right add ray creates a coexisting duplicate' ($duplicates.Count-eq 2 -and @($duplicates|Where-Object entityIndex -eq $index).Count-eq 1) @($duplicates|Select-Object entityIndex,name)
  Click -.62 1.3575 -1
  $afterDelete=Models
  Check 'left delete ray removes only selected instance' ($afterDelete.Count-eq 1 -and $afterDelete[0].entityIndex-eq $index) @($afterDelete|Select-Object entityIndex,name)
  if(-not $SkipInstanceLimit){
    for($added=0;$added-lt 7;$added++){Click 1.25 1.58 -.58}
    $atLimit=Models
    Check 'multiple independent instances reach configured cap' ($atLimit.Count-eq 8) @{count=$atLimit.Count}
    Click 1.25 1.58 -.58
    $afterLimit=Models
    Check 'ninth add safely refuses replacement and allocation' ($afterLimit.Count-eq 8) @{count=$afterLimit.Count}
  }
  $null=Invoke-Iw 'xr' 'exit'
  $remaining=Models
  $resources=Invoke-Iw 'ecs' 'find' @{namePattern='SafetyFloor|RoomSurface|RoomEnvironmentProbe|EnvironmentRaycastSurface|STL '}
  Check 'XR end disposes model and environment entities' ($remaining.Count-eq 0 -and $resources.total-eq 0) @{models=$remaining.Count;remainingResources=$resources.total}
  $final=Invoke-Iw 'xr' 'status'
  Check 'session exits cleanly to desktop' (-not $final.sessionActive) @{active=$final.sessionActive}
  $summary=[ordered]@{passed=$true;runtime='IWSDK IWER Meta Quest 3';assertions=$results;measurements=$measurements;limitations=@('Quest 3 physical device was not tested; real passthrough, physical room planes, and native hand tracking remain unverified.','Total triangle budget guard is statically implemented; this fixture validates the 8-instance cap with 12-triangle models.');screenshot='artifacts/xr-final.png'}
  $summary|ConvertTo-Json -Depth 16|Set-Content -LiteralPath $artifact -Encoding utf8
  Write-Host "XR smoke passed: $($results.Count) assertions. Results: artifacts/xr-results.json"
} catch {
  $failure=$_.Exception.Message
  [ordered]@{passed=$false;error=$failure;assertions=$results;measurements=$measurements}|ConvertTo-Json -Depth 16|Set-Content -LiteralPath $artifact -Encoding utf8
  try{$null=Invoke-Iw 'xr' 'exit'}catch{}
  throw
} finally { Pop-Location }


