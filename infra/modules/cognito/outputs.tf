output "user_pool_id" {
  description = "Id del User Pool de Cognito."
  value       = aws_cognito_user_pool.organizers.id
}

output "user_pool_arn" {
  description = "ARN del User Pool de Cognito."
  value       = aws_cognito_user_pool.organizers.arn
}

output "issuer_url" {
  description = "URL del emisor del User Pool, usada por el autorizador JWT de API Gateway."
  value       = "https://cognito-idp.${data.aws_region.current.name}.amazonaws.com/${aws_cognito_user_pool.organizers.id}"
}

output "client_id" {
  description = "Id del App Client sin secreto usado por la SPA."
  value       = aws_cognito_user_pool_client.web.id
}

data "aws_region" "current" {}
