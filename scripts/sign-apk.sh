#!/bin/zsh
set -e

export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"
export PATH="$JAVA_HOME/bin:$PATH"

CWD="/Users/massimilianociconte/Documents/Progetti/sito_palestra/android"
APK_UNSIGNED="$CWD/app/build/outputs/apk/release/app-release-unsigned.apk"
APK_FINAL="$CWD/app/build/outputs/apk/release/gymbro-release.apk"
KEYSTORE="$CWD/app/gymbro-release.keystore"
ALIAS="gymbro"
PASS="gymbro123"

echo "Step 1: Clean slate"
rm -f "$APK_FINAL"

echo "Step 2: Copy APK"
cp "$APK_UNSIGNED" "$APK_FINAL"

echo "Step 3: Sign"
jarsigner -sigalg SHA256withRSA -digestalg SHA-256 -keystore "$KEYSTORE" -storepass "$PASS" "$APK_FINAL" "$ALIAS"

echo "Step 4: zipalign"
Z=""
for f in ~/Library/Android/sdk/build-tools/*/zipalign; do
    if [ -f "$f" ]; then
        Z="$f"
        break
    fi
done

if [ -n "$Z" ]; then
    mv "$APK_FINAL" "${APK_FINAL}.tmp"
    "$Z" -f 4 "${APK_FINAL}.tmp" "$APK_FINAL"
    rm -f "${APK_FINAL}.tmp"
    echo "zipalign done"
else
    echo "zipalign not found"
fi

echo "Step 5: Strip macOS xattr"
xattr -c "$APK_FINAL"

echo ""
echo "=== VERIFY ==="
jarsigner -verify "$APK_FINAL" | head -1

echo ""
echo "=== XATTR ==="
xattr -l "$APK_FINAL" || echo "clean"

echo ""
echo "=== FILE ==="
ls -lh "$APK_FINAL"

echo ""
echo "=== MD5 ==="
md5 -q "$APK_FINAL"

echo ""
echo "=== DONE ==="
echo "APK: $APK_FINAL"
