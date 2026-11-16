package com.bratify.radio;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(AudioDuckingPlugin.class); // debe ir ANTES de super.onCreate
        super.onCreate(savedInstanceState);
    }
}
