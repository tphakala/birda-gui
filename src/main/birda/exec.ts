import { execFile } from 'child_process';
import { findBirda } from './runner';

/** How long a short birda command (config, model listing) may run before it is killed. */
const BIRDA_COMMAND_TIMEOUT_MS = 30_000;

/**
 * Runs birda with the given arguments and resolves with its stdout. It rejects
 * with birda's stderr (or the spawn error) when birda fails, and with a timeout
 * message when birda does not finish within timeoutMs and is killed; errorPrefix
 * is put in front of both. A birda that cannot be found rejects without it.
 */
export async function execBirda(
  args: string[],
  { timeoutMs = BIRDA_COMMAND_TIMEOUT_MS, errorPrefix = '' }: { timeoutMs?: number; errorPrefix?: string } = {},
): Promise<string> {
  const birdaPath = await findBirda();
  return new Promise((resolve, reject) => {
    execFile(birdaPath, args, { maxBuffer: 10 * 1024 * 1024, timeout: timeoutMs }, (err, stdout, stderr) => {
      if (err) {
        if (err.killed) {
          reject(new Error(`${errorPrefix}birda ${args.join(' ')} did not finish within ${timeoutMs / 1000} s`));
        } else {
          reject(new Error(errorPrefix + (stderr || err.message)));
        }
        return;
      }
      resolve(stdout);
    });
  });
}
