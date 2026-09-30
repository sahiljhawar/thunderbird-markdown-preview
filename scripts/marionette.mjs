// SPDX-License-Identifier: GPL-3.0-or-later
// Minimal Marionette (Firefox/Thunderbird remote control) client over TCP, no dependencies.
// Protocol: each message is "<length>:<json>", requests are [0, id, command, params],
// responses are [1, id, error, result].

import net from "node:net";

export class Marionette {
  static async connect({ host = "127.0.0.1", port = 2828, timeoutMs = 60000 } = {}) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      try {
        const client = new Marionette();
        await client.#open(host, port);
        return client;
      } catch (e) {
        if (Date.now() > deadline) throw new Error(`Marionette not reachable: ${e.message}`);
        await new Promise((r) => setTimeout(r, 500));
      }
    }
  }

  #socket;
  #buffer = Buffer.alloc(0);
  #pending = new Map();
  #nextId = 1;
  #greeted;

  #open(host, port) {
    return new Promise((resolve, reject) => {
      this.#socket = net.createConnection({ host, port });
      this.#greeted = { resolve };
      this.#socket.once("error", reject);
      this.#socket.on("data", (chunk) => this.#onData(chunk));
    });
  }

  #onData(chunk) {
    this.#buffer = Buffer.concat([this.#buffer, chunk]);
    for (;;) {
      const colon = this.#buffer.indexOf(0x3a);
      if (colon < 0) return;
      const length = Number(this.#buffer.subarray(0, colon).toString());
      if (this.#buffer.length < colon + 1 + length) return;
      const body = this.#buffer.subarray(colon + 1, colon + 1 + length).toString();
      this.#buffer = this.#buffer.subarray(colon + 1 + length);
      const message = JSON.parse(body);
      if (this.#greeted) {
        this.#greeted.resolve();
        this.#greeted = null;
      } else if (Array.isArray(message) && message[0] === 1) {
        const [, id, error, result] = message;
        const waiter = this.#pending.get(id);
        this.#pending.delete(id);
        if (error) waiter?.reject(new Error(`${error.error}: ${error.message}`));
        else waiter?.resolve(result);
      }
    }
  }

  send(command, params = {}) {
    const id = this.#nextId++;
    const json = JSON.stringify([0, id, command, params]);
    return new Promise((resolve, reject) => {
      this.#pending.set(id, { resolve, reject });
      this.#socket.write(`${Buffer.byteLength(json)}:${json}`);
    });
  }

  async newSession() {
    return this.send("WebDriver:NewSession", { capabilities: {} });
  }

  setContext(value) {
    return this.send("Marionette:SetContext", { value });
  }

  /** Runs `script` (a function body) in the current context and returns its value. */
  async run(script, args = []) {
    const result = await this.send("WebDriver:ExecuteScript", { script, args });
    return result && "value" in result ? result.value : result;
  }

  installTemporaryAddon(path) {
    return this.send("Addon:Install", { path, temporary: true });
  }

  close() {
    this.#socket?.destroy();
  }
}
