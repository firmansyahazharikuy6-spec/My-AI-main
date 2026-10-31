package com.firmansyahazharikuy6.myai;

import com.getcapacitor.BridgeActivity;
import android.os.Bundle;
import com.google.firebase.FirebaseApp;
import com.google.firebase.FirebaseOptions;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        if (FirebaseApp.getApps(this).isEmpty()) {
            FirebaseOptions options = new FirebaseOptions.Builder()
                .setApiKey(getString(R.string.firebase_api_key))
                .setApplicationId(getString(R.string.firebase_app_id))
                .setProjectId(getString(R.string.firebase_project_id))
                .setStorageBucket(getString(R.string.firebase_storage_bucket))
                .setGcmSenderId(getString(R.string.firebase_messaging_sender_id))
                .setDatabaseUrl("https://my-ai-69027-default-rtdb.firebaseio.com/")
                .build();
            FirebaseApp.initializeApp(this, options);
        }
        registerPlugin(MyAIDownloadsPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
