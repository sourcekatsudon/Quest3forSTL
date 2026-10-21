$ErrorActionPreference='Stop'
$cli=Join-Path (Get-Location) 'node_modules/@iwsdk/cli/bin/iwsdk.js'
$checks=[System.Collections.Generic.List[string]]::new();$evidence=[ordered]@{}
function Iw($D,$A,$Data=@{}){$arg=@($cli,$D,$A);if($Data.Count){$arg+=@('--input-json',($Data|ConvertTo-Json -Depth 12 -Compress))};$r=(& node @arg|Out-String)|ConvertFrom-Json;if(!$r.ok){throw $r.error.message};return $r.data.result}
function Values($State,$Component){return @($State.components|Where-Object componentId -eq $Component)[0].values}
function State {Iw 'ecs' 'query' @{entityIndex=$model;components=@('RoomModel','Transform','PhysicsBody','PhysicsShape','Grabbed')}}
function Check($Name,$Passed){if(!$Passed){throw "FAILED: $Name"};$checks.Add($Name);Write-Host "PASS: $Name"}
function Find($Name){return [int](Iw 'ecs' 'find' @{namePattern=$Name;limit=5}).entities[0].entityIndex}
function Point($Panel,$Selector,$Row=-1){
 $element=(Iw 'ui' 'inspect' @{entityIndex=$Panel;selector=$Selector}).elements[0];$x=$element.layout.relativeCenter[0];$y=$element.layout.relativeCenter[1]
 if($Selector -in @('#Reset','#ActualSize','#Delete','#Gravity','#Recall','#Explode')){$normal=(Iw 'ui' 'inspect' @{entityIndex=$Panel;selector='#NormalControls'}).elements[0];$x+=$normal.layout.relativeCenter[0];$y+=$normal.layout.relativeCenter[1]}
 if($Row-ge 0){$parent=(Iw 'ui' 'inspect' @{entityIndex=$Panel;selector='.row'}).elements[$Row];$x+=$parent.layout.relativeCenter[0];$y+=$parent.layout.relativeCenter[1]}
 $t=Values (Iw 'ecs' 'query' @{entityIndex=$Panel;components=@('Transform')}) 'Transform';$q=$t.orientation
 $v=[System.Numerics.Vector3]::new($x*.01*$t.scale[0],$y*.01*$t.scale[1],0);$rot=[System.Numerics.Quaternion]::new($q[0],$q[1],$q[2],$q[3]);$v=[System.Numerics.Vector3]::Transform($v,$rot)
 return @{x=$t.position[0]+$v.X;y=$t.position[1]+$v.Y;z=$t.position[2]+$v.Z}
}
function Aim($Target){$null=Iw 'xr' 'look-at' @{device='controller-right';target=$Target}}
function Click($Target){Aim $Target;$null=Iw 'xr' 'select' @{device='controller-right';duration=.2}}
function Grip($Value){$null=Iw 'xr' 'set-gamepad-state' @{device='controller-right';buttons=@(@{index=1;value=$Value})}}
function MoveXR([double]$X,[double]$Y,[double]$Z){$null=Iw 'xr' 'animate-to' @{device='controller-right';position=@{x=$X;y=$Y;z=$Z};duration=.3}}
$model=[int](Iw 'ecs' 'find' @{withComponents=@('RoomModel')}).entities[0].entityIndex
$controls=Find '^RoomControls$';$library=Find '^RoomLibrary$';$materials=Find '^RoomMaterials$'
MoveXR .25 1.5 -.4
Click (Point $controls '#Reset')
$state=State;$room=Values $state 'RoomModel';$transform=Values $state 'Transform';$body=Values $state 'PhysicsBody';$evidence.initial=$state
Check 'new object appears about 60 cm in front of eyes' ([Math]::Abs($transform.position[2]+.6)-lt .02 -and [Math]::Abs($transform.position[1]-1.55)-lt .03)
Check 'new object defaults to gravity OFF and a stationary body' (!$room.gravity -and $body.gravityFactor -eq 0 -and $body.state -eq 'KINEMATIC')
$pos=$transform.position;$offset=-.5*$transform.scale[0]
MoveXR ($pos[0]+$offset) $pos[1] $pos[2];Grip 1
$held=State;Check 'GLB remains grabbable with gravity disabled' (@($held.components|Where-Object componentId -eq 'Grabbed').Count -eq 1)
MoveXR ($pos[0]+$offset+.12) ($pos[1]+.04) $pos[2];Grip 0
$released=State;$null=Iw 'ui' 'inspect' @{entityIndex=$controls;selector='#Gravity'};$stable=State
$a=Values $released 'Transform';$b=Values $stable 'Transform'
Check 'released gravity-OFF object stays in its new position' ([Math]::Abs($a.position[0]-$b.position[0])-lt .003 -and [Math]::Abs($a.position[1]-$b.position[1])-lt .003)
$evidence.released=$released;$evidence.stable=$stable
MoveXR .25 1.5 -.4
Click (Point $controls '#Gravity');$falling=State
Check 'gravity toggle enables simulation and falling' ((Values $falling 'RoomModel').gravity -and (Values $falling 'PhysicsBody').gravityFactor -eq 1 -and (Values $falling 'Transform').position[1]-lt $b.position[1]-.02)
$null=Iw 'ecs' 'pause';$null=Iw 'ecs' 'snapshot' @{label='quest-gravity-before'};$null=Iw 'ecs' 'step' @{count=8;delta=.016};$null=Iw 'ecs' 'snapshot' @{label='quest-gravity-after'};$evidence.physicsDiff=Iw 'ecs' 'diff' @{from='quest-gravity-before';to='quest-gravity-after'};$null=Iw 'ecs' 'resume'
Click (Point $controls '#Gravity');MoveXR .25 1.5 -.4
Click (Point $controls '#Reset');$reset=State
Check 'gravity OFF and reset restore a floating object' (!(Values $reset 'RoomModel').gravity -and (Values $reset 'PhysicsBody').state -eq 'KINEMATIC')
foreach($preset in @(@('Glass','glass',0),@('Aluminum','aluminum',0),@('SUS','sus',1),@('Plastic','plastic',1))){Click (Point $materials "#$($preset[0])" $preset[2]);Check "surface preset $($preset[1])" ((Values (State) 'RoomModel').materialPreset -eq $preset[1])}
Click (Point $materials '#Color4' 3);Check 'object color selection' ((Values (State) 'RoomModel').tint -eq '#d6ad44')
Click (Point $materials '#SUS' 1)
$before=(Iw 'ecs' 'find' @{withComponents=@('RoomModel')}).total
$target=Point $library '#Item0' 0;Aim $target
$null=Iw 'xr' 'set-gamepad-state' @{device='controller-right';buttons=@(@{index=0;value=1})}
Aim @{x=$target.x-.4;y=$target.y+.05;z=$target.z+.2}
$null=Iw 'xr' 'set-gamepad-state' @{device='controller-right';buttons=@(@{index=0;value=0})}
$models=Iw 'ecs' 'find' @{withComponents=@('RoomModel')}
Check 'thumbnail drag and drop adds one object' ($models.total -eq $before+1)
$meshEntities=(Iw 'ecs' 'find' @{withComponents=@('XRMesh');limit=32}).entities
$colliders=0;foreach($entity in $meshEntities){if($entity.componentIds -contains 'PhysicsShape' -and $entity.componentIds -contains 'PhysicsBody'){$colliders++}}
Check 'scanned room meshes have real physics colliders' ($colliders -gt 0)
$evidence.roomMeshColliders=$colliders
$null=Iw 'browser' 'logs' @{count=12}
& node $cli browser screenshot --output-file artifacts/quest-v2-final.png | Out-Null
@{passed=$true;checks=$checks.ToArray();evidence=$evidence}|ConvertTo-Json -Depth 30|Set-Content -Encoding UTF8 artifacts/quest-v2-results.json
