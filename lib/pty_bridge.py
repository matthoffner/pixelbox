#!/usr/bin/env python3
import os
import pty
import select
import fcntl
import struct
import sys
import termios


def set_winsize(fd: int, rows: int, cols: int) -> None:
    data = struct.pack("HHHH", rows, cols, 0, 0)
    fcntl.ioctl(fd, termios.TIOCSWINSZ, data)


def main() -> int:
    argv = sys.argv[1:] if len(sys.argv) > 1 else [os.environ.get('SHELL', '/bin/zsh')]

    pid, master_fd = pty.fork()
    if pid == 0:
      os.execvp(argv[0], argv)

    rows = int(os.environ.get('PXCODE_PTY_ROWS', '24'))
    cols = int(os.environ.get('PXCODE_PTY_COLS', '80'))
    try:
      set_winsize(master_fd, rows, cols)
    except OSError:
      pass

    stdout_fd = sys.stdout.fileno()
    stdin_fd = None

    try:
      stdin_fd = sys.stdin.fileno()
    except (AttributeError, OSError, ValueError):
      stdin_fd = None

    try:
      while True:
        read_fds = [master_fd]
        if stdin_fd is not None:
          read_fds.append(stdin_fd)

        ready, _, _ = select.select(read_fds, [], [])

        if master_fd in ready:
          try:
            data = os.read(master_fd, 4096)
          except OSError:
            break

          if not data:
            break

          os.write(stdout_fd, data)

        if stdin_fd is not None and stdin_fd in ready:
          try:
            data = os.read(stdin_fd, 4096)
          except OSError:
            stdin_fd = None
            continue

          if not data:
            stdin_fd = None
            continue

          os.write(master_fd, data)
    finally:
      try:
        os.close(master_fd)
      except OSError:
        pass

    return 0


if __name__ == '__main__':
    raise SystemExit(main())
