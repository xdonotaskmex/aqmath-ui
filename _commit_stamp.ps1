$gitExe = "C:\Users\user\AppData\Local\GitHubDesktop\app-3.5.12\resources\app\git\cmd\git.exe"
$repo = "C:\Users\user\OneDrive\Dokumenty\GitHub\aqmath-ui"
& $gitExe -C $repo add -A
& $gitExe -C $repo commit -m "build: refresh asset stamp v=c81dfdf380 across all pages (was stale at v=199db41e4f)"
& $gitExe -C $repo push origin main 2>&1
& $gitExe -C $repo log --oneline -1
