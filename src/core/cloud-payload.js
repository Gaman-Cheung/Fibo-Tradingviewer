/** Supabase fibo_data wire-format adapter. No network or DOM access. */
export function buildCloudPayload({ userId, lookFirst, thenLeap, waveState, instrumentPool, uiNotes, existingWaveData = {} }) {
  const rows = Array.isArray(lookFirst) ? lookFirst : [];
  const v6Data = rows.length
    ? rows.map((row,index) => index === 0 ? { ...row, __header_notes_v1:uiNotes, __instrument_pool_v1:instrumentPool } : row)
    : [{ __header_notes_v1:uiNotes, __instrument_pool_v1:instrumentPool }];
  return {
    user_id:userId,
    v6_data:v6Data,
    v7_data:Array.isArray(thenLeap) ? thenLeap : [],
    wp_data:{ ...existingWaveData, ...(waveState || {}), instrumentPool, uiNotes }
  };
}

export function unpackCloudPayload(data = {}) {
  const rows = Array.isArray(data.v6_data) ? data.v6_data : [];
  const noteCarrier = rows.find(item => item?.__header_notes_v1);
  const poolCarrier = rows.find(item => item?.__instrument_pool_v1);
  const lookFirst = rows.map(item => {
    const row = { ...item };
    delete row.__header_notes_v1;
    delete row.__instrument_pool_v1;
    return row;
  }).filter(item => ['n','h','l','c'].some(key => Object.prototype.hasOwnProperty.call(item,key)));
  return {
    lookFirst,
    thenLeap:Array.isArray(data.v7_data) ? data.v7_data : [],
    waveState:data.wp_data || null,
    instrumentPool:data.wp_data?.instrumentPool || poolCarrier?.__instrument_pool_v1 || null,
    uiNotes:data.wp_data?.uiNotes || noteCarrier?.__header_notes_v1 || null
  };
}

