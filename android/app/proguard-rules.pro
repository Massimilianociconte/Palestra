# P3.36 — ProGuard / R8 rules for release build
# -----------------------------------------------------------
# Preserve stack traces for Crashlytics / issue reports.
-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile
-keepattributes *Annotation*,Signature,InnerClasses,EnclosingMethod

# Capacitor core + bridge reflection
-keep class com.getcapacitor.** { *; }
-keep class com.capacitorjs.** { *; }
-keepclassmembers class * extends com.getcapacitor.Plugin { *; }
-keepclasseswithmembers class * extends com.getcapacitor.Plugin { *; }
-keep @com.getcapacitor.annotation.CapacitorPlugin class * { *; }
-keep @com.getcapacitor.annotation.PluginMethod class * { *; }
-keepclassmembers class * {
    @com.getcapacitor.annotation.PluginMethod <methods>;
}

# Our in-app native plugins/services
-keep class com.gymbro.app.** { *; }

# Firebase / Google APIs reflection
-keep class com.google.firebase.** { *; }
-keep class com.google.android.gms.** { *; }
-keepclasseswithmembers class * {
    @com.google.firebase.firestore.IgnoreExtraProperties <fields>;
}

# WebView JavaScript bridge
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}

# OkHttp (used transitively by Capacitor plugins)
-dontwarn okhttp3.**
-dontwarn okio.**
-keep class okhttp3.** { *; }
-keep class okio.** { *; }

# Keep our Capacitor config/plugin JSON loaders from being renamed
-keepnames class * extends android.app.Service
-keepnames class * extends android.app.Application

# Reflection-based JSON parsing used by Capacitor plugins
-keepclassmembers,allowobfuscation class * {
    @com.google.gson.annotations.SerializedName <fields>;
}
