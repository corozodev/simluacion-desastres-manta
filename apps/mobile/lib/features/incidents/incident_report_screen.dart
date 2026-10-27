import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api/api_failure.dart';
import '../../core/api/generated/models.dart';
import '../../core/api/incident_repository.dart';
import '../../core/theme/tokens.g.dart';
import '../escape/route_map.dart';
import 'incident_draft.dart';

class IncidentReportScreen extends ConsumerStatefulWidget {
  const IncidentReportScreen({super.key, this.graph, this.world});
  final Graph? graph;
  final WorldSnapshot? world;

  @override
  ConsumerState<IncidentReportScreen> createState() =>
      _IncidentReportScreenState();
}

class _IncidentReportScreenState extends ConsumerState<IncidentReportScreen> {
  late final TextEditingController latitude;
  late final TextEditingController longitude;
  late final TextEditingController description;
  bool locating = false;
  String? locationMessage;

  @override
  void initState() {
    super.initState();
    final draft = ref.read(incidentDraftProvider);
    latitude = TextEditingController(text: draft.latitude);
    longitude = TextEditingController(text: draft.longitude);
    description = TextEditingController(text: draft.description);
  }

  @override
  void dispose() {
    latitude.dispose();
    longitude.dispose();
    description.dispose();
    super.dispose();
  }

  void pick(GeoPoint position, {String method = 'manual'}) {
    latitude.text = position.lat.toStringAsFixed(7);
    longitude.text = position.lng.toStringAsFixed(7);
    ref
        .read(incidentDraftProvider.notifier)
        .edit(
          latitude: latitude.text,
          longitude: longitude.text,
          locationMethod: method,
        );
    if (method == 'manual') setState(() => locationMessage = null);
  }

  Future<void> locate() async {
    if (locating || !ref.read(incidentDraftProvider).editable) return;
    setState(() {
      locating = true;
      locationMessage = null;
    });
    try {
      final position = await ref.read(deviceLocationProvider).current();
      if (!mounted) return;
      pick(
        GeoPoint(lat: position.latitude, lng: position.longitude),
        method: 'device',
      );
      setState(() {
        locationMessage =
            'Estimación del dispositivo: ±${position.accuracyM.round()} m, '
            '${_date(position.measuredAt)}. Revisa el marcador; esta ubicación no verifica el reporte.';
      });
    } on PlatformException catch (error) {
      if (mounted) {
        setState(() {
          locationMessage =
              error.message ??
              'No se obtuvo la ubicación. Puedes usar el marcador manual.';
        });
      }
    } catch (_) {
      if (mounted) {
        setState(() {
          locationMessage =
              'No se obtuvo la ubicación. Puedes usar el marcador manual.';
        });
      }
    } finally {
      if (mounted) setState(() => locating = false);
    }
  }

  Future<void> chooseDate() async {
    final value = ref.read(incidentDraftProvider).eventTime.toLocal();
    final date = await showDatePicker(
      context: context,
      initialDate: value,
      firstDate: DateTime(2020),
      lastDate: DateTime.now(),
      helpText: 'Fecha en que observaste la novedad',
    );
    if (date == null || !mounted) return;
    final time = await showTimePicker(
      context: context,
      initialTime: TimeOfDay.fromDateTime(value),
      helpText: 'Hora declarada de la observación',
    );
    if (time == null) return;
    ref
        .read(incidentDraftProvider.notifier)
        .edit(
          eventTime: DateTime(
            date.year,
            date.month,
            date.day,
            time.hour,
            time.minute,
          ),
        );
  }

