package com.bratify.radio;

import android.os.Bundle;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    /** true mientras el DJ está activo: evita que Android congele el WebView con la pantalla bloqueada */
    public static volatile boolean segundoPlano = false;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(AudioDuckingPlugin.class); // debe ir ANTES de super.onCreate
        super.onCreate(savedInstanceState);
    }

    // Capacitor pausa el WebView (y sus temporizadores) al pasar a segundo plano; aquí se vuelve a activar
    private void mantenerWebViewActivo() {
        if (segundoPlano && getBridge() != null) {
            WebView wv = getBridge().getWebView();
            wv.onResume();
            wv.resumeTimers();
        }
    }

    @Override public void onPause() { super.onPause(); mantenerWebViewActivo(); }
    @Override public void onStop() { super.onStop(); mantenerWebViewActivo(); }
}
