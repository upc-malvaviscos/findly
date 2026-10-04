import { authorizeProduction } from './lib/production-controls.mjs';

authorizeProduction(process.env);
console.log(
  'Production actor, branch, environment and account verified before credentials.',
);
