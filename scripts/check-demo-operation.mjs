import { authorizeDemo, demoConfiguration } from './lib/demo-controls.mjs';

authorizeDemo({
  repository: process.env.GITHUB_REPOSITORY,
  ref: process.env.GITHUB_REF,
  event: process.env.GITHUB_EVENT_NAME,
  actor: process.env.GITHUB_ACTOR,
  triggeringActor: process.env.GITHUB_TRIGGERING_ACTOR,
  environment: process.env.TARGET_ENVIRONMENT,
  operation: process.env.DEMO_OPERATION,
  confirmation: process.env.DEMO_CONFIRMATION,
});
demoConfiguration(process.env);
console.log(
  'Demo authorization and reviewed configuration verified before credentials.',
);
