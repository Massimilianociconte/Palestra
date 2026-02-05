package com.gymbro.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.os.Binder;
import android.os.Build;
import android.os.CountDownTimer;
import android.os.IBinder;
import android.util.Log;
import android.widget.RemoteViews;
import androidx.core.app.NotificationCompat;

public class TimerService extends Service {
    private static final String TAG = "TimerService";
    private static final String CHANNEL_ID = "gymbro_timer_channel";
    private static final int NOTIFICATION_ID = 1001;
    
    private final IBinder binder = new TimerBinder();
    private CountDownTimer countDownTimer;
    private NotificationManager notificationManager;
    private NotificationCompat.Builder notificationBuilder;
    
    private long remainingTimeMs = 0;
    private String exerciseName = "Riposo";
    private String workoutName = "Allenamento";
    private boolean isRunning = false;
    
    // Callback interface for timer updates
    public interface TimerCallback {
        void onTick(long remainingSeconds);
        void onFinish();
    }
    
    private TimerCallback callback;
    
    public class TimerBinder extends Binder {
        TimerService getService() {
            return TimerService.this;
        }
    }
    
    @Override
    public void onCreate() {
        super.onCreate();
        Log.d(TAG, "TimerService onCreate");
        notificationManager = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        createNotificationChannel();
    }
    
    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null) {
            String action = intent.getAction();
            if ("STOP_TIMER".equals(action)) {
                stopTimer();
                stopForeground(true);
                stopSelf();
            }
        }
        return START_STICKY;
    }
    
    @Override
    public IBinder onBind(Intent intent) {
        return binder;
    }
    
    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID,
                "Timer Allenamento",
                NotificationManager.IMPORTANCE_HIGH
            );
            channel.setDescription("Mostra il timer di riposo durante l'allenamento");
            channel.setShowBadge(true);
            channel.enableVibration(false);
            channel.setSound(null, null);
            channel.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
            notificationManager.createNotificationChannel(channel);
        }
    }

    
    public void startTimer(long durationMs, String exercise, String workout, TimerCallback cb) {
        Log.d(TAG, "startTimer called: " + durationMs + "ms, exercise: " + exercise);
        
        this.exerciseName = exercise;
        this.workoutName = workout;
        this.callback = cb;
        this.remainingTimeMs = durationMs;
        this.isRunning = true;
        
        // Stop any existing timer
        if (countDownTimer != null) {
            countDownTimer.cancel();
        }
        
        // Create and show notification
        Log.d(TAG, "Building notification...");
        Notification notification = buildNotification(durationMs / 1000);
        Log.d(TAG, "Starting foreground service...");
        startForeground(NOTIFICATION_ID, notification);
        Log.d(TAG, "Foreground service started");
        
        // Start countdown
        countDownTimer = new CountDownTimer(durationMs, 1000) {
            @Override
            public void onTick(long millisUntilFinished) {
                remainingTimeMs = millisUntilFinished;
                long seconds = millisUntilFinished / 1000;
                updateNotification(seconds);
                if (callback != null) {
                    callback.onTick(seconds);
                }
            }
            
            @Override
            public void onFinish() {
                isRunning = false;
                remainingTimeMs = 0;
                updateNotificationComplete();
                if (callback != null) {
                    callback.onFinish();
                }
                // Keep notification for a moment then remove
                new android.os.Handler().postDelayed(() -> {
                    stopForeground(true);
                }, 2000);
            }
        }.start();
    }
    
    public void stopTimer() {
        Log.d(TAG, "stopTimer called - cancelling timer and removing notification");
        if (countDownTimer != null) {
            countDownTimer.cancel();
            countDownTimer = null;
        }
        isRunning = false;
        remainingTimeMs = 0;
        
        // CRITICAL: Remove the foreground notification immediately
        stopForeground(true);
        
        // Also cancel the notification explicitly as backup
        if (notificationManager != null) {
            notificationManager.cancel(NOTIFICATION_ID);
            Log.d(TAG, "Notification cancelled");
        }
    }
    
    public void pauseTimer() {
        if (countDownTimer != null && isRunning) {
            countDownTimer.cancel();
            isRunning = false;
            updateNotificationPaused();
        }
    }
    
    public void resumeTimer() {
        if (!isRunning && remainingTimeMs > 0) {
            startTimer(remainingTimeMs, exerciseName, workoutName, callback);
        }
    }
    
    public boolean isRunning() {
        return isRunning;
    }
    
    public long getRemainingTimeMs() {
        return remainingTimeMs;
    }
    
    private Notification buildNotification(long seconds) {
        Intent notificationIntent = new Intent(this, MainActivity.class);
        notificationIntent.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent pendingIntent = PendingIntent.getActivity(
            this, 0, notificationIntent, 
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
        
        Intent stopIntent = new Intent(this, TimerService.class);
        stopIntent.setAction("STOP_TIMER");
        PendingIntent stopPendingIntent = PendingIntent.getService(
            this, 0, stopIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
        
        String timeText = formatTime(seconds);
        
        // Create custom RemoteViews for collapsed notification
        RemoteViews collapsedView = new RemoteViews(getPackageName(), R.layout.notification_timer);
        collapsedView.setTextViewText(R.id.timer_text, timeText);
        collapsedView.setTextViewText(R.id.label_text, "RIPOSO");
        collapsedView.setTextViewText(R.id.workout_text, workoutName);
        
        // Create custom RemoteViews for expanded notification
        RemoteViews expandedView = new RemoteViews(getPackageName(), R.layout.notification_timer_expanded);
        expandedView.setTextViewText(R.id.timer_text, timeText);
        expandedView.setTextViewText(R.id.label_text, "RIPOSO");
        expandedView.setTextViewText(R.id.workout_text, workoutName);
        expandedView.setTextViewText(R.id.exercise_text, "Prossimo: " + exerciseName);
        
        // BigTextStyle per lockscreen + custom view per notification shade
        NotificationCompat.BigTextStyle bigTextStyle = new NotificationCompat.BigTextStyle()
            .setBigContentTitle("⏱ " + timeText + "  RIPOSO")
            .bigText(workoutName + "\nProssimo: " + exerciseName)
            .setSummaryText("GymBro Timer");
        
        notificationBuilder = new NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_media_play)
            .setContentTitle("⏱ " + timeText + "  RIPOSO")
            .setContentText(workoutName + " • Prossimo: " + exerciseName)
            .setStyle(bigTextStyle)
            .setCustomBigContentView(expandedView)  // Custom view nel notification shade
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setShowWhen(false)
            .setContentIntent(pendingIntent)
            .addAction(android.R.drawable.ic_media_pause, "Stop", stopPendingIntent)
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setCategory(NotificationCompat.CATEGORY_ALARM)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setColorized(true)
            .setColor(0xFF2D5A6B); // Teal scuro rilassante
        
        return notificationBuilder.build();
    }
    
    private void updateNotification(long seconds) {
        if (notificationBuilder != null) {
            String timeText = formatTime(seconds);
            
            // Update expanded view
            RemoteViews expandedView = new RemoteViews(getPackageName(), R.layout.notification_timer_expanded);
            expandedView.setTextViewText(R.id.timer_text, timeText);
            expandedView.setTextViewText(R.id.label_text, "RIPOSO");
            expandedView.setTextViewText(R.id.workout_text, workoutName);
            expandedView.setTextViewText(R.id.exercise_text, "Prossimo: " + exerciseName);
            
            NotificationCompat.BigTextStyle bigTextStyle = new NotificationCompat.BigTextStyle()
                .setBigContentTitle("⏱ " + timeText + "  RIPOSO")
                .bigText(workoutName + "\nProssimo: " + exerciseName)
                .setSummaryText("GymBro Timer");
            
            notificationBuilder
                .setContentTitle("⏱ " + timeText + "  RIPOSO")
                .setContentText(workoutName + " • Prossimo: " + exerciseName)
                .setStyle(bigTextStyle)
                .setCustomBigContentView(expandedView);
            notificationManager.notify(NOTIFICATION_ID, notificationBuilder.build());
        }
    }
    
    private void updateNotificationPaused() {
        if (notificationBuilder != null) {
            String timeText = formatTime(remainingTimeMs / 1000);
            
            RemoteViews expandedView = new RemoteViews(getPackageName(), R.layout.notification_timer_expanded);
            expandedView.setTextViewText(R.id.timer_text, timeText);
            expandedView.setTextViewText(R.id.label_text, "PAUSA");
            expandedView.setTextViewText(R.id.workout_text, workoutName);
            expandedView.setTextViewText(R.id.exercise_text, exerciseName);
            
            NotificationCompat.BigTextStyle bigTextStyle = new NotificationCompat.BigTextStyle()
                .setBigContentTitle("⏸ " + timeText + "  PAUSA")
                .bigText(workoutName + "\n" + exerciseName)
                .setSummaryText("GymBro Timer");
            
            notificationBuilder
                .setContentTitle("⏸ " + timeText + "  PAUSA")
                .setContentText(workoutName + " • " + exerciseName)
                .setStyle(bigTextStyle)
                .setCustomBigContentView(expandedView);
            notificationManager.notify(NOTIFICATION_ID, notificationBuilder.build());
        }
    }
    
    private void updateNotificationComplete() {
        if (notificationBuilder != null) {
            RemoteViews expandedView = new RemoteViews(getPackageName(), R.layout.notification_timer_expanded);
            expandedView.setTextViewText(R.id.timer_text, "✓");
            expandedView.setTextViewText(R.id.label_text, "FATTO!");
            expandedView.setTextViewText(R.id.workout_text, workoutName);
            expandedView.setTextViewText(R.id.exercise_text, "Inizia: " + exerciseName);
            
            NotificationCompat.BigTextStyle bigTextStyle = new NotificationCompat.BigTextStyle()
                .setBigContentTitle("✅ FATTO!")
                .bigText(workoutName + "\nInizia: " + exerciseName)
                .setSummaryText("GymBro Timer");
            
            notificationBuilder
                .setContentTitle("✅ FATTO!")
                .setContentText(workoutName + " • Inizia: " + exerciseName)
                .setStyle(bigTextStyle)
                .setCustomBigContentView(expandedView)
                .setOngoing(false);
            notificationManager.notify(NOTIFICATION_ID, notificationBuilder.build());
        }
    }
    
    private String formatTime(long seconds) {
        long mins = seconds / 60;
        long secs = seconds % 60;
        return String.format("%d:%02d", mins, secs);
    }
    
    @Override
    public void onDestroy() {
        stopTimer();
        super.onDestroy();
    }
}
