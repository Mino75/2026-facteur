// index.js
import { spawn } from "node:child_process";

const BASE_URL = process.argv[2];
const AUTH = process.argv[3] || "";
const DEVICE_ID = process.argv[4] || "phone1";
const POLL_INTERVAL = 20000;
const FETCH_TIMEOUT_MS = 20000;
const ACK_TIMEOUT_MS = 10000;

if (!BASE_URL) {
  console.error("Usage: node index.js <base_url> <api_key> [device_id]");
  process.exit(1);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(t);
  }
}

async function fetchNext() {
  try {
    const res = await fetchWithTimeout(
      `${BASE_URL}/sms/next?device=${encodeURIComponent(DEVICE_ID)}`,
      { headers: AUTH ? { Authorization: `Bearer ${AUTH}` } : {} },
      FETCH_TIMEOUT_MS
    );

    if (res.status === 204) return null;
    if (!res.ok) return null;

    return await res.json();
  } catch {
    return null;
  }
}

function sendSMS(to, body) {
  return new Promise((resolve, reject) => {
    const p = spawn("termux-sms-send", ["-n", String(to), String(body)], {
      stdio: ["ignore", "ignore", "ignore"],
    });
    p.on("error", reject);
    p.on("close", (code) => (code === 0 ? resolve() : reject(new Error(String(code)))));
  });
}

async function ack(id, status) {
  try {
    await fetchWithTimeout(
      `${BASE_URL}/sms/ack`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(AUTH ? { Authorization: `Bearer ${AUTH}` } : {}),
        },
        body: JSON.stringify({ id, status }),
      },
      ACK_TIMEOUT_MS
    );
  } catch {}
}

(async function loop() {
  while (true) {
    const cmd = await fetchNext();
    if (!cmd) {
      await sleep(POLL_INTERVAL);
      continue;
    }

    try {
      await sendSMS(cmd.to, cmd.body);
      await ack(cmd.id, "sent");
    } catch {
      await ack(cmd.id, "failed");
      await sleep(POLL_INTERVAL);
    }
  }
})();
