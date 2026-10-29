#!/usr/bin/env node
// PJLink projector simulator. Listens on TCP 4352, logs everything, replies per PJLink Class 1.

import { appendFileSync } from 'node:fs';
import net from 'node:net';
import { parseArgs } from 'node:util';
import {
  createProjectorState,
  createSession,
  finishPowerTransition,
  greeting,
  handleLine,
  powerLabel,
} from './protocol.mjs';

const { values: options } = parseArgs({
  options: {
    hosts: { type: 'string', default: '127.0.0.1' },
    port: { type: 'string', default: '4352' },
    password: { type: 'string', default: '' },
    warmup: { type: 'string', default: '3' },
    name: { type: 'string', default: 'PJLink Simulator' },
    'lamp-hours': { type: 'string', default: '1234' },
    'idle-timeout': { type: 'string', default: '30' },
    log: { type: 'string' },
    help: { type: 'boolean', short: 'h', default: false },
  },
});

if (options.help) {
  console.log(`Usage: node src/server.mjs [options]

  --hosts <ip,ip,...>   one IP per projector (default 127.0.0.1)
                        e.g. 127.0.0.1,127.0.0.2,127.0.0.3 -> 3 projectors
  --port <n>            PJLink port (default 4352)
  --password <value>    enable PJLink authentication (default: none)
  --warmup <sec>        warm-up / cool-down time (default 3)
  --name <name>         NAME ? reply, suffixed with #1, #2 for multiple hosts
  --lamp-hours <n>      LAMP ? hours (default 1234)
  --idle-timeout <sec>  close idle connections (default 30, per spec)
  --log <file>          also append the log to a file`);
  process.exit(0);
}

const hosts = options.hosts.split(',').map((host) => host.trim()).filter(Boolean);
const port = Number(options.port);
const warmupMs = Number(options.warmup) * 1000;
const idleTimeoutMs = Number(options['idle-timeout']) * 1000;

const pad = (value, length = 2) => String(value).padStart(length, '0');
const timestamp = () => {
  const now = new Date();
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} `
    + `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}.${pad(now.getMilliseconds(), 3)}`;
};

const log = (tag, message) => {
  const line = `${timestamp()} [${tag}] ${message}`;
  console.log(line);
  if (options.log) appendFileSync(options.log, `${line}\n`, 'utf8');
};

// Make terminators visible so it's obvious whether a client sends \r, \n or \0.
const visible = (text) => text.replace(/\r/g, '\\r').replace(/\n/g, '\\n').replace(/\0/g, '\\0');

const startProjector = (host, index) => {
  const tag = `${host}:${port}`;
  const state = createProjectorState({
    name: hosts.length > 1 ? `${options.name} #${index + 1}` : options.name,
    lampHours: Number(options['lamp-hours']),
    password: options.password,
  });

  const server = net.createServer((socket) => {
    const peer = `${socket.remoteAddress?.replace(/^::ffff:/, '')}:${socket.remotePort}`;
    const session = createSession(state);
    let buffer = '';

    log(tag, `connected <- ${peer}`);
    socket.setTimeout(idleTimeoutMs);

    const send = (line) => {
      log(tag, `TX -> ${peer}  ${visible(`${line}\r`)}`);
      socket.write(`${line}\r`);
    };

    send(greeting(session));

    socket.on('data', (chunk) => {
      const text = chunk.toString('latin1');
      log(tag, `RX <- ${peer}  ${visible(text)}  (hex ${chunk.toString('hex')})`);
      buffer += text;

      // Spec says \r, but accept \n, \r\n and \0 too.
      const lines = buffer.split(/\r\n|\r|\n|\0/);
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        if (!line) continue;
        const result = handleLine(session, line);
        for (const event of result.events) log(tag, `   * ${event}`);
        if (result.reply !== null) send(result.reply);
        if (result.close) {
          socket.end();
          return;
        }
        if (result.transition) {
          setTimeout(() => {
            if (finishPowerTransition(state, result.transition)) {
              log(tag, `   * power -> ${powerLabel(state.power)}`);
            }
          }, warmupMs);
        }
      }
    });

    socket.on('timeout', () => {
      log(tag, `idle for ${idleTimeoutMs / 1000}s, closing (${peer})`);
      socket.end();
    });
    socket.on('error', (error) => log(tag, `socket error (${peer}): ${error.message}`));
    socket.on('close', () => log(tag, `closed (${peer})`));
  });

  server.on('error', (error) => {
    log(tag, `listen failed: ${error.message}`);
    if (error.code === 'EADDRINUSE') log(tag, '   * port already in use (another simulator or a PJLink service?)');
    if (error.code === 'EADDRNOTAVAIL') log(tag, '   * address not on this machine; use 127.0.0.x or a local IP');
  });

  server.listen(port, host, () => {
    log(tag, `listening - name "${state.name}", power ${powerLabel(state.power)}, `
      + `auth ${state.password ? `on (password "${state.password}")` : 'off'}`);
  });
};

log('sim', `PJLink simulator - ${hosts.length} projector(s), port ${port}, warm-up/cool-down ${warmupMs / 1000}s`);
hosts.forEach(startProjector);
