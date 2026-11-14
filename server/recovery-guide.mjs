// One table for every next_action the runtime and scripts can return.
// actor: who must act next (agent, human at the desk, or operator inspecting
// private evidence). command: the exact CLI command, or null with a reason.
// safe_when: the condition under which that step is safe. Replies receive this
// as an additive `recovery` object; tests fail when a next_action has no entry.
const A='agent',H='human',O='operator';
const entry=(actor,command,safe_when,reason)=>Object.freeze(command===null?{actor,command,safe_when,reason}:{actor,command,safe_when});
export const RECOVERY_GUIDE=Object.freeze({
 discover_or_launch:entry(A,'apps','Controls are visible and the task is ready.'),
 observe_again:entry(A,'snapshot','Always; take a fresh observation before any further input.'),
 use_returned_frame:entry(A,null,'The reply carries a fresh frame and no input was sent; continue from its observation_id instead of taking another snapshot.','The refusal already includes the current view.'),
 focus_target_then_observe:entry(A,'focus','The target window still exists; observe again after focusing.'),
 discover_apps_then_observe:entry(A,'apps','Always; pick the window again from the list before observing.'),
 inspect_effect_without_replay:entry(A,'snapshot','Always; check what changed and never repeat the uncertain action.'),
 observe_and_retarget:entry(A,'snapshot','No click or other input reached the target. Observe again, then target the control by index or name, or wait until the covering window is gone; never click through it.'),
 fix_drag_points:entry(A,'drag','No input was sent. Send the drag once with either from/to or 2 to 400 points; on macOS use from/to segments.'),
 fix_app_path:entry(A,'launch','Nothing was started. Launch again once with the full path of an existing executable; for a Windows 11 Store app use the .exe inside (Get-AppxPackage <name>).InstallLocation. No approval or setup step is involved.'),
 observe_app_no_picker:entry(A,'snapshot','No filename was entered. The control did not open a picker; observe the app and send file_dialog only after a picker is seen.'),
 retry_file_dialog_with_keyboard:entry(A,'file_dialog','Nothing was pasted and no confirmation was sent. Observe the dialog, then run file_dialog alone once with --entry-method keyboard; a filename mismatch is refused before confirmation.'),
 enter_without_clipboard:entry(A,'snapshot','Nothing was pasted. Observe again, then enter short text with type, a file name with file_dialog --entry-method keyboard, or ask the human to copy something else first.'),
 ready_then_use_task_token:entry(A,'ready','No other task is open in this session.'),
 end_owned_task_then_shutdown:entry(A,'end','This session owns the open task.'),
 end_owned_task_then_reauthorize:entry(A,'end','This session owns the open task; ask the human for a new grant afterwards.'),
 end_recovered_task:entry(A,'end','The reply reports the leftover task never sent input and its owner is gone; run end once.'),
 wait_for_controller_then_observe:entry(A,'status','Wait until status shows no other task, then observe again.'),
 wait_for_task_end:entry(A,'status','Wait until status shows task_open false before updating.'),
 inspect_recovered_task:entry(A,'end','Run end once; if it is refused, follow the recovery in that reply.'),
 inspect_status_then_human_controls:entry(A,'status','Read status; if stopped or paused, ask the human to use the control bar.'),
 await_user_decision:entry(H,null,'The human answers the approval prompt on screen.','Approvals are human-only.'),
 awaiting_human_rearm:entry(H,null,'The human presses re-arm on the control bar after checking the desktop.','Re-arm is human-only.'),
 awaiting_human_resume:entry(H,null,'The human presses resume on the control bar.','Resume is human-only.'),
 awaiting_human_owner_rearm:entry(H,null,'The human re-arms in the installation that holds the Stop.','Re-arm is human-only.'),
 await_human_window_recovery:entry(H,null,'The human restores or shows the target window.','Window state is changed by the human.'),
 await_human_space_switch:entry(H,null,'The human switches to the desktop or Space holding the target.','Desktop switching is human-only.'),
 await_human_fullscreen_exit:entry(H,null,'The human leaves full screen on the target.','Full-screen exit is human-only.'),
 await_human_permission_grant:entry(H,null,'The human grants the requested OS permission in system settings.','OS permissions are human-only.'),
 human_start_on_visible_desktop:entry(H,null,'The human opens the installed Start Computer Use launcher once on the normal desktop.','Starting on the visible desktop is human-only.'),
 await_legacy_owner_shutdown:entry(H,null,'The human closes the older controller that still owns the desktop.','The older controller cannot be ended by this one.'),
 inspect_prior_input_cleanup:entry(O,'diagnostics','Run diagnostics once and report the incident ID; the previous task may have sent input, so do not end, re-arm or replay until its cleanup is verified. controls shows the bar with Stop available and re-arm locked.'),
 inspect_input_cleanup:entry(O,'diagnostics','Run diagnostics once; do not restart, re-arm or replay until cleanup is confirmed.'),
 inspect_stop_persistence_without_restart:entry(O,'diagnostics','Run diagnostics once; private storage must be writable before control resumes.'),
 inspect_stop_recovery:entry(O,'diagnostics','Run diagnostics once and report the incident ID.'),
 inspect_diagnostics:entry(O,'diagnostics','Run diagnostics once and report the incident ID; do not repeat the failing command.'),
 resolve_version_mismatch:entry(O,'shutdown','No task is open; then start the installed launcher again.'),
 diagnostic_journal_invalid:entry(O,null,'Report the incident ID; the private journal needs inspection.','Repair needs human inspection of private data.'),
 shutdown_for_update:entry(A,'shutdown','No task is open.'),
 inspect_update_status:entry(O,'update','Run update status once and report the result.'),
 inspect_update_result:entry(O,'update','Run update status once and report the last error.'),
 apply_when_idle:entry(A,null,'The signed update applies automatically once no task is open.','Applied by the updater, not by a command.'),
 update_available:entry(H,'update','The human chooses to apply the update while no task is open.'),
 continue_task:entry(A,null,'Nothing to do; continue the current task.','No action needed.'),
 task_state_unavailable:entry(O,'diagnostics','Run diagnostics once; task state could not be read, so do not update.'),
 reporting_in_progress:entry(A,null,'Another report is being sent; check again later.','A report is already in progress.'),
 reporting_lock_unavailable:entry(O,'diagnostics','Run diagnostics once and report the incident ID.'),
 inspect_interrupted_update:entry(O,'update','Run update status once; the installer keeps the previous release until it verifies.'),
 all_deployments_pinned:entry(O,null,'Unpin a deployment to allow updates.','Pins are an owner decision.'),
 no_signed_release_for_platform:entry(O,null,'Wait for a signed release for this platform.','No compatible release exists yet.'),
 release_signing_not_configured:entry(O,null,'Configure release signing before publishing.','Signing keys are owner-held.'),
 retry_next_day:entry(A,null,'Retry after the daily limit resets.','Rate-limited until tomorrow.'),
 reporting_backoff:entry(A,null,'Retry after the stated backoff.','Reporting is rate-limited.'),
 reporting_consent_required:entry(H,null,'The human consents to sending the report.','Reporting needs consent.'),
 pending_reporting_preferences:entry(H,null,'The human chooses reporting preferences.','Reporting needs consent.'),
 reporting_intent_invalid:entry(A,null,'Fix the report request arguments and retry once.','Invalid request.'),
 github_authentication_or_network_required:entry(H,null,'The human signs in to GitHub or restores network access.','Authentication is human-only.'),
 github_lookup_invalid:entry(O,null,'Report the lookup error.','Unexpected GitHub response.'),
 github_submission_outcome_unknown:entry(O,null,'Check the repository for the report before retrying; never resubmit blindly.','The submission may already exist.')
});
export function recoveryFor(nextAction){return typeof nextAction==='string'?RECOVERY_GUIDE[nextAction]:undefined;}
export function withRecovery(value){
 if(!value||typeof value!=='object'||Array.isArray(value)||value.recovery!==undefined)return value;
 const recovery=recoveryFor(value.next_action);return recovery?{...value,recovery}:value;
}
