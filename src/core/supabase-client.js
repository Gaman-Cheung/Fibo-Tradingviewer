/** Shared Supabase client factory. Requires the CDN global loaded by each page. */
import { SUPABASE_PROFILES } from './config.js';

const clients = new Map();

export function getSupabaseClient(profileName) {
  if (clients.has(profileName)) return clients.get(profileName);
  const profile = SUPABASE_PROFILES[profileName];
  if (!profile) throw new Error(`Unknown Supabase profile: ${profileName}`);
  if (!globalThis.supabase?.createClient) throw new Error('Supabase CDN client is not available');
  const client = globalThis.supabase.createClient(profile.url, profile.key);
  clients.set(profileName, client);
  return client;
}

