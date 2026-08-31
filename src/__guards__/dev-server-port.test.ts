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

type ServerConfig = { port: number; strictPort: boolean; proxy: Record<string, string> };

async function serverConfig(env: Record<string, string | undefined>): Promise<ServerConfig> {
  const saved = { ...process.env };
  for (const [key, value] of Object.entries(env)) {
    // Assigning undefined would set the STRING "undefined" — process.env coerces.
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    // A fresh module per case: the config reads process.env at module scope, so
    // a cached copy would answer with the first case's environment.
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

describe('the dev server port', () => {
  it('is 5399 with no worktree block, as it has always been', async () => {
    const server = await serverConfig({ YEABOI_WEB_DEV_PORT: undefined, RETRO_PORT: undefined });
    expect(server.port).toBe(5399);
    expect(server.proxy['/api']).toBe('http://127.0.0.1:5173');
  });

  it('follows the worktree block when there is one', async () => {
    const server = await serverConfig({ YEABOI_WEB_DEV_PORT: '20160', RETRO_PORT: '20100' });
    expect(server.port).toBe(20160);
  });

  it('proxies /api to the same worktree own retro board', async () => {
    const server = await serverConfig({ YEABOI_WEB_DEV_PORT: '20160', RETRO_PORT: '20100' });
    expect(server.proxy['/api']).toBe('http://127.0.0.1:20100');
  });

  it('lets an explicit YEABOI_DEV_API still win', async () => {
    const server = await serverConfig({ RETRO_PORT: '20100', YEABOI_DEV_API: 'http://127.0.0.1:9999' });
    expect(server.proxy['/api']).toBe('http://127.0.0.1:9999');
  });

  it('keeps strictPort, so a collision is loud rather than silent', async () => {
    expect((await serverConfig({ YEABOI_WEB_DEV_PORT: '20160' })).strictPort).toBe(true);
  });

  it('falls back rather than binding NaN when the value is not a port', async () => {
    expect((await serverConfig({ YEABOI_WEB_DEV_PORT: 'not-a-port' })).port).toBe(5399);
  });
});
