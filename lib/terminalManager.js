class TerminalManager {
  constructor({ createSession, sendData, sendExit }) {
    this.createSession = createSession;
    this.sendData = sendData;
    this.sendExit = sendExit;
    this.sessions = new Map();
    this.activeKey = null;
  }

  start(key, options) {
    const existingSession = this.sessions.get(key);
    this.activeKey = key;
    if (existingSession) {
      return {
        ok: true,
        created: false,
        hasPseudoTTY: existingSession.hasPseudoTTY === true,
      };
    }

    return this.#launch(key, options);
  }

  restart(key, options) {
    this.activeKey = key;
    const previousSession = this.sessions.get(key);
    if (previousSession) {
      previousSession.kill();
    }

    return this.#launch(key, options);
  }

  write(data, key = this.activeKey) {
    const session = key ? this.sessions.get(key) : null;
    if (session) {
      session.write(data);
    }
  }

  resize(cols, rows, key = this.activeKey) {
    const session = key ? this.sessions.get(key) : null;
    if (session) {
      session.resize(cols, rows);
    }
  }

  kill(key) {
    if (key) {
      const session = this.sessions.get(key);
      this.sessions.delete(key);
      if (this.activeKey === key) this.activeKey = null;
      if (session) session.kill();
      return;
    }

    for (const session of this.sessions.values()) {
      session.kill();
    }
    this.sessions.clear();
    this.activeKey = null;
  }

  #launch(key, options) {
    const session = this.createSession(options);
    this.sessions.set(key, session);

    session.onData((data) => {
      if (this.sessions.get(key) !== session) return;
      this.sendData({ key, data });
    });

    session.onExit(() => {
      if (this.sessions.get(key) !== session) return;
      this.sessions.delete(key);
      if (this.activeKey === key) this.activeKey = null;
      this.sendExit({ key });
    });

    return {
      ok: true,
      created: true,
      hasPseudoTTY: session.hasPseudoTTY === true,
    };
  }
}

module.exports = {
  TerminalManager,
};
