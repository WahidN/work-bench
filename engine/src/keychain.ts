import { execa } from 'execa';
import { randomBytes } from 'node:crypto';

const SERVICE = 'workbench';

export async function setSecret(account: string, value: string): Promise<void> {
  await execa('security', [
    'add-generic-password',
    '-U',
    '-s', SERVICE,
    '-a', account,
    '-w', value,
  ]);
}

export async function getSecret(account: string): Promise<string | null> {
  try {
    const { stdout } = await execa('security', [
      'find-generic-password',
      '-s', SERVICE,
      '-a', account,
      '-w',
    ]);
    return stdout.trim();
  } catch {
    return null;
  }
}

export async function deleteSecret(account: string): Promise<void> {
  await execa('security', [
    'delete-generic-password',
    '-s', SERVICE,
    '-a', account,
  ]);
}

export async function getOrCreateApiToken(): Promise<string> {
  const existing = await getSecret('api-token');
  if (existing) return existing;
  const token = randomBytes(32).toString('hex');
  await setSecret('api-token', token);
  return token;
}
