import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function applyDotEnv() {
    const envPath = path.join(__dirname, '.env');
    if (!existsSync(envPath)) {
        return;
    }

    const fileContents = readFileSync(envPath, 'utf8');

    for (const rawLine of fileContents.split('\n')) {
        const line = rawLine.trim();
        if (!line || line.startsWith('#')) {
            continue;
        }

        const separatorIndex = line.indexOf('=');
        if (separatorIndex === -1) {
            continue;
        }

        const key = line.slice(0, separatorIndex).trim();
        const value = line.slice(separatorIndex + 1).trim();

        if (!(key in process.env)) {
            process.env[key] = value;
        }
    }
}

export {
    applyDotEnv,
};
