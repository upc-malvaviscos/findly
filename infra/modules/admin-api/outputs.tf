output "authorizer_id" { value = aws_apigatewayv2_authorizer.organizers.id }

output "function_names" { value = [for fn in aws_lambda_function.function : fn.function_name] }
