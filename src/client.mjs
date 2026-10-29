#!/usr/bin/env node
// Minimal PJLink client for poking the simulator or a real projector.
//   node src/client.mjs 127.0.0.1 "%1POWR 1"
//   node src/client.mjs 127.0.0.1 "%1POWR ?" "%1LAMP ?" --password admin

import net from 'node:net';
import { parseArgs } from 'node:util';
import { expectedDigest } from './protocol.mjs';

const { values: options, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    port: { type: 'string', default: '4352' },
    password: { type: 'string', default: '' },
  },
});

const [host, ...commands] = positionals;
if (!host || commands.length === 0) {
  console.log('Usage: node src/client.mjs <ip> "<command>" ["<command>" ...] [--port 4352] [--password value]');
  console.log('e.g.   node src/client.mjs 127.0.0.1 "%1POWR 1" "%1POWR ?"');
  process.exit(1);
}

const visible = (text) => text.replace(/\r/g, '\\r').replace(/\n/g, '\\n');
const socket = net.connect(Number(options.port), host);
let buffer = '';
let digest = '';
const pending = [...commands];

const sendNext = () => {
  const command = pending.shift();
  if (command === undefined) {
    socket.end();
    return;
  }
  // Digest goes on the first command only.
  const line = `${digest}${command}\r`;
  digest = '';
  console.log(`TX  ${visible(line)}`);
  socket.write(line);
};

socket.on('data', (chunk) => {
  buffer += chunk.toString('latin1');
  const lines = buffer.split('\r');
  buffer = lines.pop() ?? '';
  for (const line of lines) {
    console.log(`RX  ${visible(`${line}\r`)}`);
    if (line === 'PJLINK 0') {
      sendNext();
    } else if (line.startsWith('PJLINK 1 ')) {
      if (!options.password) {
        console.log('    * projector requires authentication, pass --password');
        socket.end();
        return;
      }
      digest = expectedDigest(line.slice('PJLINK 1 '.length), options.password);
      sendNext();
    } else if (line === 'PJLINK ERRA') {
      console.log('    * wrong password');
      socket.end();
    } else {
      sendNext();
    }
  }
});

socket.on('error', (error) => {
  console.log(`connection failed: ${error.message}`);
  process.exitCode = 1;
});
