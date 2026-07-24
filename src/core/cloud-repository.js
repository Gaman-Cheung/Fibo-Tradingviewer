/** Shared network boundary for the existing Supabase fibo_data row. */
import { CLOUD_TABLE } from './config.js';

export async function getAuthenticatedUser(client) {
  const { data, error } = await client.auth.getUser();
  return { user:data?.user || null, error };
}

export function loadCloudRow(client, userId, columns = '*') {
  return client.from(CLOUD_TABLE).select(columns).eq('user_id', userId).single();
}

export function upsertCloudRow(client, payload) {
  return client.from(CLOUD_TABLE).upsert(payload, { onConflict:'user_id' });
}
