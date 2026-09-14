output "provider_arn" {
  description = "ARN del proveedor OIDC de GitHub Actions."
  value       = aws_iam_openid_connect_provider.github.arn
}

output "role_arns" {
  description = "ARN del rol de despliegue por entorno (findly-github-actions-{entorno})."
  value       = { for env, role in aws_iam_role.github_actions : env => role.arn }
}
