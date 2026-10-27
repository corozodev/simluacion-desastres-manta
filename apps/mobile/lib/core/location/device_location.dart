import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';

class DevicePosition {
  const DevicePosition({
    required this.latitude,
    required this.longitude,
    required this.accuracyM,
    required this.measuredAt,
  });
  final double latitude;
  final double longitude;
  final double accuracyM;
  final DateTime measuredAt;
}

abstract interface class DeviceLocation {
  Future<DevicePosition> current();
}

class AndroidDeviceLocation implements DeviceLocation {
  const AndroidDeviceLocation();
  static const channel = MethodChannel('dev.corodev.spooky/location');

  @override
  Future<DevicePosition> current() async {
    if (kIsWeb || defaultTargetPlatform != TargetPlatform.android) {
      throw PlatformException(
        code: 'UNSUPPORTED',
        message:
            'La ubicación del dispositivo está disponible en Android. '
            'Puedes colocar el marcador manualmente.',
      );
    }
    final data = await channel.invokeMapMethod<String, dynamic>('current');
    if (data == null) {
      throw PlatformException(
        code: 'UNAVAILABLE',
        message: 'No se recibió una ubicación. Coloca el marcador manualmente.',
      );
    }
    final latitude = (data['latitude'] as num).toDouble();
    final longitude = (data['longitude'] as num).toDouble();
    final accuracy = (data['accuracy_m'] as num).toDouble();
    if (!latitude.isFinite ||
        !longitude.isFinite ||
        latitude.abs() > 90 ||
        longitude.abs() > 180 ||
        !accuracy.isFinite ||
        accuracy < 0) {
      throw PlatformException(
        code: 'INVALID_LOCATION',
        message: 'La ubicación recibida no es válida. Usa el marcador manual.',
      );
    }
    return DevicePosition(
      latitude: latitude,
      longitude: longitude,
      accuracyM: accuracy,
      measuredAt: DateTime.fromMillisecondsSinceEpoch(
        data['measured_at'] as int,
      ),
    );
  }
}
