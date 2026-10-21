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
