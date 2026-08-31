/**
 * @vitest-environment node
 *
 * The dev server's port has to follow this worktree's block.
 *
 * Every worktree shares a machine, and `strictPort: true` means the second one
 * to start dies with EADDRINUSE rather than sliding to a free port. That is the
 * right behaviour — a silent slide lands on the port the NEXT worktree's block
 * hands out — but only once each worktree has a block of its own.
 */

import { describe, expect, it, vi } from 'vitest';

// The block the mocked fs hands back, or null for "this checkout has none".
// Mutable and hoisted because vi.mock is hoisted above the imports.
const state = vi.hoisted(() => ({ block: null as string | null }));

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    readFileSync: (path: unknown, ...rest: unknown[]) => {
      // Read from the fixture, never from whatever this developer's checkout
      // happens to have: a real .worktree.env would make "no block" untestable.
      if (String(path).endsWith('.worktree.env')) {
        if (state.block === null) throw new Error('ENOENT');
        return state.block;
      }
      return (actual.readFileSync as (...a: unknown[]) => unknown)(path, ...rest);
    },
  };
});

type ServerConfig = { port: number; strictPort: boolean; proxy: Record<string, string> };

async function serverConfig(opts: {
  block?: string | null;
  env?: Record<string, string | undefined>;
}): Promise<ServerConfig> {
  const saved = { ...process.env };
  state.block = opts.block ?? null;
  for (const key of ['YEABOI_WEB_DEV_PORT', 'RETRO_PORT', 'YEABOI_DEV_API'])
    delete process.env[key];
  for (const [key, value] of Object.entries(opts.env ?? {})) {
    // Assigning undefined would set the STRING "undefined" — process.env coerces.
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    // A fresh module per case: the config reads the block at module scope, so a
    // cached copy would answer with the first case's environment.
    vi.resetModules();
    const mod = await import('../../vite.config');
    return (mod.default as (o: { mode: string; command: string }) => { server: ServerConfig })({
      mode: 'retro',
      command: 'serve',
    }).server;
  } finally {
    process.env = saved;
  }
}

const BLOCK = 'export YEABOI_WEB_DEV_PORT=20160\nexport RETRO_PORT=20100\n';

describe('the dev server port', () => {
  it('is 5399 in a checkout with no block, as it has always been', async () => {
    const server = await serverConfig({ block: null });
    expect(server.port).toBe(5399);
    expect(server.proxy['/api']).toBe('http://127.0.0.1:5173');
  });

  it('follows the block file, which is how `npm run dev` sees it', async () => {
    // make exports these; npm loads no dotenv, so the config reads the file.
    expect((await serverConfig({ block: BLOCK })).port).toBe(20160);
  });

  it('follows the environment when make exported it', async () => {
    expect((await serverConfig({ env: { YEABOI_WEB_DEV_PORT: '20360' } })).port).toBe(20360);
  });

  it('lets a real environment variable beat the block file', async () => {
    const server = await serverConfig({ block: BLOCK, env: { YEABOI_WEB_DEV_PORT: '20999' } });
    expect(server.port).toBe(20999);
  });

  it('proxies /api to the same worktree own retro board', async () => {
    expect((await serverConfig({ block: BLOCK })).proxy['/api']).toBe('http://127.0.0.1:20100');
  });

  it('lets an explicit YEABOI_DEV_API still win', async () => {
    const server = await serverConfig({
      block: BLOCK,
      env: { YEABOI_DEV_API: 'http://127.0.0.1:9999' },
    });
    expect(server.proxy['/api']).toBe('http://127.0.0.1:9999');
  });

  it('keeps strictPort, so a collision is loud rather than silent', async () => {
    expect((await serverConfig({ block: BLOCK })).strictPort).toBe(true);
  });

  it('falls back rather than binding NaN when the value is not a port', async () => {
    expect((await serverConfig({ env: { YEABOI_WEB_DEV_PORT: 'not-a-port' } })).port).toBe(5399);
  });
});
