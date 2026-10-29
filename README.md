# PJLink Simulator

**English** | [한국어](README.ko.md)

A fake PJLink projector for testing PJLink control software without real hardware.
It listens on TCP 4352, **logs every command it receives**, and replies according to the PJLink Class 1 specification.

- No dependencies - just Node.js 20 or later.
- Pass several IPs to simulate several projectors at once.
- Behaves like a real device: PJLink authentication (MD5), warm-up/cool-down states, `ERR3` while powered off, and so on.
- Ships with a small client, which also works against real projectors.

## Running

```bash
node src/server.mjs
```

```bash
# 3 projectors, password authentication, log to a file
node src/server.mjs --hosts 127.0.0.1,127.0.0.2,127.0.0.3 --password admin --log pjlink.log
```

| Option | Default | Description |
| --- | --- | --- |
| `--hosts` | `127.0.0.1` | One IP per projector (comma-separated) |
| `--port` | `4352` | PJLink port |
| `--password` | (none) | Enables PJLink authentication (MD5) when set |
| `--warmup` | `3` | Warm-up / cool-down time in seconds. Meanwhile `POWR ?` returns `3`/`2` and other power commands get `ERR3` |
| `--name` | `PJLink Simulator` | Reply to `NAME ?`. With several projectors, `#1`, `#2`, ... is appended |
| `--lamp-hours` | `1234` | Lamp hours reported by `LAMP ?` |
| `--idle-timeout` | `30` | Close the connection after this many idle seconds (spec value) |
| `--log` | (none) | Also write the log to a file |

### Simulating several projectors

Each projector needs its own IP. On a single machine, use loopback addresses:

- Windows: `127.0.0.2`, `127.0.0.3`, ... work out of the box.
- Linux: all of `127.0.0.0/8` is loopback by default.
- macOS: add an alias first - `sudo ifconfig lo0 alias 127.0.0.2`

To accept connections from control software on another machine, pass this machine's real IP to `--hosts` and allow inbound TCP 4352 in the firewall.

## Log

```
2026-10-29 14:02:11.204 [127.0.0.1:4352] connected <- 127.0.0.1:53122
2026-10-29 14:02:11.205 [127.0.0.1:4352] TX -> 127.0.0.1:53122  PJLINK 0\r
2026-10-29 14:02:11.230 [127.0.0.1:4352] RX <- 127.0.0.1:53122  %1POWR 1\r  (hex 2531504f575220310d)
2026-10-29 14:02:11.230 [127.0.0.1:4352]    * power on -> warming up
2026-10-29 14:02:11.231 [127.0.0.1:4352] TX -> 127.0.0.1:53122  %1POWR=OK\r
2026-10-29 14:02:14.232 [127.0.0.1:4352]    * power -> on
```

- `RX` is the raw data sent by the client. `\r`, `\n` and `\0` are made visible and the hex dump is printed too, so you can see exactly which terminator the client uses.
- `TX` is the simulator's reply.
- Lines starting with `*` are the simulator's interpretation (power changes, authentication success/failure, unsupported commands, ...).
- If there is not even a connection line, the control software never connected to this address/port.

## Client

Send commands by hand from another terminal. It works against real projectors as well.

```bash
node src/client.mjs 127.0.0.1 "%1POWR 1" "%1POWR ?" "%1LAMP ?"
node src/client.mjs 127.0.0.1 "%1POWR ?" --password admin
```

```
RX  PJLINK 0\r
TX  %1POWR 1\r
RX  %1POWR=OK\r
TX  %1POWR ?\r
RX  %1POWR=3\r
TX  %1LAMP ?\r
RX  %1LAMP=1234 0\r
```

## Supported commands (Class 1)

| Command | Query `?` | Set |
| --- | --- | --- |
| `POWR` | `0` off / `1` on / `2` cooling down / `3` warming up | `0` off, `1` on |
| `INPT` | Current input (only while on) | `11` `12` `31` `32` `51` |
| `AVMT` | Current mute state (only while on) | `10` `11` `20` `21` `30` `31` |
| `ERST` | `000000` | - |
| `LAMP` | `<hours> <on 1/0>` | - |
| `INST` | `11 12 31 32 51` | - |
| `NAME` `INF1` `INF2` `INFO` | Fixed strings | - |
| `CLSS` | `1` | - |

Response codes: `OK`, `ERR1` undefined command, `ERR2` out-of-range parameter, `ERR3` unavailable time (warming up/cooling down, changing input while off, ...).
Class 2 (`%2...`) commands are answered with `ERR1`.

With authentication enabled, the simulator greets with `PJLINK 1 <random>` and checks the `MD5(random + password)` prefix on the first command.
On mismatch it sends `PJLINK ERRA` and closes the connection.

## Tests

```bash
node --test
```

## License

[MIT](LICENSE)
