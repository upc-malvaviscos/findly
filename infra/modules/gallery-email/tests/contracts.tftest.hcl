mock_provider "aws" {}
variables {
  environment            = "test"
  data_class             = "synthetic"
  table_name             = "synthetic-table"
  table_arn              = "arn:aws:dynamodb:eu-west-1:123456789012:table/synthetic-table"
  uploads_bucket_name    = "synthetic-bucket"
  uploads_bucket_arn     = "arn:aws:s3:::synthetic-bucket"
  api_id                 = "synthetic-api"
  api_execution_arn      = "arn:aws:execute-api:eu-west-1:123456789012:synthetic-api"
  authorizer_id          = "synthetic-authorizer"
  identity_arn           = "arn:aws:ses:eu-west-1:123456789012:identity/synthetic.invalid"
  from_address           = "sender@synthetic.invalid"
  gallery_origin         = "https://synthetic.invalid"
  artifact_path          = "./main.tf"
  feedback_artifact_path = "./main.tf"
}
run "authenticated_manual_sender" {
  command = plan
  assert {
    condition     = aws_apigatewayv2_route.function["request"].authorization_type == "JWT" && aws_apigatewayv2_route.function["status"].authorization_type == "JWT"
    error_message = "Both request and progress routes must require Cognito authorization."
  }
  assert {
    condition     = aws_sqs_queue.work.fifo_queue && aws_sqs_queue.work.visibility_timeout_seconds >= 6 * aws_lambda_function.function["worker"].timeout && aws_lambda_event_source_mapping.work.batch_size == 1
    error_message = "Email must retain FIFO serialization and a visibility timeout safe for Lambda retries."
  }
  assert {
    condition     = aws_sqs_queue.feedback.message_retention_seconds <= 3600 && aws_sqs_queue.feedback_dlq.message_retention_seconds <= 3600
    error_message = "PII in SES feedback must not remain in queues longer than an hour."
  }
}
run "missing_sender_rejected" {
  command = plan
  variables { from_address = "" }
  expect_failures = [aws_lambda_function.function]
}
run "wrong_region_rejected" {
  command = plan
  variables { identity_arn = "arn:aws:ses:us-east-1:123456789012:identity/synthetic.invalid" }
  expect_failures = [aws_lambda_function.function]
}
run "insecure_gallery_rejected" {
  command = plan
  variables { gallery_origin = "http://synthetic.invalid" }
  expect_failures = [var.gallery_origin]
}
