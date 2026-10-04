output "lambda_function_names" {
  value = { for key, fn in aws_lambda_function.public : key => fn.function_name }
}
output "telemetry_route_key" {
  description = "Ruta pública de telemetría a la que el stage aplica throttling (ADR-018)."
  value       = aws_apigatewayv2_route.public["telemetry"].route_key
}
