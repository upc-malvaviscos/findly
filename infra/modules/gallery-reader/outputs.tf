output "function_arn" {
  description = "ARN de la Lambda GalleryReader."
  value       = aws_lambda_function.gallery_reader.arn
}

output "function_name" {
  description = "Nombre de la Lambda GalleryReader."
  value       = aws_lambda_function.gallery_reader.function_name
}
