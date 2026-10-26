import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api/api_failure.dart';
import '../../core/api/generated/models.dart';
import '../../core/providers.dart';
import '../../core/theme/tokens.g.dart';
import '../../shared/widgets.dart';

class DemoFormScreen extends ConsumerStatefulWidget {
  const DemoFormScreen({super.key});

  @override
  ConsumerState<DemoFormScreen> createState() => _DemoFormScreenState();
}

class _DemoFormScreenState extends ConsumerState<DemoFormScreen> {
  final _formKey = GlobalKey<FormState>();
  final _title = TextEditingController();
  final _description = TextEditingController();
  bool _submitting = false;
  Object? _error;
  SubmitResponse? _confirmation;
  Map<String, String> _fieldErrors = {};

  @override
  void dispose() {
    _title.dispose();
    _description.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (_submitting) return;
    _fieldErrors = {};
    if (!_formKey.currentState!.validate()) return;
    FocusScope.of(context).unfocus();
    setState(() {
      _submitting = true;
      _error = null;
    });
    try {
      final result = await ref
          .read(repositoryProvider)
          .submit(
            SubmitRequest(
              title: _title.text.trim(),
              description: _description.text.trim().isEmpty
                  ? null
                  : _description.text.trim(),
            ),
          );
      if (mounted) setState(() => _confirmation = result);
    } catch (error) {
      if (mounted) {
        setState(() {
          _error = error;
          if (error is ApiFailure) _fieldErrors = error.details;
        });
        _formKey.currentState?.validate();
      }
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final confirmation = _confirmation;
    return PageContent(
      children: [
        const PageHeader(
          title: 'Formulario demo',
          subtitle: 'Comprueba validación, envío y confirmación de la API.',
        ),
        if (confirmation != null)
          Card(
            child: Padding(
              padding: const EdgeInsets.all(SpookyTokens.spacing6),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Icon(
                    Icons.check_circle_outline_rounded,
                    size: 44,
                    color: SpookyTokens.success,
                  ),
                  const SizedBox(height: SpookyTokens.spacing4),
                  Text(
                    'Envío confirmado',
                    style: Theme.of(context).textTheme.titleLarge,
                  ),
                  const SizedBox(height: SpookyTokens.spacing3),
                  Text(confirmation.message),
                  const SizedBox(height: SpookyTokens.spacing4),
                  SelectableText(
                    'ID: ${confirmation.submissionId}',
                    style: const TextStyle(color: SpookyTokens.textSecondary),
                  ),
                  const SizedBox(height: SpookyTokens.spacing6),
                  OutlinedButton(
                    onPressed: () => setState(() {
                      _confirmation = null;
                      _error = null;
                      _fieldErrors = {};
                      _title.clear();
                      _description.clear();
                    }),
                    child: const Text('Nuevo envío'),
                  ),
                ],
              ),
            ),
          )
        else
          Form(
            key: _formKey,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                TextFormField(
                  key: const Key('demo-title'),
                  controller: _title,
                  enabled: !_submitting,
                  maxLength: 100,
                  textInputAction: TextInputAction.next,
                  decoration: const InputDecoration(
                    labelText: 'Título',
                    hintText: 'Un registro de ejemplo',
                    helperText: 'Obligatorio · Máximo 100 caracteres',
                  ),
                  validator: (value) {
                    if (value == null || value.trim().isEmpty) {
                      return 'Escribe un título.';
                    }
                    if (value.trim().runes.length > 100) {
                      return 'El título admite hasta 100 caracteres.';
                    }
                    return _fieldErrors['title'];
                  },
                  onChanged: (_) => _fieldErrors.remove('title'),
                ),
                const SizedBox(height: SpookyTokens.spacing5),
                TextFormField(
                  key: const Key('demo-description'),
                  controller: _description,
                  enabled: !_submitting,
                  maxLines: 4,
                  maxLength: 1000,
                  decoration: const InputDecoration(
                    labelText: 'Descripción (opcional)',
                    hintText: 'Añade un poco de contexto…',
                  ),
                  validator: (value) {
                    if ((value?.trim().runes.length ?? 0) > 1000) {
                      return 'La descripción admite hasta 1000 caracteres.';
                    }
                    return _fieldErrors['description'];
                  },
                  onChanged: (_) => _fieldErrors.remove('description'),
                ),
                const SizedBox(height: SpookyTokens.spacing5),
                if (_error != null) ...[
                  ErrorState(error: _error!, onRetry: _submit),
                  const SizedBox(height: SpookyTokens.spacing5),
                ],
                FilledButton.icon(
                  key: const Key('demo-submit'),
                  onPressed: _submitting ? null : _submit,
                  icon: _submitting
                      ? const SizedBox.square(
                          dimension: 18,
                          child: CircularProgressIndicator(
                            strokeWidth: 2,
                            semanticsLabel: 'Enviando formulario',
                          ),
                        )
                      : const Icon(Icons.arrow_forward_rounded),
                  label: Text(_submitting ? 'Enviando…' : 'Enviar demo'),
                ),
                const SizedBox(height: SpookyTokens.spacing4),
                const Text(
                  'Solo datos de prueba. No ingreses información personal.',
                  textAlign: TextAlign.center,
                  style: TextStyle(
                    color: SpookyTokens.textSecondary,
                    fontSize: 12,
                  ),
                ),
              ],
            ),
          ),
      ],
    );
  }
}
