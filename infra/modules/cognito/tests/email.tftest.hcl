mock_provider "aws" {}

variables {
  environment = "sandbox"
}

run "default_cognito_sender" {
  command = plan
  assert {
    condition     = aws_cognito_user_pool.organizers.email_configuration[0].email_sending_account == "COGNITO_DEFAULT"
    error_message = "Nonproduction must retain the standard Cognito sender by default."
  }
}

run "reviewed_ses_sender" {
  command = plan
  variables {
    email_identity_arn = "arn:aws:ses:eu-west-1:123456789012:identity/findly.barcelona"
    email_from_address = "info@findly.barcelona"
  }
  assert {
    condition = (
      aws_cognito_user_pool.organizers.email_configuration[0].email_sending_account == "DEVELOPER" &&
      aws_cognito_user_pool.organizers.email_configuration[0].source_arn == var.email_identity_arn &&
      aws_cognito_user_pool.organizers.email_configuration[0].from_email_address == var.email_from_address
    )
    error_message = "The approved Cognito SES identity/sender must survive deployment."
  }
}

run "identity_without_sender_rejected" {
  command = plan
  variables {
    email_identity_arn = "arn:aws:ses:eu-west-1:123456789012:identity/findly.barcelona"
  }
  expect_failures = [aws_cognito_user_pool.organizers]
}

run "sender_without_identity_rejected" {
  command = plan
  variables {
    email_from_address = "info@findly.barcelona"
  }
  expect_failures = [aws_cognito_user_pool.organizers]
}

run "wrong_region_rejected" {
  command = plan
  variables {
    email_identity_arn = "arn:aws:ses:us-east-1:123456789012:identity/findly.barcelona"
    email_from_address = "info@findly.barcelona"
  }
  expect_failures = [var.email_identity_arn]
}
