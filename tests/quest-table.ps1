. ./tests/quest-v2-lib.ps1
function WorldVector($Vector,$Transform){$q=$Transform.orientation;$rot=[System.Numerics.Quaternion]::new($q[0],$q[1],$q[2],$q[3]);$v=[System.Numerics.Vector3]::Transform([System.Numerics.Vector3]::new($Vector[0],$Vector[1],$Vector[2]),$rot);return @(($v.X+$Transform.position[0]),($v.Y+$Transform.position[1]),($v.Z+$Transform.position[2]))}
$roomData=Get-Content artifacts/quest-room-meshes.json -Raw|ConvertFrom-Json
$tables=foreach($entity in $roomData){
 $mesh=Values $entity 'XRMesh';if($mesh.semanticLabel -ne 'table'){continue};$pose=Values $entity 'Transform'
 $corners=foreach($x in @($mesh.min[0],$mesh.max[0])){foreach($y in @($mesh.min[1],$mesh.max[1])){foreach($z in @($mesh.min[2],$mesh.max[2])){,$(WorldVector @($x,$y,$z) $pose)}}}
 $xs=$corners|ForEach-Object {$_[0]};$ys=$corners|ForEach-Object {$_[1]};$zs=$corners|ForEach-Object {$_[2]}
 $x=(($xs|Measure-Object -Minimum).Minimum+($xs|Measure-Object -Maximum).Maximum)/2;$z=(($zs|Measure-Object -Minimum).Minimum+($zs|Measure-Object -Maximum).Maximum)/2
 [pscustomobject]@{id=$entity.entityIndex;x=$x;z=$z;top=($ys|Measure-Object -Maximum).Maximum;distance=$x*$x+$z*$z}
}
$table=$tables|Sort-Object distance|Select-Object -First 1
$model=[int]((Iw 'ecs' 'find' @{withComponents=@('RoomModel')}).entities|Sort-Object entityIndex -Descending|Select-Object -First 1).entityIndex
$state=State;$pose=Values $state 'Transform';$p=$pose.position;$offset=-.5*$pose.scale[0]
MoveXR ($p[0]+$offset) $p[1] $p[2];Grip 1
$model=[int](Iw 'ecs' 'find' @{withComponents=@('RoomModel','Grabbed')}).entities[0].entityIndex
Check 'grabbed the model for desk contact test' (@((State).components|Where-Object componentId -eq 'Grabbed').Count -eq 1)
MoveXR ($table.x+$offset) ($table.top+.25) $table.z
$above=State
MoveXR ($table.x+$offset) ($table.top-.2) $table.z
$contact=State;$pose=Values $contact 'Transform';$room=Values $contact 'RoomModel';$bottom=$pose.position[1]-$room.extents[1]*$pose.scale[0]/2
Check 'held model cannot be pushed through a scanned tabletop' ($bottom -ge $table.top-.015)
Grip 0
$released=State
$before=Values $released 'Transform'
$null=Iw 'ecs' 'pause';$null=Iw 'ecs' 'snapshot' @{label='desk-before'};$null=Iw 'ecs' 'step' @{count=8;delta=.016};$null=Iw 'ecs' 'snapshot' @{label='desk-after'};$diff=Iw 'ecs' 'diff' @{from='desk-before';to='desk-after'};$null=Iw 'ecs' 'resume'
$after=State
Check 'released model stays above the table with gravity OFF' ([Math]::Abs((Values $after 'Transform').position[1]-$before.position[1])-lt .004)
$null=Iw 'xr' 'animate-to' @{device='headset';position=@{x=3;y=1.6;z=0};duration=.3}
$walked=State
Check 'moving across the room does not pull the model back to the user' ([Math]::Abs((Values $walked 'Transform').position[0]-$before.position[0])-lt .004)
$null=Iw 'xr' 'animate-to' @{device='headset';position=@{x=0;y=1.6;z=0};duration=.3}
@{passed=$true;checks=$checks.ToArray();table=$table;above=$above;contact=$contact;released=$released;after=$after;walked=$walked;diff=$diff}|ConvertTo-Json -Depth 30|Set-Content -Encoding UTF8 artifacts/quest-table-results.json
