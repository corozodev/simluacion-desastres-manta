package dev.corodev.spooky

import android.Manifest
import android.content.pm.PackageManager
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel

class MainActivity : FlutterActivity() {
    private val requestCode = 4104
    private val handler = Handler(Looper.getMainLooper())
    private var pending: MethodChannel.Result? = null
    private var listener: LocationListener? = null
    private var timeout: Runnable? = null

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, "dev.corodev.spooky/location")
            .setMethodCallHandler { call, result ->
                if (call.method != "current") {
                    result.notImplemented()
                } else if (pending != null) {
                    result.error("BUSY", "Ya se está solicitando la ubicación.", null)
                } else {
                    pending = result
                    if (hasLocationPermission()) {
                        locate()
                    } else {
                        // Triggered only by the explicit location button. Android 12+
                        // may grant coarse alone; no background access is requested.
                        requestPermissions(
                            arrayOf(
                                Manifest.permission.ACCESS_FINE_LOCATION,
                                Manifest.permission.ACCESS_COARSE_LOCATION,
                            ),
                            requestCode,
                        )
                    }
                }
            }
    }

    private fun hasLocationPermission(): Boolean =
        checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED ||
            checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED

    override fun onRequestPermissionsResult(
        requestCode: Int,
        permissions: Array<out String>,
        grantResults: IntArray,
    ) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == this.requestCode && pending != null) {
            if (hasLocationPermission()) {
                locate()
            } else {
                fail("PERMISSION_DENIED", "Permiso de ubicación denegado. Puedes colocar el marcador manualmente.")
            }
        }
    }

    @Suppress("DEPRECATION")
    private fun locate() {
        val manager = getSystemService(LOCATION_SERVICE) as LocationManager
        val fine = checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
        val providers = buildList {
            if (manager.isProviderEnabled(LocationManager.NETWORK_PROVIDER)) add(LocationManager.NETWORK_PROVIDER)
            if (fine && manager.isProviderEnabled(LocationManager.GPS_PROVIDER)) add(LocationManager.GPS_PROVIDER)
        }
        if (providers.isEmpty()) {
            fail("LOCATION_DISABLED", "Activa la ubicación del dispositivo o coloca el marcador manualmente.")
            return
        }
        val callback = object : LocationListener {
            override fun onLocationChanged(location: Location) {
                if (pending == null) return
                val response = pending
                cleanup()
                pending = null
                response?.success(
                    mapOf(
                        "latitude" to location.latitude,
                        "longitude" to location.longitude,
                        "accuracy_m" to location.accuracy.toDouble(),
                        "measured_at" to location.time,
                    ),
                )
            }
            override fun onProviderEnabled(provider: String) {}
            override fun onProviderDisabled(provider: String) {}
            override fun onStatusChanged(provider: String?, status: Int, extras: Bundle?) {}
        }
        listener = callback
        timeout = Runnable {
            fail("TIMEOUT", "No se obtuvo una ubicación en 15 segundos. Puedes usar el marcador manual.")
        }.also { handler.postDelayed(it, 15000) }
        try {
            // One fix from enabled providers, then remove every listener. This also
            // supports the installed Flutter minimum SDK without a maps/GPS plugin.
            for (provider in providers) {
                manager.requestLocationUpdates(provider, 0L, 0f, callback, Looper.getMainLooper())
            }
        } catch (_: SecurityException) {
            fail("PERMISSION_DENIED", "El permiso de ubicación cambió. Puedes usar el marcador manual.")
        } catch (_: IllegalArgumentException) {
            fail("UNAVAILABLE", "No hay un proveedor de ubicación disponible. Usa el marcador manual.")
        }
    }

    private fun cleanup() {
        timeout?.let { handler.removeCallbacks(it) }
        timeout = null
        listener?.let {
            try {
                (getSystemService(LOCATION_SERVICE) as LocationManager).removeUpdates(it)
            } catch (_: SecurityException) {
                // A permission can be revoked while a foreground request is pending.
            }
        }
        listener = null
    }

    private fun fail(code: String, message: String) {
        val response = pending
        pending = null
        cleanup()
        response?.error(code, message, null)
    }

    override fun onStop() {
        if (listener != null) {
            fail("CANCELLED", "Se interrumpió la ubicación. Puedes volver a solicitarla o usar el marcador manual.")
        }
        super.onStop()
    }

    override fun onDestroy() {
        if (pending != null) fail("CANCELLED", "Se cerró la solicitud de ubicación.")
        super.onDestroy()
    }
}
