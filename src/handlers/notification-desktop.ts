import { register, type HandlerContext } from './registry.js';
import { execShell } from '../execution/shell.js';
import { logger } from '../logger.js';

// ── Platform dispatcher ─────────────────────────────────────────────

function buildNotifyCommand(
  title: string,
  body: string,
  sound?: string | boolean,
): string | null {
  switch (process.platform) {
    case 'darwin': {
      const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
      let script = `display notification "${esc(body)}" with title "${esc(title)}"`;
      if (sound) {
        const name = typeof sound === 'string' ? sound : 'default';
        script += ` sound name "${esc(name)}"`;
      }
      return `osascript -e '${script.replace(/'/g, "'\\''")}' 2>&1`;
    }
    case 'linux':
      return `notify-send ${shellQuote(title)} ${shellQuote(body)} 2>&1`;
    default:
      return null;
  }
}

function shellQuote(s: string): string {
  return "'" + s.replace(/'/g, "'\\''" ) + "'";
}

function enoentMessage(): string {
  switch (process.platform) {
    case 'darwin':
      return 'osascript not found \u2014 macOS notification support unavailable';
    case 'linux':
      return 'notify-send not found \u2014 install libnotify-bin or equivalent';
    default:
      return 'notification command not found';
  }
}

register({
  name: 'notification-desktop',
  sideEffectDefault: true,

  async run(_ctx: HandlerContext, input: unknown): Promise<unknown> {
    const opts = input as {
      title: string;
      body?: string;
      message?: string;
      sound?: string | boolean;
    };

    const body = opts.body ?? opts.message ?? '';
    const command = buildNotifyCommand(opts.title, body, opts.sound);

    if (command === null) {
      return {
        delivered: false,
        reason: `Desktop notifications not supported on ${process.platform}`,
      };
    }

    const result = await execShell({ command, cwd: process.cwd(), signal: AbortSignal.timeout(10_000) });

    if (result.exitCode !== 0) {
      const output = (result.stderr || result.stdout).toLowerCase();
      if (
        output.includes('not found') ||
        output.includes('no such file') ||
        result.exitCode === 127
      ) {
        const reason = enoentMessage();
        logger.warn(reason);
        return { delivered: false, reason };
      }
      throw new Error(
        `notification command failed (exit ${result.exitCode}): ${result.stderr || result.stdout}`,
      );
    }

    return { delivered: true };
  },
});
