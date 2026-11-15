// Shareable incidents are allowlisted metadata, never raw error messages or args.
import fs from 'node:fs';import path from 'node:path';import {createHash} from 'node:crypto';
import {BUILD_ID} from './version.mjs';import {storageOperationAsync} from './storage.mjs';import {acquireServiceLease} from './service-lease.mjs';import {writeAtomicJSON} from './atomic-json.mjs';
import {TOOLS} from './desktop-tools.mjs';
// These are semantic allowlists, not identifier-shaped free text. New error
// codes must be deliberately added before they can appear in public reports.
const operations=new Set([...TOOLS.map(tool=>tool.name),'computer_startup','computer_claim','computer_shutdown','computer_guardian']);
const states=new Set(['idle','active','paused','stopped','starting','unknown']);
const codes=new Set(('guardian_exited guardian_spawn_failed guardian_controls_not_visible guardian_timeout desktop_context_unavailable stale_observation element_stale window_moved no_image control_changed focus_changed window_minimized version_mismatch deployment_policy_mismatch recovered_task_requires_end another_session_busy session_limit recovered_cleanup_unverified input_lease_stale stop_persistence_failed guard_persistence_failed input_cleanup_failed input_outcome_unknown permission_denied approval_timeout confirmation_required control_stopped control_inactive host_exited host_timeout host_write_failed host_spawn_failed op_timeout build_failed capture_failed image_delivery_failed service_ownership_lost update_in_progress task_state_write_failed task_state_invalid diagnostic_journal_invalid incident_publish_outcome_unknown invalid_feedback batch_step_failed wait_change_timeout wait_condition_timeout wait_failure_observed wait_observation_incomplete').split(' '));
// Literal native error codes in the Windows and Mac adapters. Keeping these
// explicit makes permission, display and picker failures actionable without
// accepting arbitrary text from an application or model.
for(const code of ('accessibility_denied ambiguous_selector app_not_approved approval_changed background_unavailable bad_entry_method bad_files bad_keys bad_path bad_point bad_points bad_region bad_selector bad_target bad_text bad_value capture_changed clipboard_busy clipboard_changed clipboard_error clipboard_failed clipboard_preservation_failed clipboard_unsafe cursor_unavailable display_unavailable element_disabled element_not_found encode_failed event_creation_failed file_dialog_confirmation_required file_dialog_field_not_found file_dialog_not_found file_dialog_path_mismatch focus_failed identity_changed index_out_of_range input_rejected invalid_application invalid_dialog_owner invalid_path invalid_window mac_permissions_required native_contract_mismatch no_association no_click_point no_element_at_point no_file_dialog no_filename_box no_native_guard no_scroll_item no_snapshot no_target not_found obscured open_blocked open_failed other_desktop point_off_desktop protected_app readonly snapshot_expired stop_monitor_cleanup_unconfirmed stop_monitor_unavailable stopped_by_user text_limit unknown_key unknown_op unsupported_action unsupported_on_macos user_busy user_in_window wait_timeout window_capture_unavailable window_geometry_failed window_gone window_not_focused window_not_found window_placement_failed window_rect_failed').split(' '))codes.add(code);
codes.add('wait_observation_timeout');codes.add('guardian_request_timeout');codes.add('capture_preparation_timeout');codes.add('guardian_write_failed');codes.add('guardian_stop_unconfirmed');codes.add('window_fullscreen');codes.add('window_hidden');for(const code of ['task_owned','task_required','task_requires_end'])codes.add(code);
for(const category of ['cursor_visual','focus','observation','workflow','performance','missing_capability','unexpected_pause','other'])
 for(const operation of ['observe','click','type','scroll','drag','keyboard','launch','wait','update','other'])
  for(const evidence of ['suspected','observed','reproduced'])codes.add(`agent_${category}_${operation}_${evidence}`);
