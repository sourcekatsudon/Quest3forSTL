. (Join-Path $PSScriptRoot 'quest-v2-lib.ps1')
$materials=Find '^RoomMaterials$'
function Sample {
 $r=(& node $cli browser run tests/animation-sample.mjs --timeout 20000|Out-String)|ConvertFrom-Json
 if(!$r.ok){throw $r.error.message};return $r.data.result
}
function ModelState {Values (Iw 'ecs' 'query' @{entityIndex=$model;components=@('RoomModel')}) 'RoomModel'}
$null=Iw 'xr' 'set-input-mode' @{mode='controller'}
MoveXR .25 1.5 -.4
$existing=(Iw 'ecs' 'find' @{withComponents=@('RoomModel');namePattern='animation-smoke';limit=8}).entities
if(!$existing.Count){
$sample=Sample;$library=Find '^RoomLibrary$'
$targetPage=[int][Math]::Floor($sample.targetIndex/6)
for($i=$sample.page;$i-lt$targetPage;$i++){Click (Point $library '#Next')}
for($i=$sample.page;$i-gt$targetPage;$i--){Click (Point $library '#Previous')}
$item=$sample.targetIndex%6
Click (Point $library "#Item$item" ([int][Math]::Floor($item/2)))
Click (Point $library '#Add')
}
$model=[int](Iw 'ecs' 'find' @{withComponents=@('RoomModel');namePattern='animation-smoke';limit=8}).entities[-1].entityIndex
$initial=ModelState
Check 'VR GLB auto-plays the first of two clips' ($initial.animationCount-eq 2-and$initial.animationPlaying)
$a=Sample;$b=Sample
Check 'animation advances in immersive session' ($b.time-gt$a.time-and[Math]::Abs($b.bone-$a.bone)-gt .00001)
$playPoint=Point $materials '#AnimationPlay' 4
$stopPoint=Point $materials '#AnimationStop' 4
Click $stopPoint
Check 'native stop button changes selected model state' (!(ModelState).animationPlaying)
$stopped=Sample;$still=Sample
Check 'stop holds exact pose and clock' ($stopped.time-eq$still.time-and$stopped.bone-eq$still.bone-and$stopped.morph-eq$still.morph)
Click $playPoint
Check 'native play button resumes selected model' ((ModelState).animationPlaying)
$resumed=Sample
Check 'resumed clock continues instead of resetting' ($resumed.time-gt$stopped.time)
Click (Point $materials '#Glass' 0)
Check 'material change preserves animated model' ((ModelState).materialPreset-eq'glass'-and(ModelState).animationPlaying)
$afterMaterial=Sample
Check 'material change does not stop animated bones' ($afterMaterial.time-gt$resumed.time)
# Pause before measuring grab; the root transform stays independent of animation.
Click $stopPoint
$state=State;$p=(Values $state 'Transform').position
MoveXR $p[0] $p[1] $p[2];Grip 1
Check 'animated GLB remains grabbable' (@((State).components.componentId)-contains'Grabbed')
MoveXR ($p[0]+.06) $p[1] $p[2];Grip 0
Check 'release retains no-gravity behavior' ((Values (State) 'PhysicsBody').state-eq'KINEMATIC')
MoveXR .25 1.5 -.4
# Model moved, so use current UI layout and transform for the next action.
Click (Point $materials '#AnimationPlay' 4)
@{passed=$true;checks=$checks;initial=$a;stopped=$stopped;resumed=$resumed;physicalDeviceTested=$false}|ConvertTo-Json -Depth 7|Set-Content artifacts/animation-xr-results.json
