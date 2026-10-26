class ApiFailure implements Exception {
  const ApiFailure({
    required this.code,
    required this.message,
    this.requestId,
    this.details = const {},
  });

  final String code;
  final String message;
  final String? requestId;
  final Map<String, String> details;

  @override
  String toString() => message;
}
