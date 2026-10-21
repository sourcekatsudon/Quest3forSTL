. (Join-Path $PSScriptRoot 'measurement-lib.ps1')
function Sample($File){$r=(& node $cli browser run $File --timeout 30000|Out-String)|ConvertFrom-Json;if(!$r.ok){throw $r.error.message};return $r.data.result}
$p=(Values (State) 'Transform').position
Aim @{x=$p[0]-.03;y=$p[1];z=$p[2]+.05};$null=Iw 'xr' 'select' @{device='controller-right';duration=.2}
Aim @{x=$p[0]+.03;y=$p[1];z=$p[2]+.05};$null=Iw 'xr' 'select' @{device='controller-right';duration=.2}
Check 'a new line can be added after resetting every prior dimension' ((Lines).total-eq 1)
ControlClick 'Measure'
MoveXR ($p[0]+.03) $p[1] $p[2]
$null=Iw 'xr' 'animate-to' @{device='controller-left';position=@{x=$p[0]-.03;y=$p[1];z=$p[2]};duration=.3}
$null=Iw 'xr' 'set-gamepad-state' @{device='controller-left';buttons=@(@{index=1;value=1})};Grip 1
MoveXR ($p[0]+.09) $p[1] $p[2]
$scaled=State
Check 'native two-hand scaling is restored outside measurement mode' ((Values $scaled 'Transform').scale[0]-gt 1.8)
Grip 0;$null=Iw 'xr' 'set-gamepad-state' @{device='controller-left';buttons=@(@{index=1;value=0})}
$dimension=@(Dimensions)[0]
Check 'enlarging the display preserves original 60 mm distance' ([Math]::Abs($dimension.millimetres-60)-lt .5)
$visual=Sample 'tests/measurement-sample.mjs';$line=$visual.lines[0]
$worldLength=[Math]::Sqrt([Math]::Pow($line.a[0]-$line.b[0],2)+[Math]::Pow($line.a[1]-$line.b[1],2)+[Math]::Pow($line.a[2]-$line.b[2],2))
Check 'cord follows the visually enlarged endpoints' ($worldLength-gt .105)
MoveXR .25 1.5 -.4
$null=Iw 'xr' 'animate-to' @{device='controller-left';position=@{x=-.25;y=1.5;z=-.4};duration=.3}
$setup=Sample 'tests/measurement-animated-setup.mjs'
ControlClick 'Measure'
$frozen=Sample 'tests/measurement-animation-state.mjs';$still=Sample 'tests/measurement-animation-state.mjs'
Check 'measurement pauses the animated GLB clock and pose' (!$frozen.playing-and$frozen.time-eq$still.time)
Check 'measurement surface matches the actual skinned and morphed pose' ($frozen.proxyMeshes-gt0-and$frozen.maxPoseError-lt .00001)
ControlClick 'Measure'
$resumed=Sample 'tests/measurement-animation-state.mjs'
Check 'leaving mode resumes animation from the stopped time' ($resumed.playing-and$resumed.time-gt$frozen.time)
@{passed=$true;checks=$checks;dimension=$dimension;worldCordLength=$worldLength;animationFrozen=$frozen;animationResumed=$resumed}|ConvertTo-Json -Depth 7|Set-Content artifacts/measurement-followup-results.json