  @override
  Widget build(BuildContext context) {
    final draft = ref.watch(incidentDraftProvider);
    final controller = ref.read(incidentDraftProvider.notifier);
    final isEditing = draft.stage == IncidentDraftStage.editing;
    final lat = double.tryParse(draft.latitude);
    final lng = double.tryParse(draft.longitude);
    final marker =
        lat != null &&
            lng != null &&
            lat.isFinite &&
            lng.isFinite &&
            lat.abs() <= 90 &&
            lng.abs() <= 180
        ? GeoPoint(lat: lat, lng: lng)
        : null;
    return Scaffold(
      appBar: AppBar(title: const Text('Nueva novedad')),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(SpookyTokens.spacing5),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            if (draft.stage != IncidentDraftStage.sent ||
                draft.report?.verificationStatus == 'pending')
              const Text(
                'Reporte ciudadano pendiente de verificación',
                style: TextStyle(color: SpookyTokens.accent),
              ),
            const SizedBox(height: SpookyTokens.spacing2),
            const Text(
              'Prototipo académico experimental. El reporte no es información oficial '
              'ni una indicación de navegación de emergencia.',
            ),
            const SizedBox(height: SpookyTokens.spacing4),
            if (draft.stage == IncidentDraftStage.sent)
              _sent(draft)
            else ...[
              Text(switch (draft.stage) {
                IncidentDraftStage.editing =>
                  draft.resolving
                      ? 'Comprobando la asociación geográfica…'
                      : 'Editando',
                IncidentDraftStage.review =>
                  'Revisa la información antes de confirmar.',
                IncidentDraftStage.sending => 'Enviando…',
                IncidentDraftStage.error => 'Envío sin confirmar · error',
                IncidentDraftStage.sent => 'Enviado',
              }, style: Theme.of(context).textTheme.titleMedium),
              const SizedBox(height: SpookyTokens.spacing3),
              if (isEditing) ...[
                if (widget.graph != null) ...[
                  const Text('Toca el mapa para colocar o mover el marcador.'),
                  const SizedBox(height: SpookyTokens.spacing2),
                  RouteMap(
                    key: const Key('incident-location-map'),
                    graph: widget.graph!,
                    world: widget.world,
                    marker: marker,
                    highlightedEdgeId: draft.edgeHint,
                    onPickPosition: draft.editable && !locating ? pick : null,
                  ),
                  const Text(
                    'Calles OSM seleccionadas; la asociación a una calle se comprueba en el servidor.',
                    style: TextStyle(fontSize: 11),
                  ),
                ] else
                  const Text(
                    'El mapa aún no está disponible. Puedes escribir las coordenadas '
                    'o volver al mapa cuando termine de cargar.',
                  ),
                const SizedBox(height: SpookyTokens.spacing3),
                Wrap(
                  spacing: SpookyTokens.spacing3,
                  runSpacing: SpookyTokens.spacing3,
                  children: [
                    SizedBox(
                      width: 175,
                      child: TextField(
                        key: const Key('incident-latitude'),
                        controller: latitude,
                        enabled: draft.editable && !locating,
                        keyboardType: const TextInputType.numberWithOptions(
                          signed: true,
                          decimal: true,
                        ),
                        decoration: const InputDecoration(labelText: 'Latitud'),
                        onChanged: (value) => controller.edit(
                          latitude: value,
                          locationMethod: 'manual',
                        ),
                      ),
                    ),
                    SizedBox(
                      width: 175,
                      child: TextField(
                        key: const Key('incident-longitude'),
                        controller: longitude,
                        enabled: draft.editable && !locating,
                        keyboardType: const TextInputType.numberWithOptions(
                          signed: true,
                          decimal: true,
                        ),
                        decoration: const InputDecoration(
                          labelText: 'Longitud',
                        ),
                        onChanged: (value) => controller.edit(
                          longitude: value,
                          locationMethod: 'manual',
                        ),
                      ),
                    ),
                  ],
                ),
                OutlinedButton.icon(
                  key: const Key('incident-device-location'),
                  onPressed: draft.editable && !locating ? locate : null,
                  icon: const Icon(Icons.my_location),
                  label: Text(
                    locating
                        ? 'Buscando ubicación…'
                        : 'Usar ubicación del dispositivo',
                  ),
                ),
                const Text(
                  'Android solicitará permiso al pulsar el botón. La ubicación aproximada '
                  'también sirve; puedes usar toda la app sin conceder este permiso.',
                  style: TextStyle(fontSize: 12),
                ),
                if (locationMessage != null) Text(locationMessage!),
                const SizedBox(height: SpookyTokens.spacing4),
                _select(
                  'incident-type',
                  'Tipo de novedad',
                  draft.incidentType,
                  incidentTypes,
                  draft.editable
                      ? (value) => controller.edit(incidentType: value)
                      : null,
                ),
                const SizedBox(height: SpookyTokens.spacing3),
                _select(
                  'incident-passability',
                  'Transitabilidad observada',
                  draft.passability,
                  incidentPassabilities,
                  draft.editable
                      ? (value) => controller.edit(passability: value)
                      : null,
                ),
                const SizedBox(height: SpookyTokens.spacing3),
                _select(
                  'incident-severity',
                  'Severidad observada',
                  draft.severity,
                  incidentSeverities,
                  draft.editable
                      ? (value) => controller.edit(severity: value)
                      : null,
                ),
                const SizedBox(height: SpookyTokens.spacing3),
                TextField(
                  key: const Key('incident-description'),
                  controller: description,
                  enabled: draft.editable,
                  minLines: 3,
                  maxLines: 6,
                  maxLength: 500,
                  decoration: const InputDecoration(
                    labelText: 'Descripción de lo observado',
                    helperText:
                        'Sin nombres, teléfonos ni otros datos personales.',
                  ),
                  onChanged: (value) => controller.edit(description: value),
                ),
                OutlinedButton.icon(
                  onPressed: draft.editable ? chooseDate : null,
                  icon: const Icon(Icons.event),
                  label: Text('Fecha observada: ${_date(draft.eventTime)}'),
                ),
                const Text(
                  'La recepción se registrará con una fecha independiente en el servidor.',
                ),
                if (draft.resolution?.ambiguous == true) ...[
                  const SizedBox(height: SpookyTokens.spacing3),
                  const Text(
                    'Hay varias calles cercanas. Selecciona la que observaste y vuelve a revisar.',
                  ),
                  for (final edge in draft.resolution!.candidates)
                    OutlinedButton.icon(
                      key: Key('incident-edge-${edge.edgeId}'),
                      onPressed: draft.editable
                          ? () => controller.chooseEdge(edge.edgeId)
                          : null,
                      icon: Icon(
                        draft.edgeHint == edge.edgeId
                            ? Icons.radio_button_checked
                            : Icons.radio_button_unchecked,
                      ),
                      label: Text(
                        'Calle cercana ${draft.resolution!.candidates.indexOf(edge) + 1} · '
                        '${edge.distanceM.toStringAsFixed(1)} m del marcador',
                      ),
                    ),
                ],
                const SizedBox(height: SpookyTokens.spacing3),
                FilledButton(
                  key: const Key('incident-review'),
                  onPressed: draft.editable && !locating
                      ? controller.review
                      : null,
                  child: Text(
                    draft.resolving ? 'Comprobando…' : 'Revisar reporte',
                  ),
                ),
                const Text(
                  'El borrador se conserva mientras la app permanezca abierta. '
                  'No hay una cola offline ni recuperación tras cerrar la aplicación.',
                  style: TextStyle(fontSize: 12),
                ),
              ] else ...[
                _review(draft),
                if (draft.stage == IncidentDraftStage.review) ...[
                  FilledButton(
                    key: const Key('incident-confirm'),
                    onPressed: controller.send,
                    child: const Text('Confirmar envío'),
                  ),
                  TextButton(
                    onPressed: controller.backToEditing,
                    child: const Text('Volver a editar'),
                  ),
                ],
                if (draft.stage == IncidentDraftStage.sending)
                  const LinearProgressIndicator(
                    semanticsLabel: 'Enviando reporte',
                  ),
                if (draft.stage == IncidentDraftStage.error) ...[
                  const Text(
                    'Tus datos están conservados. El servidor podría haber recibido '
                    'el envío; reintenta con el mismo identificador para evitar duplicados.',
                  ),
                  FilledButton.icon(
                    key: const Key('incident-retry'),
                    onPressed: controller.send,
                    icon: const Icon(Icons.refresh),
                    label: const Text('Reintentar envío'),
                  ),
                ],
              ],
            ],
            if (draft.error != null) ...[
              const SizedBox(height: SpookyTokens.spacing3),
              _error(draft.error!),
            ],
          ],
        ),
      ),
    );
  }

  Widget _select(
    String key,
    String label,
    String value,
    Map<String, String> options,
    ValueChanged<String?>? onChanged,
  ) => DropdownButtonFormField<String>(
    key: Key(key),
    initialValue: value,
    isExpanded: true,
    decoration: InputDecoration(labelText: label),
    items: [
      for (final option in options.entries)
        DropdownMenuItem(value: option.key, child: Text(option.value)),
    ],
    onChanged: onChanged,
  );

  Widget _review(IncidentDraft draft) => Card(
    child: Padding(
      padding: const EdgeInsets.all(SpookyTokens.spacing4),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(incidentTypes[draft.incidentType]!),
          const Text('Ubicación: marcador revisado en el mapa'),
          Text(
            'Ubicación: ${draft.locationMethod == 'device' ? 'dispositivo' : 'marcador manual'}',
          ),
          Text('Transitabilidad: ${incidentPassabilities[draft.passability]}'),
          Text('Severidad: ${incidentSeverities[draft.severity]}'),
          Text('Fecha observada declarada: ${_date(draft.eventTime)}'),
          if (draft.edgeHint != null)
            const Text('Calle asociada y validada por el servidor.'),
          Text(draft.description.trim()),
          const Text(
            'Sin fotografías adjuntas. Procedencia: ciudadana; estado inicial: pendiente.',
          ),
        ],
      ),
    ),
  );

  Widget _sent(IncidentDraft draft) {
    final report = draft.report!;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        const Text('Enviado', style: TextStyle(color: SpookyTokens.success)),
        Text('Estado: ${incidentDisplayStatus(report)}'),

        Text(incidentTypes[report.incidentType]!),

        Text(report.description),
        Text(
          'Fecha observada declarada: ${_date(DateTime.parse(report.eventTime))}',
        ),

        Text(
          'Procedencia: ${incidentDisplayOrigin(report)}',
        ),
        const Text('La recepción no confirma que lo reportado sea verdadero.'),
        OutlinedButton.icon(
          onPressed: ref.read(incidentDraftProvider.notifier).refresh,
          icon: const Icon(Icons.refresh),
          label: const Text('Consultar estado'),
        ),
        TextButton(
          onPressed: () {
            ref.read(incidentDraftProvider.notifier).newReport();
            latitude.clear();
            longitude.clear();
            description.clear();
            setState(() => locationMessage = null);
          },
          child: const Text('Crear otra novedad'),
        ),
      ],
    );
  }

  Widget _error(Object error) {
    final failure = error is ApiFailure ? error : null;
    return Semantics(
      liveRegion: true,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            failure?.message ?? error.toString(),
            style: const TextStyle(color: SpookyTokens.error),
          ),
          if (failure != null)
            for (final detail in failure.details.entries)
              Text('${detail.key}: ${detail.value}'),
          if (failure?.requestId != null)
            SelectableText('Request ID: ${failure!.requestId}'),
        ],
      ),
    );
  }
}

String _date(DateTime value) {
  final local = value.toLocal();
  String two(int number) => number.toString().padLeft(2, '0');
  return '${local.year}-${two(local.month)}-${two(local.day)} '
      '${two(local.hour)}:${two(local.minute)}';
}
