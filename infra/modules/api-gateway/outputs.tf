output "api_id" { value = aws_apigatewayv2_api.http_api.id }
output "api_endpoint" { value = aws_apigatewayv2_stage.default.invoke_url }
output "execution_arn" { value = aws_apigatewayv2_api.http_api.execution_arn }
