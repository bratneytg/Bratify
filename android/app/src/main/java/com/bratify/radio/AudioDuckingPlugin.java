package com.bratify.radio;

import android.Manifest;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import android.media.AudioAttributes;
import android.media.AudioFocusRequest;
import android.media.AudioManager;
import android.os.Build;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Puente nativo para "bajar" el volumen de Spotify mientras habla el DJ.
 * Pide a Android el foco de audio con ducking (como hace una app de navegación al dar una indicación):
 * Spotify baja SU volumen solo y lo restaura al soltar el foco. El volumen del sistema no se toca.
 * Desde JavaScript: AudioDucking.start() -> { granted: true/false }  y  AudioDucking.stop()
 */
@CapacitorPlugin(name = "AudioDucking")
public class AudioDuckingPlugin extends Plugin {

    private AudioManager audioManager;
    private AudioFocusRequest focusRequest; // Android 8+
    private final AudioManager.OnAudioFocusChangeListener listener = change -> { };

    @Override
    public void load() {
        audioManager = (AudioManager) getContext().getSystemService(Context.AUDIO_SERVICE);
    }

    @PluginMethod
    public void start(PluginCall call) {
        int resultado;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            AudioAttributes atributos = new AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_ASSISTANCE_NAVIGATION_GUIDANCE) // "voz que se superpone": las apps de música hacen ducking
                    .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                    .build();
            focusRequest = new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK)
                    .setAudioAttributes(atributos)
                    .setWillPauseWhenDucked(false)
                    .setOnAudioFocusChangeListener(listener)
                    .build();
            resultado = audioManager.requestAudioFocus(focusRequest);
        } else {
            resultado = audioManager.requestAudioFocus(listener, AudioManager.STREAM_MUSIC,
                    AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK);
        }
        JSObject ret = new JSObject();
        ret.put("granted", resultado == AudioManager.AUDIOFOCUS_REQUEST_GRANTED);
        call.resolve(ret);
    }

    /** Arranca el servicio en primer plano: el DJ sigue funcionando con la pantalla bloqueada */
    @PluginMethod
    public void iniciarSegundoPlano(PluginCall call) {
        if (Build.VERSION.SDK_INT >= 33 && ContextCompat.checkSelfPermission(getContext(), Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            ActivityCompat.requestPermissions(getActivity(), new String[]{Manifest.permission.POST_NOTIFICATIONS}, 1);
        }
        ContextCompat.startForegroundService(getContext(), new Intent(getContext(), DjForegroundService.class));
        MainActivity.segundoPlano = true;
        call.resolve();
    }

    @PluginMethod
    public void detenerSegundoPlano(PluginCall call) {
        MainActivity.segundoPlano = false;
        getContext().stopService(new Intent(getContext(), DjForegroundService.class));
        call.resolve();
    }

    @PluginMethod
    public void stop(PluginCall call) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            if (focusRequest != null) audioManager.abandonAudioFocusRequest(focusRequest);
            focusRequest = null;
        } else {
            audioManager.abandonAudioFocus(listener);
        }
        call.resolve();
    }
}
