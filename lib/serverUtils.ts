import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

// Generate a random port between 3000 and 9999
export function getRandomPort(): number {
  return Math.floor(Math.random() * (9999 - 3000 + 1)) + 3000;
}

// Check if a port is available
export async function isPortAvailable(port: number): Promise<boolean> {
  try {
    await execAsync(`lsof -i :${port}`);
    return false; // Port is in use
  } catch {
    return true; // Port is available
  }
}

// Find an available port
export async function findAvailablePort(): Promise<number> {
  let port = getRandomPort();
  let attempts = 0;
  const maxAttempts = 50;

  while (attempts < maxAttempts) {
    if (await isPortAvailable(port)) {
      return port;
    }
    port = getRandomPort();
    attempts++;
  }

  throw new Error("Could not find an available port");
}

