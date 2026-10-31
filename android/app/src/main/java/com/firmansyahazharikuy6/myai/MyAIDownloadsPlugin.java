package com.firmansyahazharikuy6.myai;

import android.Manifest;
import android.app.Activity;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.ContentValues;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;
import android.view.View;
import android.widget.Toast;
import androidx.core.app.NotificationCompat;
import androidx.core.content.ContextCompat;
import androidx.annotation.RequiresApi;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.io.OutputStream;
import com.getcapacitor.PermissionState;

@CapacitorPlugin(
    name = "MyAIDownloads",
    permissions = {
        @Permission(alias = "notifications", strings = { Manifest.permission.POST_NOTIFICATIONS })
    }
)
public class MyAIDownloadsPlugin extends Plugin {

    @PluginMethod
    public void saveFile(PluginCall call) {
        String filename = safeFilename(call.getString("filename"));
        String mimeType = call.getString("mimeType", "application/octet-stream");
        String encoded = call.getString("data");
        if (filename.isEmpty() || encoded == null || encoded.isEmpty()) {
            call.reject("Nama file atau isi file tidak tersedia.");
            return;
        }
        byte[] data;
        try {
            data = Base64.decode(encoded, Base64.DEFAULT);
        } catch (IllegalArgumentException error) {
            call.reject("Data file tidak valid.", error);
            return;
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            saveToDownloads(call, filename, mimeType, data);
            return;
        }

        call.getData().put("filename", filename);
        call.getData().put("mimeType", mimeType);
        call.getData().put("fileData", encoded);
        call.setKeepAlive(true);
        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType(mimeType);
        intent.putExtra(Intent.EXTRA_TITLE, filename);
        startActivityForResult(call, intent, "legacySaveResult");
    }

    @ActivityCallback
    private void legacySaveResult(PluginCall call, ActivityResult result) {
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null) {
            call.reject("Penyimpanan file dibatalkan.");
            return;
        }
        Uri uri = result.getData().getData();
        if (uri == null) {
            call.reject("Lokasi file tidak tersedia.");
            return;
        }
        try (OutputStream output = getContext().getContentResolver().openOutputStream(uri)) {
            if (output == null) throw new IllegalStateException("Tidak dapat membuka lokasi file.");
            output.write(Base64.decode(call.getString("fileData"), Base64.DEFAULT));
            completeSave(call, call.getString("filename"), uri.toString());
        } catch (Exception error) {
            call.reject("File tidak dapat disimpan.", error);
        }
    }

    @RequiresApi(Build.VERSION_CODES.Q)
    private void saveToDownloads(PluginCall call, String filename, String mimeType, byte[] data) {
        ContentValues values = new ContentValues();
        values.put(MediaStore.Downloads.DISPLAY_NAME, filename);
        values.put(MediaStore.Downloads.MIME_TYPE, mimeType);
        values.put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/MyAI");
        values.put(MediaStore.Downloads.IS_PENDING, 1);
        Uri uri = null;
        try {
            uri = getContext().getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
            if (uri == null) throw new IllegalStateException("Downloads tidak menerima file.");
            try (OutputStream output = getContext().getContentResolver().openOutputStream(uri)) {
                if (output == null) throw new IllegalStateException("Tidak dapat membuka file unduhan.");
                output.write(data);
            }
            ContentValues published = new ContentValues();
            published.put(MediaStore.Downloads.IS_PENDING, 0);
            getContext().getContentResolver().update(uri, published, null, null);
            completeSave(call, filename, uri.toString());
        } catch (Exception error) {
            if (uri != null) getContext().getContentResolver().delete(uri, null, null);
            call.reject("File tidak dapat disimpan ke Downloads.", error);
        }
    }

    private void completeSave(PluginCall call, String filename, String uri) {
        call.getData().put("savedFilename", filename);
        call.getData().put("savedUri", uri);
        Toast.makeText(getContext(), "Disimpan ke Downloads: " + filename, Toast.LENGTH_LONG).show();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
            && ContextCompat.checkSelfPermission(getContext(), Manifest.permission.POST_NOTIFICATIONS)
                != PackageManager.PERMISSION_GRANTED) {
            requestPermissionForAlias("notifications", call, "notificationPermissionResult");
            return;
        }
        notifySavedFile(filename);
        resolveSavedFile(call, filename, uri);
    }

    @PermissionCallback
    private void notificationPermissionResult(PluginCall call) {
        String filename = call.getString("savedFilename");
        String uri = call.getString("savedUri");
        if (getPermissionState("notifications") == PermissionState.GRANTED) notifySavedFile(filename);
        resolveSavedFile(call, filename, uri);
    }

    private void notifySavedFile(String filename) {
        NotificationManager manager = (NotificationManager) getContext().getSystemService(NotificationManager.class);
        if (manager == null) return;
        String channelId = "myai-downloads";
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            manager.createNotificationChannel(new NotificationChannel(
                channelId, "Unduhan MyAI", NotificationManager.IMPORTANCE_DEFAULT));
        }
        manager.notify(
            (int) (System.currentTimeMillis() & 0x7fffffff),
            new NotificationCompat.Builder(getContext(), channelId)
                .setSmallIcon(getContext().getApplicationInfo().icon)
                .setContentTitle("File MyAI disimpan")
                .setContentText(filename)
                .setAutoCancel(true)
                .setPriority(NotificationCompat.PRIORITY_DEFAULT)
                .build()
        );
    }

    private void resolveSavedFile(PluginCall call, String filename, String uri) {
        JSObject result = new JSObject();
        result.put("filename", filename);
        result.put("uri", uri);
        call.resolve(result);
    }

    @PluginMethod
    public void setNavigationBar(PluginCall call) {
        Boolean light = call.getBoolean("light");
        if (light == null) {
            call.reject("Tema sistem tidak valid.");
            return;
        }
        getActivity().runOnUiThread(() -> {
            int flags = getActivity().getWindow().getDecorView().getSystemUiVisibility();
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                if (light) flags |= View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;
                else flags &= ~View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;
                getActivity().getWindow().getDecorView().setSystemUiVisibility(flags);
                getActivity().getWindow().setNavigationBarColor(
                    android.graphics.Color.parseColor(light ? "#f4f3f7" : "#11131b"));
            }
            call.resolve();
        });
    }

    private String safeFilename(String filename) {
        if (filename == null) return "";
        String safe = filename.replaceAll("[\\\\/:*?\"<>|\\p{Cntrl}]", "_").trim();
        if (safe.isEmpty() || safe.equals(".") || safe.equals("..")) return "";
        return safe.length() > 120 ? safe.substring(0, 120) : safe;
    }
}
