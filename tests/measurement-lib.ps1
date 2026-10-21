. (Join-Path $PSScriptRoot 'quest-v2-lib.ps1')
$model=[int](Iw 'ecs' 'find' @{withComponents=@('RoomModel');namePattern='measurement-cube';limit=8}).entities[-1].entityIndex
$panel=Find '^RoomControls$'
function Mode {Values (Iw 'ecs' 'query' @{entityIndex=$panel;components=@('RoomMeasurementMode')}) 'RoomMeasurementMode'}
function ControlPoint($Id,$Measurement=$false){
 $child=(Iw 'ui' 'inspect' @{entityIndex=$panel;selector="#$Id"}).elements[0]
 $x=$child.layout.relativeCenter[0];$y=$child.layout.relativeCenter[1]
 if($Id-ne'Measure'){$parent=(Iw 'ui' 'inspect' @{entityIndex=$panel;selector=$(if($Measurement){'#MeasurementControls'}else{'#NormalControls'})}).elements[0];$x+=$parent.layout.relativeCenter[0];$y+=$parent.layout.relativeCenter[1]}
 $t=Values (Iw 'ecs' 'query' @{entityIndex=$panel;components=@('Transform')}) 'Transform';$q=$t.orientation
 $v=[Numerics.Vector3]::Transform([Numerics.Vector3]::new($x*.01*$t.scale[0],$y*.01*$t.scale[1],0),[Numerics.Quaternion]::new($q[0],$q[1],$q[2],$q[3]))
 return @{x=$t.position[0]+$v.X;y=$t.position[1]+$v.Y;z=$t.position[2]+$v.Z}
}
function Lines {Iw 'ecs' 'find' @{withComponents=@('RoomDimension');limit=100}}
function ControlClick($Id,$Measurement=$false){$target=ControlPoint $Id $Measurement;$null=Iw 'xr' 'look-at' @{device='controller-left';target=$target};$null=Iw 'xr' 'select' @{device='controller-left';duration=.2}}
function Dimensions {foreach($line in (Lines).entities){Values (Iw 'ecs' 'query' @{entityIndex=$line.entityIndex;components=@('RoomDimension')}) 'RoomDimension'}}

