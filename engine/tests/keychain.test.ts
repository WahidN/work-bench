import { describe, expect, it, vi, afterEach } from 'vitest';
import { execa } from 'execa';
import { setSecret, getSecret, deleteSecret } from '../src/keychain.js';

vi.mock('execa');

afterEach(() => vi.clearAllMocks());

describe('keychain', () => {
  it('setSecret shells out to security add-generic-password with -U to update', async () => {
    vi.mocked(execa).mockResolvedValue({ stdout: '' } as any);
    await setSecret('jira-token', 'abc123');
    expect(execa).toHaveBeenCalledWith('security', [
      'add-generic-password',
      '-U',
      '-s', 'workbench',
      '-a', 'jira-token',
      '-w', 'abc123',
    ]);
  });

  it('getSecret returns the password when found', async () => {
    vi.mocked(execa).mockResolvedValue({ stdout: 'abc123\n' } as any);
    const value = await getSecret('jira-token');
    expect(value).toBe('abc123');
    expect(execa).toHaveBeenCalledWith('security', [
      'find-generic-password',
      '-s', 'workbench',
      '-a', 'jira-token',
      '-w',
    ]);
  });

  it('getSecret returns null when not found', async () => {
    vi.mocked(execa).mockRejectedValue(new Error('security: SecKeychainSearchCopyNext: The specified item could not be found in the keychain.'));
    const value = await getSecret('missing');
    expect(value).toBeNull();
  });

  it('deleteSecret shells out to security delete-generic-password', async () => {
    vi.mocked(execa).mockResolvedValue({ stdout: '' } as any);
    await deleteSecret('jira-token');
    expect(execa).toHaveBeenCalledWith('security', [
      'delete-generic-password',
      '-s', 'workbench',
      '-a', 'jira-token',
    ]);
  });
});
