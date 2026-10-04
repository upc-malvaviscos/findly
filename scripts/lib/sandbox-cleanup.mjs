export async function withCleanup(work) {
  const tasks = [];
  const cleanup = {
    add(label, run) {
      tasks.push({ label, run });
    },
  };
  let value;
  let primaryError;
  let failed = false;
  try {
    value = await work(cleanup);
  } catch (error) {
    primaryError = error;
    failed = true;
  }
  const results = await Promise.allSettled(
    tasks.reverse().map(async (task) => task.run()),
  );
  // Labels identify resource types, never tokens, keys or credential output.
  const errors = results.flatMap((result, index) =>
    result.status === 'rejected'
      ? [new Error(`Cleanup failed: ${tasks[index].label}.`)]
      : [],
  );
  if (errors.length)
    throw new AggregateError(
      failed ? [primaryError, ...errors] : errors,
      'Sandbox cleanup incomplete; run dev:aws-destroy -- --confirm before claiming success.',
    );
  if (failed) throw primaryError;
  return value;
}

export function waitForServer(server, signals = process) {
  return new Promise((resolve, reject) => {
    let stopped = false;
    const stop = () => {
      stopped = true;
      server.kill('SIGTERM');
    };
    const detach = () => {
      signals.removeListener('SIGINT', stop);
      signals.removeListener('SIGTERM', stop);
      server.removeListener('error', onError);
      server.removeListener('exit', onExit);
    };
    const onError = () => {
      detach();
      reject(new Error('Could not start the sandbox web server.'));
    };
    const onExit = (code, signal) => {
      detach();
      if (code === 0 || (stopped && signal === 'SIGTERM')) resolve();
      else reject(new Error(`Sandbox web server failed (${code ?? signal}).`));
    };
    signals.on('SIGINT', stop);
    signals.on('SIGTERM', stop);
    server.once('error', onError);
    server.once('exit', onExit);
  });
}

export async function runSandboxSession({
  createUser,
  configureUser,
  startServer,
  deleteUser,
  signals,
}) {
  return withCleanup(async (cleanup) => {
    cleanup.add('temporary organizer', deleteUser);
    await createUser();
    await configureUser();
    await waitForServer(startServer(), signals);
  });
}

export function deleteSandboxOrganizer(remove) {
  try {
    remove();
  } catch (error) {
    if (
      !(error instanceof Error) ||
      !error.message.includes(
        'An error occurred (UserNotFoundException) when calling the AdminDeleteUser operation:',
      )
    )
      throw new Error('Temporary organizer deletion failed.');
  }
}
