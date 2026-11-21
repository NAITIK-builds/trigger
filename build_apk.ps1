# Build Native Android APK for CamLens
$ErrorActionPreference = "Stop"

$sdk = "C:\Users\naiti\AppData\Local\Android\Sdk"
$buildTools = "$sdk\build-tools\34.0.0"
$androidJar = "$sdk\platforms\android-34\android.jar"
$javaBin = "C:\Program Files\Eclipse Adoptium\jdk-17.0.19.10-hotspot\bin"

Write-Host "[1/6] Compiling Android resources with AAPT2..."
Remove-Item -Recurse -Force -ErrorAction SilentlyContinue "build\classes", "build\dex", "build\compiled_res.zip", "build\base.apk", "build\aligned.apk"
New-Item -ItemType Directory -Force -Path "build\classes", "build\dex" | Out-Null
& "$buildTools\aapt2.exe" compile --dir android_app\res -o build\compiled_res.zip

Write-Host "[2/6] Linking APK resources..."
& "$buildTools\aapt2.exe" link -I $androidJar --manifest android_app\AndroidManifest.xml -o build\base.apk --java android_app\src build\compiled_res.zip --auto-add-overlay

Write-Host "[3/6] Compiling Java source files..."
$javaFiles = (Get-ChildItem -Recurse android_app\src\*.java).FullName
& "$javaBin\javac.exe" -encoding UTF-8 -d build\classes -cp $androidJar $javaFiles

Write-Host "[4/6] Creating Dalvik Executable with D8..."
$classFiles = (Get-ChildItem -Recurse build\classes\*.class).FullName
& "$buildTools\d8.bat" --lib $androidJar --output build\dex $classFiles

Write-Host "[5/6] Packaging classes.dex into APK..."
& "$javaBin\jar.exe" -uf build\base.apk -C build\dex classes.dex

Write-Host "[6/6] Aligning and Signing APK..."
& "$buildTools\zipalign.exe" -f -p 4 build\base.apk build\aligned.apk

if (!(Test-Path "build\debug.keystore")) {
    & "$javaBin\keytool.exe" -genkey -v -keystore build\debug.keystore -storepass android -alias androiddebugkey -keypass android -keyalg RSA -keysize 2048 -validity 10000 -dname "CN=CamLens,O=Android,C=US"
}

& "$buildTools\apksigner.bat" sign --ks build\debug.keystore --ks-pass pass:android --ks-key-alias androiddebugkey --key-pass pass:android --out CamLens.apk build\aligned.apk
Copy-Item -Path "CamLens.apk" -Destination "public\CamLens.apk" -Force | Out-Null

Write-Host "SUCCESS! CamLens.apk generated successfully!"
Get-Item CamLens.apk | Select-Object Name, Length, LastWriteTime
