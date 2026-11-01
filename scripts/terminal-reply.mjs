// Agent Manager truncated real tool output near 4096 characters. Keep its
// ordinary CLI reply below that boundary; full --json and IPC stay lossless.
export const MAX_BRIEF_REPLY_BYTES = 3500;

// ASCII JSON survives legacy PowerShell stdout decoding, including joiners and
// surrogate pairs. Budget the actual escaped wire representation, not text.
export function encodeReply(value) {
  return JSON.stringify(value).replace(/[^\x00-\x7f]/g, char => '\\u' + char.charCodeAt(0).toString(16).padStart(4, '0'));
}

function oversizedReply(value) {
  const out = {
    ok: typeof value.ok === 'boolean' ? value.ok : false,
    terminal_reply_incomplete: true,
    observation_valid: false,
    tree_incomplete: true,
    observe_before_continuing: true,
    replay_allowed: false,
    next_action: 'inspect_effect_without_replay',
    terminal_reply_error: {code: 'terminal_reply_too_large', message: 'Details did not fit the terminal reply. Inspect the current app without repeating the prior input. Use --json before an intentional full read, never to replay an action.'},
  };
  for (const key of ['input_completed','delivery_unknown','cancellation_requested','ready','task_open','recovered_task','controls_visible','guardian_running','repeated_failure','diagnostic_pending','ended','restart_required','matched','changed','timed_out','aborted','incomplete']) {
    if (typeof value[key] === 'boolean') out[key] = value[key];
  }
  for (const key of ['state','control_reason','permission_mode','build_id','build_version','incident_id','diagnostic_error']) {
    if (typeof value[key] === 'string' && /^[a-zA-Z0-9_.:-]{1,128}$/.test(value[key])) out[key] = value[key];
  }
  for (const key of ['error','verification_error']) {
    const code = value[key]?.code;
    if (typeof code === 'string' && /^[a-zA-Z0-9_:-]{1,100}$/.test(code)) out[key] = {code, message: 'Details omitted from terminal reply; inspect without replay.'};
  }
  if (!out.verification_error) out.verification_error = out.terminal_reply_error;
  if (value.receipt && /^[0-9]{1,10}\.[0-9]{1,16}$/.test(value.receipt.id || '')) {
    out.receipt = {id: value.receipt.id};
    for (const key of ['elapsed_ms','gap_ms']) if (Number.isFinite(value.receipt[key]) && value.receipt[key] >= 0) out.receipt[key] = value.receipt[key];
  }
  if (value.image) out.image_omitted = true;
  if (value.batch || value.completed) {
    out.batch_details_omitted = true;
    const batch = value.batch || value;out.batch_summary = {};
    for (const key of ['failed_index','skipped']) if (Number.isSafeInteger(batch[key]) && batch[key] >= 0 && batch[key] <= 8) out.batch_summary[key] = batch[key];
    if (Array.isArray(batch.completed)) out.batch_summary.completed_steps = batch.completed.length;
  }
  return out;
}

export function briefReply(value) {
  let out = {...value};
  if (out.metadata) {
    const m = out.metadata;delete out.metadata;
    out.observation_id = m.observation_id;out.hwnd = m.hwnd;out.tree = m.tree;
    if (typeof m.tree_incomplete === 'boolean') out.tree_incomplete = m.tree_incomplete || out.tree_incomplete === true;
  }
  if (out.image) out.image = {path: out.image.path, width: out.image.width, height: out.image.height};
  if (out.windows) out.windows = out.windows.map(({hwnd,title,process,minimized,hidden,fullscreen,other_desktop,foreground}) => ({hwnd,title,process,minimized,...(hidden?{hidden:true}:{}),...(fullscreen?{fullscreen:true}:{}),...(other_desktop?{other_desktop:true}:{}),foreground}));
  if (encodeReply(out).length <= MAX_BRIEF_REPLY_BYTES) return out;
  if (typeof out.tree !== 'string') return oversizedReply(out);

  const lines = out.tree.split('\n');
  out = {...out, tree: '', tree_incomplete: true, terminal_tree_truncated: true};
  const render = selected => {
    let previous = -1;const parts = [];
    for (const i of selected) {
      if (i > previous + 1) parts.push('[' + (i - previous - 1) + ' display lines omitted; use snapshot --query]');
      parts.push(lines[i]);previous = i;
    }
    if (previous < lines.length - 1) parts.push('[' + (lines.length - previous - 1) + ' display lines omitted; use snapshot --query]');
    return {...out, tree: parts.join('\n')};
  };
  let best = render([]);
  if (encodeReply(best).length > MAX_BRIEF_REPLY_BYTES) return oversizedReply(out);
  // Never cut a selector/name or renumber native indexes. Skip a single huge
  // line rather than making it impossible to return useful controls at all.
  const available = MAX_BRIEF_REPLY_BYTES - encodeReply(best).length;
  const eligible = lines.map((line,i) => ({i,cost:encodeReply(line).length})).filter(row => row.cost <= available).map(row => row.i);
  let low = 0, high = eligible.length;
  while (low <= high) {
    const count = Math.floor((low + high) / 2), head = Math.ceil(count * 0.6), tail = count - head;
    const selected = [...eligible.slice(0,head),...(tail ? eligible.slice(-tail) : [])];
    const candidate = render(selected);
    if (encodeReply(candidate).length <= MAX_BRIEF_REPLY_BYTES) {best = candidate;low = count + 1;} else high = count - 1;
  }
  return best;
}
