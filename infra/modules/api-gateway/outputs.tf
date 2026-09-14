output "api_id" {
  description = "Id del HTTP API de API Gateway."
  value       = aws_apigatewayv2_api.http_api.id
}

output "api_endpoint" {
  description = "URL base invocable del HTTP API."
  value       = aws_apigatewayv2_stage.default.invoke_url
}

output "authorizer_id" {
  description = "Id del autorizador JWT de Cognito, para que las rutas /admin/* de la issue #5 lo referencien."
  value       = aws_apigatewayv2_authorizer.cognito_jwt.id
}
