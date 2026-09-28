output "lambda_function_names" {
  value = { for key, fn in aws_lambda_function.public : key => fn.function_name }
}
