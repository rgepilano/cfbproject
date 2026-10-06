// Add, update, remove, or list app logins stored as scrypt hashes in .env.local (APP_USERS).
// Usage: npm run add-user -- <username>     (prompts for password)
//        npm run add-user -- --remove <username>
//        npm run add-user -- --list
import { randomBytes, scryptSync } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";

const ENV_FILE = new URL("../.env.local", import.meta.url);
const args = process.argv.slice(2);

function readEnv() {
  return existsSync(ENV_FILE) ? readFileSync(ENV_FILE, "utf8") : "";
}

function getUsers(text) {
  const line = text.split(/\r?\n/).find((l) => l.startsWith("APP_USERS="));
  return new Map(
    (line ? line.slice("APP_USERS=".length) : "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => [s.split(":")[0], s]),
  );
}

function saveUsers(text, users) {
  const value = `APP_USERS=${[...users.values()].join(",")}`;
  const lines = text.split(/\r?\n/);
  const i = lines.findIndex((l) => l.startsWith("APP_USERS="));
  if (i >= 0) lines[i] = value;
  else lines.push(value);
  writeFileSync(ENV_FILE, lines.join("\n").replace(/\n*$/, "\n"));
}

function askHidden(question) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = (s) => rl.output.write(s.includes(question) ? s : "");
    rl.question(question, (answer) => {
      rl.output.write("\n");
      rl.close();
      resolve(answer);
    });
  });
}

const text = readEnv();
const users = getUsers(text);

if (args[0] === "--list") {
  console.log(users.size ? [...users.keys()].join("\n") : "(no users)");
} else if (args[0] === "--remove" && args[1]) {
  const name = args[1].toLowerCase();
  if (!users.delete(name)) console.log(`No user ${name}`);
  else {
    saveUsers(text, users);
    console.log(`Removed ${name}. Restart the app to apply.`);
  }
} else if (args[0] && !args[0].startsWith("--")) {
  const name = args[0].toLowerCase();
  if (!/^[a-z0-9._-]{2,40}$/.test(name)) {
    console.error("Username: 2-40 chars, letters/digits/._- only");
    process.exit(1);
  }
  const pw = await askHidden(`Password for ${name}: `);
  if (pw.length < 10) {
    console.error("Password must be at least 10 characters.");
    process.exit(1);
  }
  if ((await askHidden("Confirm password: ")) !== pw) {
    console.error("Passwords do not match.");
    process.exit(1);
  }
  const salt = randomBytes(16);
  const hash = scryptSync(pw, salt, 64);
  users.set(name, `${name}:${salt.toString("hex")}:${hash.toString("hex")}`);
  saveUsers(text, users);
  console.log(`Saved ${name}. Restart the app to apply.`);
} else {
  console.log("Usage: npm run add-user -- <username> | --remove <username> | --list");
}
