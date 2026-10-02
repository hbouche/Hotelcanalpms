import { describe, it, expect } from 'vitest';
const express = require('express');
const cors = require('cors');
const corsOptions = require('./cors-options');

async function request(env, origin) {
  const app = express();
  app.use(cors(corsOptions(env)));
  app.get('/health', (req, res) => res.json({ status: 'healthy' }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/health`, {
      headers: origin ? { Origin: origin } : {}
    });
    return { status: response.status, allowedOrigin: response.headers.get('access-control-allow-origin') };
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

describe('Production origin setup before Render assigns a hostname', () => {
  it('allows the assigned Render URL and does not reflect unrelated origins', async () => {
    const env = { NODE_ENV: 'production', RENDER_EXTERNAL_URL: 'https://assigned-hotel.onrender.com' };
    expect((await request(env, env.RENDER_EXTERNAL_URL)).allowedOrigin).toBe(env.RENDER_EXTERNAL_URL);
    expect((await request(env, 'https://unrelated.example')).allowedOrigin).toBeNull();
  });

  it('uses an explicit custom-domain list when configured', async () => {
    const env = { NODE_ENV: 'production', RENDER_EXTERNAL_URL: 'https://assigned-hotel.onrender.com', ALLOWED_ORIGINS: ' https://hotel.example, https://booking.example ' };
    expect((await request(env, 'https://booking.example')).allowedOrigin).toBe('https://booking.example');
    expect((await request(env, env.RENDER_EXTERNAL_URL)).allowedOrigin).toBeNull();
  });

  it('serves same-origin requests without enabling cross-origin access when no production origin exists', async () => {
    expect(await request({ NODE_ENV: 'production' })).toEqual({ status: 200, allowedOrigin: null });
    expect((await request({ NODE_ENV: 'production' }, 'https://unrelated.example')).allowedOrigin).toBeNull();
  });

  it('keeps the separate local Vite development origin working', async () => {
    expect((await request({ NODE_ENV: 'development' }, 'http://localhost:3200')).allowedOrigin).toBe('http://localhost:3200');
  });
});
