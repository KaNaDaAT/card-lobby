/// <reference types="vite/client" />

/** Build-time settings, read from `.env` files or the environment. See `.env.example`. */
interface ImportMetaEnv {
  /** TURN servers for networks that block direct connections, comma-separated. */
  readonly VITE_TURN_URLS?: string;
  readonly VITE_TURN_USERNAME?: string;
  readonly VITE_TURN_CREDENTIAL?: string;
  /** Nostr relays for signaling, comma-separated. Trystero's defaults when empty. */
  readonly VITE_NOSTR_RELAYS?: string;
}
