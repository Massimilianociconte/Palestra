package com.gymbro.app;

import android.os.Bundle;
import android.view.View;
import android.webkit.WebSettings;
import android.webkit.WebView;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.graphics.Insets;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        // Register the TimerPlugin before calling super
        registerPlugin(TimerPlugin.class);

        super.onCreate(savedInstanceState);

        // Apply window insets to prevent content from going under status bar
        View rootView = findViewById(android.R.id.content);
        ViewCompat.setOnApplyWindowInsetsListener(rootView, (view, windowInsets) -> {
            Insets insets = windowInsets.getInsets(WindowInsetsCompat.Type.systemBars());
            view.setPadding(insets.left, insets.top, insets.right, insets.bottom);
            return WindowInsetsCompat.CONSUMED;
        });

        // P2.27 — WebView hardening
        try {
            WebView webView = this.getBridge().getWebView();
            if (webView != null) {
                WebSettings s = webView.getSettings();
                // Never allow mixed content (http inside https webapp).
                s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
                // Disable direct access to files and content URIs (prevents
                // malicious pages from reading app-private files).
                s.setAllowFileAccess(false);
                s.setAllowContentAccess(false);
                // These are deprecated but defensive defaults on older devices.
                s.setAllowFileAccessFromFileURLs(false);
                s.setAllowUniversalAccessFromFileURLs(false);
                // Enable Google Safe Browsing for the webview.
                try { s.setSafeBrowsingEnabled(true); } catch (Throwable ignored) {}
                // Make sure DOM storage is on (the app relies on localStorage).
                s.setDomStorageEnabled(true);
            }
        } catch (Throwable t) {
            android.util.Log.w("MainActivity", "WebView hardening failed: " + t.getMessage());
        }
    }
}
