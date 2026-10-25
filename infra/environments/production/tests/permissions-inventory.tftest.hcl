# This test uses only a mock provider. Its JSON state is an in-memory input to
# the permission contract, never evidence of applied IAM or deployed resources.
mock_provider "aws" {
  mock_data "aws_caller_identity" {
    defaults = {
      account_id = "123456789012"
      arn        = "arn:aws:iam::123456789012:user/terraform-test"
      user_id    = "terraform-test"
    }
  }
  mock_data "aws_region" {
    defaults = { name = "eu-west-1", region = "eu-west-1" }
  }
}

run "complete_permission_inventory" {
  command = apply
}
