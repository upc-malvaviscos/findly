import { spawnSync } from 'node:child_process';

export function awsCommand(service, command, input = {}) {
  const result = spawnSync(
    'aws',
    [
      service,
      command,
      '--region',
      'eu-west-1',
      '--output',
      'json',
      '--no-cli-pager',
      '--no-paginate',
      '--cli-input-json',
      JSON.stringify(input),
    ],
    { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 },
  );
  if (result.status !== 0) {
    // Never echo request bodies or response data. Preserve only the AWS category.
    const category =
      result.stderr.match(/\(([^)]+)\) when calling/)?.[1] ??
      'AWS_COMMAND_FAILED';
    const error = new Error(`${service}:${command}: ${category}`);
    error.code = category;
    throw error;
  }
  return result.stdout.trim() ? JSON.parse(result.stdout) : {};
}