const allowed=(set,value)=>typeof value==='string'&&set.has(value)?value:'unknown';
function incident(command,result){const code=result.error?.code||result.verification_error?.code;if(!code)return;
 const event={build:BUILD_ID,platform:process.platform,arch:process.arch,operation:allowed(operations,command),code:allowed(codes,code),state:allowed(states,result.state),delivery_unknown:result.delivery_unknown===true||code==='input_outcome_unknown',exit_code:Number.isSafeInteger(result.guardian_exit?.code)?result.guardian_exit.code:null};
 return {event,id:createHash('sha256').update(JSON.stringify(event)).digest('hex').slice(0,24)};
}
export class Incidents {
 constructor(directory){this.directory=directory;this.file=path.join(directory,'incidents.json');this.ackFile=path.join(directory,'incident-acks.json');}
 read({strict=false}={}){
  try{
   if(fs.statSync(this.file).size>256*1024)throw Error('incident journal too large');
   const data=JSON.parse(fs.readFileSync(this.file));if(!Array.isArray(data))throw Error('incident journal is not an array');
   let acknowledgements={};try{const a=JSON.parse(fs.readFileSync(this.ackFile));if(!a||typeof a!=='object'||Array.isArray(a))throw Error('invalid acknowledgements');acknowledgements=a;}catch(error){if(strict&&error.code!=='ENOENT')throw error;}
   return data.slice(-100).filter(e=>/^[a-f0-9]{24}$/.test(e.id||'')).map(e=>({
    id:e.id,build:e.build===BUILD_ID?BUILD_ID:'unknown',platform:['win32','darwin','linux'].includes(e.platform)?e.platform:'unknown',arch:['x64','arm64'].includes(e.arch)?e.arch:'unknown',
    operation:allowed(operations,e.operation),code:allowed(codes,e.code),state:allowed(states,e.state),delivery_unknown:e.delivery_unknown===true,exit_code:Number.isSafeInteger(e.exit_code)?e.exit_code:null,
    count:Number.isSafeInteger(e.count)&&e.count>=0?e.count:0,
    first:/^\d{4}-\d\d-\d\dT[\d:.]+Z$/.test(e.first||'')?String(e.first).slice(0,24):null,
    last:/^\d{4}-\d\d-\d\dT[\d:.]+Z$/.test(e.last||'')?String(e.last).slice(0,24):null,pending:e.pending!==false&&!(Number.isSafeInteger(acknowledgements[e.id])&&acknowledgements[e.id]>=(e.count||0))
   }));
  }catch(error){if(strict&&error.code!=='ENOENT')throw Object.assign(Error('Incident journal requires inspection; existing data was retained.'),{code:'diagnostic_journal_invalid',cause:error});return [];}
 }
 prepare(command,result){
  const details=incident(command,result);if(!details)return;const {event,id}=details;
  const all=this.read({strict:true});let item=all.find(e=>e.id===id);if(!item){item={id,...event,count:0,first:new Date().toISOString(),pending:true};all.push(item);}if(item.count===Number.MAX_SAFE_INTEGER)throw Object.assign(new Error('Incident counter exhausted'),{code:'incident_counter_exhausted'});item.count++;item.pending=true;item.last=new Date().toISOString();
  return {id,records:all.slice(-100)};
 }
 record(command,result,{guard}={}){
  const prepared=this.prepare(command,result);if(!prepared)return;
  const io=guard?{...fs,renameSync(from,to){guard();return fs.renameSync(from,to);}}:fs;
  writeAtomicJSON(this.file,prepared.records,{io});return prepared.id;
 }
 identify(command,result){return incident(command,result)?.id;}
 // Production writers use the separate kernel lease across the complete
 // read/modify/publish operation. record() remains for isolated test setup.
 async recordSerialized(command,result){
  if(!(result.error?.code||result.verification_error?.code))return;
  // Claim the lease before native marker/ACL initialization. Initializing the
  // marker outside the lease lets simultaneous first writers race each other.
  await storageOperationAsync('verify',this.directory);const lockDir=path.join(this.directory,'incident-writer-lease');fs.mkdirSync(lockDir,{recursive:true,mode:0o700});
  // Reporting is off the action response path. Allow a loaded machine time to
  // finish another short publication, but retain a bounded failure outcome.
  const deadline=Date.now()+15000;let lease;
  do{try{lease=await acquireServiceLease(lockDir);break;}catch(error){if(error.code!=='service_already_running'||Date.now()>=deadline)throw error;await new Promise(resolve=>setTimeout(resolve,50));}}while(true);
  try{lease.assertHeld();const prepared=this.prepare(command,result);await lease.publishIncidents(Buffer.from(JSON.stringify(prepared.records)));return prepared.id;}finally{await lease.release();}
 }
}
