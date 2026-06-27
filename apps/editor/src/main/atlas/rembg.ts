import { spawn } from 'node:child_process';
import { statSync } from 'node:fs';
import { AtlasError } from './errors';

// TASK-1.3.2 Background removal: an ASSET-PREP step, strictly separate from the deterministic pack. The
// pack pipeline (import -> trim -> pack -> emit) never imports or calls anything in this file, so pack
// determinism can never depend on an external binary. rembg is gated behind MARIONETTE_REMBG_BIN and
// validated up front (fail fast), so a misconfiguration surfaces before any sprite is processed, never
// mid-pipeline. The binary contract is simple and shell-free: it reads a PNG on stdin and writes a PNG
// on stdout (so the env var may point at the rembg CLI or a thin wrapper script).

export const REMBG_ENV = 'MARIONETTE_REMBG_BIN';

const REMBG_TIMEOUT_MS = 120_000;

export interface RembgConfig {
  readonly binPath: string;
}

function validateBin(binPath: string): RembgConfig {
  let stats;
  try {
    stats = statSync(binPath);
  } catch (cause) {
    throw new AtlasError(
      'ATLAS_REMBG_INVALID_BIN',
      `${REMBG_ENV} points to "${binPath}", which cannot be accessed`,
      { cause },
    );
  }
  if (!stats.isFile()) {
    throw new AtlasError('ATLAS_REMBG_INVALID_BIN', `${REMBG_ENV} "${binPath}" is not a file`);
  }
  return { binPath };
}

// Boot-time resolution: returns null when rembg is not configured (the default, background removal off),
// or a validated config when it is. Throws ATLAS_REMBG_INVALID_BIN if the env var is set but points at
// nothing usable, so a broken configuration fails fast at startup rather than at first use.
export function resolveRembgConfig(env: NodeJS.ProcessEnv = process.env): RembgConfig | null {
  const binPath = env[REMBG_ENV];
  if (binPath === undefined || binPath.trim() === '') return null;
  return validateBin(binPath);
}

// Required resolution: the caller is explicitly asking to remove backgrounds this run. Throws
// ATLAS_REMBG_NOT_CONFIGURED when the env var is unset and ATLAS_REMBG_INVALID_BIN when it is set but
// unusable. Call this BEFORE any import/pack work so the failure is fail-fast, not mid-pipeline.
export function requireRembgConfig(env: NodeJS.ProcessEnv = process.env): RembgConfig {
  const binPath = env[REMBG_ENV];
  if (binPath === undefined || binPath.trim() === '') {
    throw new AtlasError(
      'ATLAS_REMBG_NOT_CONFIGURED',
      `background removal was requested but ${REMBG_ENV} is not set`,
    );
  }
  return validateBin(binPath);
}

// Runs the configured binary on a single PNG. Bounded by a hard timeout; the process is killed and the
// promise rejects if it overruns. No shell is used (args is an array), so the binary path is not a shell
// injection vector.
export function removeBackground(pngBytes: Uint8Array, config: RembgConfig): Promise<Uint8Array> {
  return new Promise<Uint8Array>((resolve, reject) => {
    const child = spawn(config.binPath, [], { stdio: ['pipe', 'pipe', 'pipe'] });
    const { stdin, stdout, stderr } = child;
    if (stdin === null || stdout === null || stderr === null) {
      reject(new AtlasError('ATLAS_REMBG_FAILED', 'rembg child process has no stdio pipes'));
      return;
    }

    const outChunks: Buffer[] = [];
    const errChunks: Buffer[] = [];
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new AtlasError('ATLAS_REMBG_FAILED', `rembg timed out after ${REMBG_TIMEOUT_MS}ms`));
    }, REMBG_TIMEOUT_MS);
    timer.unref();

    stdout.on('data', (chunk: Buffer) => outChunks.push(chunk));
    stderr.on('data', (chunk: Buffer) => errChunks.push(chunk));
    child.on('error', (cause: Error) => {
      clearTimeout(timer);
      reject(
        new AtlasError('ATLAS_REMBG_FAILED', `failed to run rembg at ${config.binPath}`, { cause }),
      );
    });
    child.on('close', (code: number | null) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve(new Uint8Array(Buffer.concat(outChunks)));
        return;
      }
      const detail = Buffer.concat(errChunks).toString('utf8').trim();
      reject(
        new AtlasError(
          'ATLAS_REMBG_FAILED',
          `rembg exited with code ${code}${detail === '' ? '' : `: ${detail}`}`,
        ),
      );
    });

    // A child that closes stdin early would otherwise surface an EPIPE here; the close/error handlers
    // report the real failure, so this listener only prevents an unhandled stream error.
    stdin.on('error', () => undefined);
    stdin.write(Buffer.from(pngBytes));
    stdin.end();
  });
}
