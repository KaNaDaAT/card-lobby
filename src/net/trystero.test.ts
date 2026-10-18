import { describe, expect, it } from 'vitest';
import { roomConfig } from './trystero';

const env = (vars: Partial<ImportMetaEnv>) => ({ ...vars }) as ImportMetaEnv;

describe('roomConfig', () => {
  it('uses the code as password and leaves TURN and relays to Trystero by default', () => {
    const config = roomConfig('ABCDEFGH', env({}));
    expect(config).toEqual({ appId: 'card-lobby', password: 'ABCDEFGH', maxReceiveBytes: 30 * 1024 * 1024 });
  });

  it('reads TURN servers and relays from the build settings', () => {
    const config = roomConfig(
      'ABCDEFGH',
      env({
        VITE_TURN_URLS: 'turn:a.example:3478, turns:a.example:443',
        VITE_TURN_USERNAME: 'friends',
        VITE_TURN_CREDENTIAL: 'secret',
        VITE_NOSTR_RELAYS: 'wss://relay.one, ,wss://relay.two',
      }),
    );
    expect(config.turnConfig).toEqual([{ urls: ['turn:a.example:3478', 'turns:a.example:443'], username: 'friends', credential: 'secret' }]);
    expect(config.relayConfig).toEqual({ urls: ['wss://relay.one', 'wss://relay.two'] });
  });
});
