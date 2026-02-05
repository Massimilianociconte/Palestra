package com.gymbro.app;

import android.Manifest;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.ServiceConnection;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.IBinder;
import android.util.Log;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import com.getcapacitor.PermissionState;

@CapacitorPlugin(
    name = "TimerNotification",
    permissions = {
        @Permission(
            alias = "notifications",
            strings = { Manifest.permission.POST_NOTIFICATIONS }
        )
    }
)
public class TimerPlugin extends Plugin {
    
    private static final String TAG = "TimerPlugin";
    
    private TimerService timerService;
    private boolean isBound = false;
    
    private ServiceConnection serviceConnection = new ServiceConnection() {
        @Override
        public void onServiceConnected(ComponentName name, IBinder service) {
            TimerService.TimerBinder binder = (TimerService.TimerBinder) service;
            timerService = binder.getService();
            isBound = true;
        }
        
        @Override
        public void onServiceDisconnected(ComponentName name) {
            timerService = null;
            isBound = false;
        }
    };
    
    @Override
    public void load() {
        // Bind to the service when plugin loads
        Intent intent = new Intent(getContext(), TimerService.class);
        getContext().bindService(intent, serviceConnection, Context.BIND_AUTO_CREATE);
        Log.d(TAG, "TimerPlugin loaded and service binding initiated");
    }
    
    @PluginMethod
    public void requestPermission(PluginCall call) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            if (getPermissionState("notifications") != PermissionState.GRANTED) {
                requestPermissionForAlias("notifications", call, "notificationPermissionCallback");
            } else {
                JSObject ret = new JSObject();
                ret.put("granted", true);
                call.resolve(ret);
            }
        } else {
            // Permission not needed for older Android versions
            JSObject ret = new JSObject();
            ret.put("granted", true);
            call.resolve(ret);
        }
    }
    
    @PermissionCallback
    private void notificationPermissionCallback(PluginCall call) {
        if (getPermissionState("notifications") == PermissionState.GRANTED) {
            JSObject ret = new JSObject();
            ret.put("granted", true);
            call.resolve(ret);
        } else {
            JSObject ret = new JSObject();
            ret.put("granted", false);
            call.resolve(ret);
        }
    }
    
    @PluginMethod
    public void startTimer(PluginCall call) {
        Log.d(TAG, "startTimer called");
        
        int seconds = call.getInt("seconds", 90);
        String exercise = call.getString("exercise", "Prossimo esercizio");
        String workout = call.getString("workout", "Allenamento");
        
        Log.d(TAG, "Timer params: " + seconds + "s, exercise: " + exercise + ", workout: " + workout);
        
        // Check notification permission for Android 13+
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            if (ContextCompat.checkSelfPermission(getContext(), Manifest.permission.POST_NOTIFICATIONS) 
                    != PackageManager.PERMISSION_GRANTED) {
                Log.w(TAG, "Notification permission not granted, requesting...");
                // Request permission but still try to start timer
                ActivityCompat.requestPermissions(getActivity(), 
                    new String[]{Manifest.permission.POST_NOTIFICATIONS}, 1001);
            }
        }
        
        if (!isBound) {
            Log.d(TAG, "Service not bound, starting and binding...");
            // Start and bind service if not already bound
            Intent intent = new Intent(getContext(), TimerService.class);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                getContext().startForegroundService(intent);
            } else {
                getContext().startService(intent);
            }
            getContext().bindService(intent, serviceConnection, Context.BIND_AUTO_CREATE);
            
            // Wait a bit for binding then start timer
            getActivity().runOnUiThread(() -> {
                new android.os.Handler().postDelayed(() -> {
                    startTimerInternal(seconds, exercise, workout, call);
                }, 300);
            });
        } else {
            startTimerInternal(seconds, exercise, workout, call);
        }
    }
    
    private void startTimerInternal(int seconds, String exercise, String workout, PluginCall call) {
        Log.d(TAG, "startTimerInternal called, timerService: " + (timerService != null ? "available" : "null"));
        
        if (timerService != null) {
            Log.d(TAG, "Starting timer service with " + seconds + " seconds");
            timerService.startTimer(seconds * 1000L, exercise, workout, new TimerService.TimerCallback() {
                @Override
                public void onTick(long remainingSeconds) {
                    JSObject ret = new JSObject();
                    ret.put("remaining", remainingSeconds);
                    notifyListeners("timerTick", ret);
                }
                
                @Override
                public void onFinish() {
                    Log.d(TAG, "Timer finished");
                    JSObject ret = new JSObject();
                    ret.put("completed", true);
                    notifyListeners("timerComplete", ret);
                }
            });
            
            Log.d(TAG, "Timer started successfully");
            JSObject ret = new JSObject();
            ret.put("started", true);
            call.resolve(ret);
        } else {
            Log.e(TAG, "Timer service not available!");
            call.reject("Timer service not available");
        }
    }
    
    @PluginMethod
    public void stopTimer(PluginCall call) {
        if (timerService != null) {
            timerService.stopTimer();
            
            // Stop the foreground service
            Intent intent = new Intent(getContext(), TimerService.class);
            getContext().stopService(intent);
        }
        
        JSObject ret = new JSObject();
        ret.put("stopped", true);
        call.resolve(ret);
    }
    
    @PluginMethod
    public void pauseTimer(PluginCall call) {
        if (timerService != null) {
            timerService.pauseTimer();
        }
        
        JSObject ret = new JSObject();
        ret.put("paused", true);
        call.resolve(ret);
    }
    
    @PluginMethod
    public void resumeTimer(PluginCall call) {
        if (timerService != null) {
            timerService.resumeTimer();
        }
        
        JSObject ret = new JSObject();
        ret.put("resumed", true);
        call.resolve(ret);
    }
    
    @PluginMethod
    public void isRunning(PluginCall call) {
        boolean running = timerService != null && timerService.isRunning();
        long remaining = timerService != null ? timerService.getRemainingTimeMs() / 1000 : 0;
        
        JSObject ret = new JSObject();
        ret.put("running", running);
        ret.put("remaining", remaining);
        call.resolve(ret);
    }
    
    @Override
    protected void handleOnDestroy() {
        if (isBound) {
            getContext().unbindService(serviceConnection);
            isBound = false;
        }
        super.handleOnDestroy();
    }
}
