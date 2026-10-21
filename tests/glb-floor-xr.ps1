. "$PSScriptRoot/quest-v2-lib.ps1"
$model=Find '^STL glb-floor-smoke-';$panel=Find '^RoomControls$'
$null=Iw 'xr' 'set-input-mode' @{mode='controller'}
$null=Iw 'xr' 'animate-to' @{device='controller-left';position=@{x=-.25;y=1.5;z=-.4};duration=.3}
function LeftAim($Target){$null=Iw 'xr' 'look-at' @{device='controller-left';target=$Target}}
function LeftClick($Target){LeftAim $Target;$null=Iw 'xr' 'select' @{device='controller-left';duration=.2}}
$initial=State
Check 'GLB exposes two parts in XR' ((Values $initial 'RoomModel').partCount -eq 2)
Check 'default gravity remains off' (!(Values $initial 'RoomModel').gravity)
LeftClick (Point $panel '#Gravity')
$fallen=State;$fallenRoom=Values $fallen 'RoomModel';$fallenTransform=Values $fallen 'Transform'
Check 'native left-panel gravity button enables floor gravity' $fallenRoom.gravity
$halfHeight=$fallenRoom.extents[1]*$fallenTransform.scale[1]/2
Check 'model falls through overlapping model to floor y=0' ([Math]::Abs($fallenTransform.position[1]-$halfHeight)-lt .003)
Check 'model native body stays kinematic without collision response' ((Values $fallen 'PhysicsBody').state -eq 'KINEMATIC')
$null=Iw 'ecs' 'pause'
try{
 $null=Iw 'ecs' 'snapshot' @{label='floor-before'}
 $null=Iw 'ecs' 'step' @{count=8;delta=.016}
 $null=Iw 'ecs' 'snapshot' @{label='floor-after'}
 $evidence.diff=Iw 'ecs' 'diff' @{from='floor-before';to='floor-after'}
 $settled=State
 Check 'floor rest is stable over eight stepped frames' ([Math]::Abs((Values $settled 'Transform').position[1]-$fallenTransform.position[1])-lt .0001)
}finally{$null=Iw 'ecs' 'resume'}
LeftClick (Point $panel '#Gravity')
LeftClick (Point $panel '#Reset')
LeftClick (Point $panel '#Explode')
function SliderPoint($Fraction){
 $e=(Iw 'ui' 'inspect' @{entityIndex=$panel;selector='#ExplosionSlider'}).elements[0]
 $a=(Iw 'ui' 'inspect' @{entityIndex=$panel;selector='#ExplosionControls'}).elements[0]
 $b=(Iw 'ui' 'inspect' @{entityIndex=$panel;selector='#NormalControls'}).elements[0]
 $t=Values (Iw 'ecs' 'query' @{entityIndex=$panel;components=@('Transform')}) 'Transform';$q=$t.orientation
 $x=$e.layout.relativeCenter[0]+($Fraction-.5)*$e.layout.size[0]+$a.layout.relativeCenter[0]+$b.layout.relativeCenter[0]
 $y=$e.layout.relativeCenter[1]+$a.layout.relativeCenter[1]+$b.layout.relativeCenter[1]
 $v=[System.Numerics.Vector3]::new($x*.01*$t.scale[0],$y*.01*$t.scale[1],0)
 $v=[System.Numerics.Vector3]::Transform($v,[System.Numerics.Quaternion]::new($q[0],$q[1],$q[2],$q[3]))
 return @{x=$t.position[0]+$v.X;y=$t.position[1]+$v.Y;z=$t.position[2]+$v.Z}
}
LeftAim (SliderPoint .25)
$null=Iw 'xr' 'set-gamepad-state' @{device='controller-left';buttons=@(@{index=0;value=1})}
try{LeftAim (SliderPoint 1.15);$expanded=State}finally{$null=Iw 'xr' 'set-gamepad-state' @{device='controller-left';buttons=@(@{index=0;value=0})}}
Check 'native slider explodes multi-mesh GLB to 100 percent' ((Values $expanded 'RoomModel').explosion-gt .99)
$shape=Values $expanded 'PhysicsShape';$transform=Values $expanded 'Transform'
Check 'exploded GLB keeps its viewing envelope' ([Math]::Abs(($shape.dimensions|Measure-Object -Maximum).Maximum-.28)-lt .002)
LeftClick (Point $panel '#Reset')
$restored=State
Check 'reset restores assembled GLB' ((Values $restored 'RoomModel').explosion-eq 0)
MoveXR 0 1.55 -.6;Grip 1
try{
 $held=State
 Check 'normal native grabbing remains available' (@($held.components|Where-Object componentId -eq 'Grabbed').Count-eq 1)
 MoveXR .18 1.6 -.6
 $moved=State
 Check 'held GLB follows the controller' ((Values $moved 'Transform').position[0]-gt .1)
}finally{Grip 0}
$released=State
Check 'release retains non-colliding kinematic body' ((Values $released 'PhysicsBody').state-eq 'KINEMATIC')
$evidence.initial=$initial;$evidence.fallen=$fallen;$evidence.expanded=$expanded;$evidence.released=$released
@{passed=$true;checks=$checks.ToArray();evidence=$evidence}|ConvertTo-Json -Depth 30|Set-Content -Encoding UTF8 artifacts/glb-floor-xr-results.json
& node $cli browser screenshot --output-file artifacts/glb-floor-xr-final.png | Out-Null
