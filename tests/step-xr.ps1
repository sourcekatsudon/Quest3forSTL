$ErrorActionPreference='Stop'
$cli=Join-Path (Get-Location) 'node_modules/@iwsdk/cli/bin/iwsdk.js'
function Iw($Domain,$Action,$Data=@{}){
 $arguments=@($cli,$Domain,$Action);if($Data.Count){$arguments+=@('--input-json',($Data|ConvertTo-Json -Depth 12 -Compress))}
 $result=(& node @arguments|Out-String)|ConvertFrom-Json;if(!$result.ok){throw $result.error.message};return $result.data.result
}
function Values($State,$Component){return @($State.components|Where-Object componentId -eq $Component)[0].values}
function Check($Name,$Passed){if(!$Passed){throw "FAILED: $Name"};$checks.Add($Name);Write-Host "PASS: $Name"}
function State {return Iw 'ecs' 'query' @{entityIndex=$model;components=@('RoomModel','Transform','PhysicsShape','Grabbed')}}
function Point($Selector,$Fraction=.5,$Nested=$false){
 $element=(Iw 'ui' 'inspect' @{entityIndex=$panel;selector=$Selector}).elements[0]
 $x=$element.layout.relativeCenter[0]+($Fraction-.5)*$element.layout.size[0];$y=$element.layout.relativeCenter[1]
 if($Nested){$parent=(Iw 'ui' 'inspect' @{entityIndex=$panel;selector='#ExplosionControls'}).elements[0];$x+=$parent.layout.relativeCenter[0];$y+=$parent.layout.relativeCenter[1]}
 $transform=Values (Iw 'ecs' 'query' @{entityIndex=$panel;components=@('Transform')}) 'Transform'
 $q=$transform.orientation;$v=[System.Numerics.Vector3]::new($x*.01,$y*.01,0);$quat=[System.Numerics.Quaternion]::new($q[0],$q[1],$q[2],$q[3]);$v=[System.Numerics.Vector3]::Transform($v,$quat)
 return @{x=$transform.position[0]+$v.X;y=$transform.position[1]+$v.Y;z=$transform.position[2]+$v.Z}
}
function Aim($Target){$null=Iw 'xr' 'look-at' @{device='controller-right';target=$Target}}
function Click($Target){Aim $Target;$null=Iw 'xr' 'select' @{device='controller-right';duration=.2}}
$checks=[System.Collections.Generic.List[string]]::new()
$model=[int](Iw 'ecs' 'find' @{withComponents=@('RoomModel');namePattern='XR-assembly'}).entities[0].entityIndex
$panel=[int](Iw 'ecs' 'find' @{namePattern='^RoomControls$'}).entities[0].entityIndex
$null=Iw 'xr' 'set-gamepad-state' @{device='controller-right';buttons=@(@{index=0;value=0},@{index=1;value=0})}
$null=Iw 'xr' 'animate-to' @{device='controller-right';position=@{x=.25;y=1.5;z=-.4};duration=.3}
$initial=State;$room=Values $initial 'RoomModel'
Check '18 STEP parts in one grabbable assembly' ($room.partCount -eq 18)
if(!$room.explosionOpen){Click (Point '#Explode')}
Click (Point '#ExplosionSlider' .001 $true)
$zero=State;Check 'ray sets slider to assembled 0 percent' ((Values $zero 'RoomModel').explosion -eq 0)
Aim (Point '#ExplosionSlider' .25 $true)
$null=Iw 'xr' 'set-gamepad-state' @{device='controller-right';buttons=@(@{index=0;value=1})}
Aim (Point '#ExplosionSlider' 1.15 $true)
$expanded=State;$room=Values $expanded 'RoomModel'
Check 'held trigger drags native slider to 100 percent' ($room.explosion -gt .99)
$null=Iw 'xr' 'set-gamepad-state' @{device='controller-right';buttons=@(@{index=0;value=0})}
$shape=Values $expanded 'PhysicsShape';$transform=Values $expanded 'Transform'
Check 'expanded geometry bounds and whole-assembly collider agree' ([Math]::Abs($shape.dimensions[0]-$room.extents[0]*$transform.scale[0])-lt .001)
Check 'explosion preserves the viewing envelope' ([Math]::Abs(($shape.dimensions|Measure-Object -Maximum).Maximum-.28)-lt .002)
& node $cli browser screenshot --output-file artifacts/step-xr-exploded.png | Out-Null
$modelPosition=$transform.position
$geometryInput=@{id=$room.assetId;scale=$transform.scale[0];position=$modelPosition}|ConvertTo-Json -Compress
$gripTarget=(& npx tsx tests/step-grab-target.mts $geometryInput|Out-String)|ConvertFrom-Json
$null=Iw 'xr' 'animate-to' @{device='controller-right';position=@{x=$gripTarget.x;y=$gripTarget.y;z=$gripTarget.z};duration=.3}
$null=Iw 'xr' 'set-gamepad-state' @{device='controller-right';buttons=@(@{index=1;value=1})}
$held=State
Check 'exploded assembly can still be grabbed by grip' (@($held.components|Where-Object componentId -eq 'Grabbed').Count -eq 1)
$null=Iw 'xr' 'animate-to' @{device='controller-right';position=@{x=$gripTarget.x+.15;y=$gripTarget.y+.05;z=$gripTarget.z};duration=.3}
$moved=State
Check 'all parts move through the shared assembly parent' ((Values $moved 'Transform').position[0]-gt $modelPosition[0]+.1)
$null=Iw 'xr' 'set-gamepad-state' @{device='controller-right';buttons=@(@{index=1;value=0})}
$null=Iw 'xr' 'animate-to' @{device='controller-right';position=@{x=.25;y=1.5;z=-.4};duration=.3}
Click (Point '#Reset')
$reset=State;$room=Values $reset 'RoomModel'
Check 'reset restores assembly and closes slider' ($room.explosion -eq 0 -and !$room.explosionOpen)
Check 'reset restores original model scale' ([Math]::Abs((Values $reset 'Transform').scale[0]-$room.homeScale)-lt .00001)
@{passed=$true;checks=$checks.ToArray();assembled=$zero;exploded=$expanded;held=$held;moved=$moved;reset=$reset}|ConvertTo-Json -Depth 20|Set-Content -Encoding UTF8 artifacts/step-xr-results.json


