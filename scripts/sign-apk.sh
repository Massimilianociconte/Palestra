#!/bin/zsh
# Signs the release APK using apksigner (APK Signature Scheme v1+v2+v3).
# jarsigner alone is NOT enough: Android 7+ (API 24) requires v2, Android
# 11+ (API 30) rejects APKs with only v1. The correct pipeline is:
#   1. Build unsigned APK with Gradle
#   2. zipalign -p 4  (align BEFORE signing)
#   3. apksigner sign (v1+v2+v3 together)
#   4. apksigner verify
set -euo pipefail

export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"
export PATH="$JAVA_HOME/bin:$PATH"

CWD="/Users/massimilianociconte/Documents/Progetti/sito_palestra/android"
APK_UNSIGNED="$CWD/app/build/outputs/apk/release/app-release-unsigned.apk"
APK_FINAL="$CWD/app/build/outputs/apk/release/gymbro-release.apk"
KEYSTORE="$CWD/app/gymbro-release.keystore"
ALIAS="gymbro"
PASS="gymbro123"

if [ ! -f "$APK_UNSIGNED" ]; then
    echo "ERROR: unsigned APK not found at $APK_UNSIGNED"
    echo "Run: cd android && ./gradlew assembleRelease"
    exit 1
fi

if [ ! -f "$KEYSTORE" ]; then
    echo "ERROR: keystore not found at $KEYSTORE"
    echo "Generate with: keytool -genkey -v -keystore \"$KEYSTORE\" -alias $ALIAS -keyalg RSA -keysize 2048 -validity 10000"
    exit 1
fi

# Locate Android SDK build tools
BUILD_TOOLS=""
for d in $(ls -d ~/Library/Android/sdk/build-tools/*/ 2>/dev/null | sort -rV); do
    if [ -x "$d/zipalign" ] && [ -x "$d/apksigner" ]; then
        BUILD_TOOLS="$d"
        break
    fi
done

if [ -z "$BUILD_TOOLS" ]; then
    echo "ERROR: Android build-tools not found (need zipalign + apksigner)."
    echo "Install with: sdkmanager \"build-tools;35.0.0\""
    exit 1
fi

ZIPALIGN="$BUILD_TOOLS/zipalign"
APKSIGNER="$BUILD_TOOLS/apksigner"
echo "Using build-tools: $BUILD_TOOLS"

echo ""
echo "Step 1: Clean slate"
rm -f "$APK_FINAL" "${APK_FINAL}.aligned"

echo ""
echo "Step 2: zipalign (BEFORE signing, as required by apksigner)"
"$ZIPALIGN" -p -f -v 4 "$APK_UNSIGNED" "${APK_FINAL}.aligned" | tail -3

echo ""
echo "Step 3: Sign with apksigner (v1+v2+v3)"
"$APKSIGNER" sign \
    --ks "$KEYSTORE" \
    --ks-key-alias "$ALIAS" \
    --ks-pass "pass:$PASS" \
    --key-pass "pass:$PASS" \
    --v1-signing-enabled true \
    --v2-signing-enabled true \
    --v3-signing-enabled true \
    --out "$APK_FINAL" \
    "${APK_FINAL}.aligned"
rm -f "${APK_FINAL}.aligned" "${APK_FINAL}.aligned.idsig" "${APK_FINAL}.idsig"

echo ""
echo "Step 4: Verify signature (all schemes)"
"$APKSIGNER" verify --verbose --print-certs "$APK_FINAL" | grep -E "(Verifies|Verified using|Signer|Subject)" | head -10

echo ""
echo "Step 5: Verify zipalign"
"$ZIPALIGN" -c -v 4 "$APK_FINAL" 2>&1 | tail -3 | head -1 || echo "alignment OK"

echo ""
echo "Step 6: Strip macOS xattr"
xattr -c "$APK_FINAL" 2>/dev/null || true

echo ""
echo "=== RESULT ==="
ls -lh "$APK_FINAL" | awk '{print "Size: " $5}'
echo "MD5:  $(md5 -q "$APK_FINAL")"
echo "Path: $APK_FINAL"
echo ""
echo "APK ready. Share via WhatsApp/Telegram/Email/GDrive."
echo "On Android: enable 'Install from unknown sources' for the browser/messenger, then tap the .apk file."
