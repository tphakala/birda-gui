import { execFile } from 'child_process';
import { birdaChildEnv, findBirda } from './runner';

/** How long a short birda command (config, model listing) may run before it is killed. */
const BIRDA_COMMAND_TIMEOUT_MS = 30_000;

/** Most stdout or stderr birda may print before execFile kills it. */
const BIRDA_MAX_BUFFER_BYTES = 10 * 1024 * 1024;

/**
 * Runs birda (with NO_COLOR set, see birdaChildEnv) with the given arguments and resolves with its stdout. It rejects
 * with birda's stderr (or the spawn error) when birda fails, with a timeout
 * message when birda does not finish within timeoutMs and is killed, and with an
 * output-limit message when birda prints more than the buffer holds and is killed;
 * errorPrefix is put in front of all three. A birda that cannot be found rejects without it.
 */
export async function execBirda(
  args: string[],
  { timeoutMs = BIRDA_COMMAND_TIMEOUT_MS, errorPrefix = '' }: { timeoutMs?: number; errorPrefix?: string } = {},
): Promise<string> {
  const birdaPath = await findBirda();
  return new Promise((resolve, reject) => {
    execFile(
      birdaPath,
      args,
      { maxBuffer: BIRDA_MAX_BUFFER_BYTES, timeout: timeoutMs, env: birdaChildEnv() },
      (err, stdout, stderr) => {
        if (err) {
          if (err.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') {
            reject(
              new Error(
                `${errorPrefix}birda ${args.join(' ')} output exceeded the ${BIRDA_MAX_BUFFER_BYTES / (1024 * 1024)} MB limit`,
              ),
            );
          } else if (err.killed) {
            reject(new Error(`${errorPrefix}birda ${args.join(' ')} did not finish within ${timeoutMs / 1000} s`));
          } else {
            reject(new Error(errorPrefix + (stderr || err.message)));
          }
          return;
        }
        resolve(stdout);
      },
    );
  });
}
