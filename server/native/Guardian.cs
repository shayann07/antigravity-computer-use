// Antigravity integration: local human consent and native input fence.
// Recovery algorithm adapted from OpenAI openai-cua-sample-app (MIT),
// desktop/release_inputs.py, revision 6dd34b40acc1d002696ccd41aaf0a1f2f2be290c.
using System;
using System.IO;
using System.Text;
using System.Diagnostics;
using System.Threading;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Windows.Forms;
using System.Runtime.InteropServices;
using System.Collections.Generic;
using System.Security.Cryptography;
using System.Windows.Automation;
using System.Web.Script.Serialization;

namespace Axon {
    // Milliseconds since boot, including sleep, shared by native processes.
    // The watchdog still needs independent expiry cleanup; see issue #18.
    internal static class NativeDeadline {
        [DllImport("kernel32.dll")] internal static extern ulong GetTickCount64();
        internal static ulong Create(long requestedTicks,long wallNow,ulong bootNow,int maximumMs) {
            if(wallNow<0||requestedTicks<=wallNow||maximumMs<=0)return 0;
            long remaining=(requestedTicks-wallNow)/TimeSpan.TicksPerMillisecond;
            if(remaining<=0)return 0;
            ulong duration=(ulong)Math.Min(remaining,(long)maximumMs);
            if(UInt64.MaxValue-bootNow<duration)return 0;
            return bootNow+duration;
        }
        internal static bool Valid(ulong until,ulong now) {return until>now;}
    }
    internal static class ControlFence {
        [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out int pid);
        internal static Dictionary<string, object> Identity(long hwnd) {
            int pid; GetWindowThreadProcessId(new IntPtr(hwnd), out pid);
            if (pid <= 0) throw new AxonError("window_not_found", "Window closed.", null);
            using (Process p=Process.GetProcessById(pid)) {
                string exe=p.MainModule.FileName;
                string started=p.StartTime.ToUniversalTime().Ticks.ToString();
                Native.RECT r; Native.GetWindowRect(new IntPtr(hwnd),out r); Native.POINT cursor; Native.GetCursorPos(out cursor);
                StringBuilder windowClass=new StringBuilder(256);Native.GetClassName(new IntPtr(hwnd),windowClass,windowClass.Capacity);
                return new Dictionary<string, object> { {"class",windowClass.ToString()},{"root",Native.GetAncestor(new IntPtr(hwnd),2).ToInt64()},{"owner",Native.GetWindowRel(new IntPtr(hwnd),4).ToInt64()},{"cursor",new int[]{cursor.X,cursor.Y}},{"visible",Native.IsWindowVisible(new IntPtr(hwnd))},{"cloaked",Native.IsCloaked(new IntPtr(hwnd))},{"overlay",Overlay.IsAnyOverlayWindow(new IntPtr(hwnd))},{"rect",new int[]{r.Left,r.Top,r.Right-r.Left,r.Bottom-r.Top}}, {"hwnd",hwnd}, {"pid",pid}, {"path",exe},
                    {"started",started}, {"key",pid+":"+started+":"+exe.ToLowerInvariant()} };
            }
        }
        static object Canonical(object value) {
            Dictionary<string, object> d=value as Dictionary<string, object>;
            if (d!=null) {
                SortedDictionary<string, object> sorted=new SortedDictionary<string, object>(StringComparer.Ordinal);
                foreach(var pair in d) if (!pair.Key.StartsWith("__")) sorted[pair.Key]=Canonical(pair.Value);
                return sorted;
            }
            object[] arr=value as object[];
            if(arr!=null) { object[] copy=new object[arr.Length]; for(int i=0;i<arr.Length;i++) copy[i]=Canonical(arr[i]); return copy; }
            return value;
        }
        internal static string Fingerprint(string op, Dictionary<string, object> a, string label) {
            string s=op+"|"+label+"|"+new JavaScriptSerializer().Serialize(Canonical(a));
            using(SHA256 sha=SHA256.Create()) return Convert.ToBase64String(sha.ComputeHash(Encoding.UTF8.GetBytes(s)));
        }
        internal static bool Sensitive(string op, Dictionary<string, object> a, string label) {
            label=SnapshotText.RiskLabel(label);
            object risk;
            if (!a.TryGetValue("__risk",out risk) || Convert.ToString(risk)!="routine") return true;
            if (ControlContract.SensitiveOperation(op)) return true;
            if (ControlContract.AmbiguousOperation(op) && String.IsNullOrWhiteSpace(label)) return true;
            if(op=="key") {
                string key=Convert.ToString(a["keys"]).ToLowerInvariant();
                if(ControlContract.Pattern("sensitive_key_pattern","enter|return|delete|alt\\+|option\\+|win|meta|super|(?:ctrl|cmd|command)\\+(?:(?:shift|alt|option)\\+)*[svx](?![a-z0-9])",key)) return true;
            }
            if(a.ContainsKey("hwnd")) {
                string name=Path.GetFileNameWithoutExtension(Convert.ToString(ControlFence.Identity(Convert.ToInt64(a["hwnd"]))["path"])).ToLowerInvariant();
                System.Text.StringBuilder cls=new System.Text.StringBuilder(256); Native.GetClassName(new IntPtr(Convert.ToInt64(a["hwnd"])),cls,cls.Capacity);
                bool console=cls.ToString().Contains("Console")||cls.ToString().Contains("CASCADIA")||cls.ToString().Contains("mintty");
                // A click-only app (terminal or IDE) is fenced by its tier: the
                // few operations that tier allows need no extra card, and every
                // other one is refused outright before it gets here.
                bool tierAllowed=false;
                try {tierAllowed=ClickTierAllows(op,a)&&ClickTierGranted(Convert.ToString(ControlFence.Identity(Convert.ToInt64(a["hwnd"]))["key"]));}catch {}
                if((console||ControlContract.Pattern("sensitive_process_pattern","^(windowsterminal|regedit|systemsettings|control|code|idea64|rider64)$",name)) && op!="focus" && !tierAllowed) return true;
            }
            if(ControlContract.Pattern("sensitive_label_pattern","send|submit|pay|purchase|buy|delete|remove|install|upload|share|password|permission|transfer|sign.in",label)) return true;
            return false;
        }
        internal static string FileName { get { return Environment.GetEnvironmentVariable("AGCU_GUARD_FILE"); } }
        // Access tiers. A click-only app accepts a plain left click, pointer
        // moves, scrolling and focus. Everything else is refused, both for the
        // target window and whenever such an app is the frontmost window, so
        // a terminal that comes forward between check and dispatch cannot
        // receive typing meant for another app.
        internal static bool ClickTierAllows(string op,Dictionary<string,object> a) {
            if(op=="focus"||op=="move"||op=="scroll"||op=="fit_window"||op=="resize_window")return true;
            if(op!="click")return false;
            object value;
            if(a.TryGetValue("button",out value)&&value!=null) {string button=Convert.ToString(value);if(button!=""&&button!="left")return false;}
            if(a.TryGetValue("modifiers",out value)&&value!=null) {
                object[] list=value as object[];
                if(list!=null?list.Length>0:Convert.ToString(value)!="")return false;
            }
            return true;
        }
        internal static HashSet<string> ClickTierKeys(string[] state) {
            HashSet<string> keys=new HashSet<string>();
            if(state==null||state.Length<6||state[5]=="")return keys;
            try {foreach(string key in Encoding.UTF8.GetString(Convert.FromBase64String(state[5])).Split('\n'))if(key!="")keys.Add(key);}catch {}
            return keys;
        }
        internal static bool ClickTierGranted(string appKey) {
            try {return ClickTierKeys(AtomicFile.ReadAllText(FileName).Split('|')).Contains(appKey);}catch {return false;}
        }
        static void CheckTier(string op,Dictionary<string,object> a,string appKey,string[] state) {
            HashSet<string> click=ClickTierKeys(state);
            if(click.Count==0||ClickTierAllows(op,a))return;
            if(appKey!=""&&click.Contains(appKey))
                throw new AxonError("app_tier_click","This app is click only (terminal or IDE). The input was refused and nothing was sent.","Use your own shell tool, or ask the human to do this step.");
            IntPtr front=Native.GetForegroundWindow();
            if(front==IntPtr.Zero)return;
            string frontKey=null;
            try {frontKey=Convert.ToString(Identity(front.ToInt64())["key"]);}catch {}
            if(frontKey!=null&&click.Contains(frontKey))
                throw new AxonError("app_tier_click","A click-only app (terminal or IDE) is in front, so this input was refused and nothing was sent.","Bring the target app to the front, observe again, then retry.");
        }
        internal static bool LatchEntryBlocks(string file) {
            if(String.IsNullOrEmpty(file))return true;
            try {if(!Path.IsPathRooted(file)||!Directory.Exists(Path.GetDirectoryName(file)))return true;File.GetAttributes(file);return true;}
            catch(FileNotFoundException){return false;}
            catch(DirectoryNotFoundException){return true;}
            catch{return true;}
        }
        internal static bool LatchBlocks(string file) {
            return String.IsNullOrEmpty(file)||LatchEntryBlocks(file)||LatchEntryBlocks(file+".unconfirmed");
        }
        internal static string Token;
        static long keyboardTarget;
        static long keyboardOwner;
        static string keyboardOwnerKey, keyboardDialogKey;
        static bool focusing;
        internal static void CheckOwnedDialog() {
            Check();
            if(keyboardOwner==0)return;
            IntPtr dialog=new IntPtr(keyboardTarget),owner=new IntPtr(keyboardOwner);
            IntPtr direct=Native.GetWindowRel(dialog,4);
            if((direct!=owner && (direct==IntPtr.Zero||Native.GetWindowRel(direct,4)!=owner)) ||
                Convert.ToString(Identity(keyboardOwner)["key"])!=keyboardOwnerKey ||
                Convert.ToString(Identity(keyboardTarget)["key"])!=keyboardDialogKey)
                throw new AxonError("identity_changed","Approved file dialog ownership changed; no more input sent.",null);
        }
        sealed class DialogKeyboardScope : IDisposable {
            readonly long previous;
            internal DialogKeyboardScope(long owner,long dialog) {
                previous=keyboardTarget;
                keyboardOwner=owner;keyboardTarget=dialog;
                try {
                    keyboardOwnerKey=Convert.ToString(Identity(owner)["key"]);
                    keyboardDialogKey=Convert.ToString(Identity(dialog)["key"]);
                    CheckOwnedDialog();
                }
                catch { Dispose(); throw; }
            }
            public void Dispose() { keyboardTarget=previous;keyboardOwner=0;keyboardOwnerKey=null;keyboardDialogKey=null; }
        }
        internal static IDisposable ForOwnedDialog(IntPtr owner,IntPtr dialog) {
            if(owner==IntPtr.Zero||dialog==IntPtr.Zero||keyboardTarget!=owner.ToInt64())
                throw new AxonError("invalid_dialog_owner","File picker requires the approved owner window.",null);
            return new DialogKeyboardScope(owner.ToInt64(),dialog.ToInt64());
        }
        internal static bool SameKeyboardWindow(IntPtr expected,IntPtr actual) {
            return KeyboardTargetPolicy.Same(expected.ToInt64(),actual.ToInt64(),
                Native.GetAncestor(expected,2).ToInt64(),Native.GetAncestor(actual,2).ToInt64());
        }
        internal static void CheckKeyboard() {
            CheckOwnedDialog();
            IntPtr actual=Native.GetForegroundWindow();
            if(!focusing && keyboardTarget!=0 && !SameKeyboardWindow(new IntPtr(keyboardTarget),actual)) {
                StringBuilder cls=new StringBuilder(256);Native.GetClassName(actual,cls,cls.Capacity);int pid;GetWindowThreadProcessId(actual,out pid);
                throw new AxonError("focus_changed","Keyboard target lost foreground; no more text sent.",
                    "expected_hwnd="+keyboardTarget+" actual_hwnd="+actual.ToInt64()+" expected_root="+Native.GetAncestor(new IntPtr(keyboardTarget),2).ToInt64()+" actual_root="+Native.GetAncestor(actual,2).ToInt64()+" actual_class="+cls+" actual_pid="+pid+". Observe again; do not repeat a partially delivered chord.");
            }
        }
        internal static void Check() {
            if (String.IsNullOrEmpty(FileName)) throw new AxonError("no_native_guard", "Native approval runtime required.", null);
            string latch=Environment.GetEnvironmentVariable("AGCU_STOP_LATCH");
            if(LatchBlocks(latch))throw new AxonError("control_stopped","The human stopped this task. No input was sent. Report and wait; the next ready starts a fresh task.",null);
            string[] state;string original;
            try { original=AtomicFile.ReadAllText(FileName);state = original.Split('|'); }
            catch { throw new AxonError("control_stopped", "Permission process is unavailable.", null); }
            long until;ulong bootUntil;
            if (state.Length < 5 || state[0] != "active" || state[1] != Token ||
                !Int64.TryParse(state[2], out until) || DateTime.UtcNow.Ticks >= until ||
                !UInt64.TryParse(state[4],out bootUntil) || !NativeDeadline.Valid(bootUntil,NativeDeadline.GetTickCount64()))
                throw new AxonError("control_stopped", "Control is paused, stopped or expired. Use the local controls.", null);
            CheckWatchdogIdentity(FileName);
            // A Stop or state transition may occur while watchdog identity is
            // being revalidated. Never use the earlier state after it changed.
            try {
                if(!GuardUnchanged(original,AtomicFile.ReadAllText(FileName),LatchBlocks(latch)))
                    throw new AxonError("control_stopped","Control changed during watchdog verification. No further input is allowed.",null);
            } catch(AxonError) { throw; }
              catch { throw new AxonError("control_stopped","Control state is unavailable. No further input is allowed.",null); }
            if(!(bool)DesktopContext.Inspect()["interactive"])
                throw new AxonError("desktop_context_unavailable","The input desktop changed. No further automation is allowed; return to the normal desktop and use local human controls.",null);
        }
        internal static bool GuardUnchanged(string before,string after,bool latched) {
            return !latched&&before!=null&&String.Equals(before,after,StringComparison.Ordinal);
        }
        // The worker checks the independent watchdog's process identity itself;
        // stale metadata or an exited watchdog must never permit input.
        internal static void CheckWatchdogIdentity(string file) {
            if(!ConfirmWatchdog(delegate {return WatchdogIdentityProblem(file);},delegate {Thread.Sleep(10);} ))
                throw new AxonError("stop_monitor_unavailable","Independent cleanup watchdog is unavailable. No further input is allowed.",null);
        }
        internal static bool ConfirmWatchdog(Func<string> probe,Action wait) {
            // Bounded revalidation absorbs a transient OS/process inspection
            // failure without ever sending input on an unconfirmed identity.
            for(int attempt=0;attempt<3;attempt++) {
                if(probe()==null)return true;
                if(attempt<2)wait();
            }
            return false;
        }
        internal static string WatchdogIdentityProblem(string file) {
            try {
                string marker=file+".watchdog";FileAttributes attributes=File.GetAttributes(marker);
                if((attributes&(FileAttributes.ReparsePoint|FileAttributes.Directory))!=0)return "marker_type";
                byte[] bytes=new byte[129];int used=0;
                using(var stream=new FileStream(marker,FileMode.Open,FileAccess.Read,FileShare.ReadWrite|FileShare.Delete)) {
                    int n;while(used<bytes.Length&&(n=stream.Read(bytes,used,bytes.Length-used))>0)used+=n;
                }
                if(used>128)return "marker_too_large";
                string[] watcher=new UTF8Encoding(false,true).GetString(bytes,0,used).Split('|');int pid;long started;
                if(watcher.Length!=2||!Int32.TryParse(watcher[0],out pid)||pid<=0||!Int64.TryParse(watcher[1],out started)||started<=0)return "marker_invalid";
                using(Process p=Process.GetProcessById(pid)) {
                    if(p.HasExited)return "process_exited";
                    if(p.StartTime.ToUniversalTime().Ticks!=started)return "birth_mismatch";
                    if(!String.Equals(p.MainModule.FileName,Process.GetCurrentProcess().MainModule.FileName,StringComparison.OrdinalIgnoreCase))return "image_mismatch";
                }
                return null;
            } catch { return "identity_unavailable"; }
        }
        internal static void Before(string op, Dictionary<string, object> a, string label, bool readOnly=false) {
            if (String.IsNullOrEmpty(FileName)) throw new AxonError("no_native_guard", "Native approval runtime required.", null);
            object v;
            Token = a.TryGetValue("__session", out v) ? Convert.ToString(v) : null;
            keyboardTarget=a.ContainsKey("hwnd")?Convert.ToInt64(a["hwnd"]):0; keyboardOwner=0; focusing=op=="focus";
            Check();
            string[] state=AtomicFile.ReadAllText(FileName).Split('|');
            string appKey="";
            if(a.ContainsKey("hwnd")) {
                Dictionary<string,object> identity=Identity(Convert.ToInt64(a["hwnd"]));
                appKey=Convert.ToString(identity["key"]);
                string grants=state.Length>3?Encoding.UTF8.GetString(Convert.FromBase64String(state[3])):"";
                if(!new List<string>(grants.Split('\n')).Contains(appKey))
                    throw new AxonError("app_not_approved","This application instance has no native human grant.",null);
            }
            if(!readOnly)CheckTier(op,a,appKey,state);
            if (a.TryGetValue("__pid", out v)) {
                int pid = Convert.ToInt32(v);
                Process p = Process.GetProcessById(pid);
                string expected = Convert.ToString(a["__started"]);
                if (p.StartTime.ToUniversalTime().Ticks.ToString() != expected)
                    throw new AxonError("identity_changed", "Approved process instance changed.", null);
            }
            if(!readOnly && Sensitive(op,a,label)) {
                string permit=a.ContainsKey("__permit")?Convert.ToString(a["__permit"]):"";
                Guid guid;
                if(!Guid.TryParseExact(permit,"N",out guid)) throw new AxonError("confirmation_required","Native action-time approval required.",null);
                string f=Path.Combine(FileName+".permits",permit);
                string[] approval;
                try { approval=AtomicFile.ReadAllLines(f); File.Delete(f); }
                catch { throw new AxonError("confirmation_required","Approval missing, expired or consumed.",null); }
                long until;
                if(approval.Length!=4 || approval[0]!=Token || approval[1]!=Fingerprint(op,a,label) || approval[2]!=appKey ||
                    !Int64.TryParse(approval[3],out until) || DateTime.UtcNow.Ticks>=until)
                    throw new AxonError("approval_changed","Approved target/action changed; observe again.",null);
            }
        }
        internal static void LatchStop() {
            string file=Environment.GetEnvironmentVariable("AGCU_STOP_LATCH");
            if(!String.IsNullOrEmpty(file))try {
                // Never downgrade an existing unconfirmed marker. Delete sharing
                // lets a stronger atomic publication replace this new inode
                // even if our initial write has not yet finished.
                using(var stream=new FileStream(file,FileMode.CreateNew,FileAccess.Write,FileShare.Read|FileShare.Delete)) {
                    byte[] bytes=Encoding.UTF8.GetBytes("stopped");stream.Write(bytes,0,bytes.Length);stream.Flush(true);
                }
            }catch {}
        }
        internal static void WatchParent() {
            int pid;
            if (!Int32.TryParse(Environment.GetEnvironmentVariable("AGCU_PARENT_PID"), out pid)) return;
            Thread t = new Thread(delegate() {
                try { using (Process p = Process.GetProcessById(pid)) p.WaitForExit(); } catch { }
                bool wasIdle=false;try {wasIdle=AtomicFile.ReadAllText(FileName).StartsWith("idle|");}catch {}
                try { File.WriteAllText(FileName,"stopped||0|"); } catch { }
                if(!wasIdle)LatchStop();
                try { Recover(); } catch { }
                Environment.Exit(0);
            });
            t.IsBackground = true; t.Start();
        }
        internal static void Recover() {
            InputLedger.Recover();
        }
        internal static object Launch(Dictionary<string,object> a) {
            string file=Path.GetFullPath(Convert.ToString(a["app"]));
            if(!File.Exists(file)||!String.Equals(Path.GetExtension(file),".exe",StringComparison.OrdinalIgnoreCase))
                throw new AxonError("invalid_application","Select an existing executable path.",null);
            List<string> args=new List<string>();
            object[] items=a.ContainsKey("args")?a["args"] as object[]:null;
            if(items!=null)foreach(object value in items){
                string text=Convert.ToString(value);
                text=System.Text.RegularExpressions.Regex.Replace(text,@"(\\*)""","$1$1\\\"");
                text=System.Text.RegularExpressions.Regex.Replace(text,@"(\\+)$","$1$1");
                args.Add("\""+text+"\"");
            }
            ProcessStartInfo info=new ProcessStartInfo(file,String.Join(" ",args));info.UseShellExecute=false;
            Process p=Process.Start(info);return new Dictionary<string,object>{{"pid",p.Id},{"path",file}};
        }
    }

    internal static class NativeStopReceipt {
        internal static bool ValidNonce(string nonce) {return nonce!=null&&nonce.Length==32&&System.Text.RegularExpressions.Regex.IsMatch(nonce,"^[a-f0-9]{32}$");}
        internal static bool WorkersExited(Process[] workers,int timeoutMs) {
            if(timeoutMs<0||timeoutMs>3000)throw new ArgumentOutOfRangeException("timeoutMs");
            ulong start=NativeDeadline.GetTickCount64();
            foreach(Process worker in workers)try {
                if(worker.HasExited)continue;
                ulong now=NativeDeadline.GetTickCount64();
                if(now<start||now-start>=(ulong)timeoutMs||!worker.WaitForExit(timeoutMs-(int)(now-start)))return false;
            }catch{return false;}
            return true;
        }
    }
    // One controller per signed-in user and desktop session may drive input.
    // Every installation derives the same mutex name from the user's SID, so
    // a second copy (another install, an old build left running) is refused
    // instead of sharing the mouse and keyboard. The operating system
    // releases the mutex when its holder exits; no file or heartbeat decides.
    internal static class InputLease {
        internal const string HeldMessage="Another copy of Computer Use is controlling this PC; multiple copies are not supported yet.";
        static Mutex held;
        internal static string Name(string sid) {
            using(SHA256 sha=SHA256.Create()) {
                StringBuilder hex=new StringBuilder();
                foreach(byte b in sha.ComputeHash(Encoding.UTF8.GetBytes(sid)))hex.Append(b.ToString("x2"));
                return "Local\\AGCU.Input.v1."+hex.ToString();
            }
        }
        // Must be called on the thread that lives as long as the controls:
        // a mutex belongs to the thread that acquired it. Returns null when
        // acquired, otherwise the refusal code.
        internal static string Acquire(int waitMs,out bool abandoned) {
            abandoned=false;
            if(held!=null)return null;
            Mutex mutex=null;
            try {
                string name=Name(System.Security.Principal.WindowsIdentity.GetCurrent().User.Value);
                bool created;
                mutex=new Mutex(false,name,out created);
                bool owned;
                // A holder that died is not a second copy. Its held input is
                // released by the ledger recovery that runs before any task.
                try {owned=mutex.WaitOne(waitMs);}catch(AbandonedMutexException) {owned=true;abandoned=true;}
                if(!owned) {mutex.Dispose();return "input_lease_held";}
                held=mutex;return null;
            } catch(UnauthorizedAccessException) {
                // The name exists but belongs to someone this user cannot open.
                if(mutex!=null)mutex.Dispose();return "input_lease_held";
            } catch {
                if(mutex!=null)mutex.Dispose();return "input_lease_unavailable";
            }
        }
        internal static void Release() {
            Mutex mutex=held;held=null;
            if(mutex==null)return;
            try {mutex.ReleaseMutex();}catch {}
            try {mutex.Dispose();}catch {}
        }
    }
    internal sealed class Guardian : Form {
        [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr h,int how);
        [DllImport("user32.dll")] static extern bool RegisterHotKey(IntPtr h, int id, uint modifiers, uint vk);
        [DllImport("user32.dll")] static extern bool UnregisterHotKey(IntPtr h, int id);
        [DllImport("user32.dll")] static extern bool AllowSetForegroundWindow(int pid);
        [DllImport("user32.dll")] static extern bool SetWindowDisplayAffinity(IntPtr h, uint affinity);
        [DllImport("winmm.dll")] static extern uint timeBeginPeriod(uint period);
        [DllImport("winmm.dll")] static extern uint timeEndPeriod(uint period);
        [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern bool SetPropW(IntPtr h, string key, IntPtr value);
        readonly JavaScriptSerializer js = new JavaScriptSerializer();
        readonly ToolTip tips = new ToolTip();
        HudButton stopButton, modeButton;
        BarMenu menu;
        // A menu that is closing is already closed to everything that asks.
        bool MenuOpen {get {return menu!=null&&!menu.IsDisposed&&menu.Visible&&!menu.Dismissing;}}
        void CloseMenu(bool atOnce=false) {if(menu!=null&&!menu.IsDisposed&&menu.Visible)menu.Dismiss(atOnce);}
        // Human mouse and keyboard input never pauses the agent. The policy
        // object stays in manual mode; only Esc, the hotkey and Stop halt it.
        readonly TakeoverPolicy takeover=new TakeoverPolicy("manual");
        float visualScale=1;
        // Bar presentation only. None of these grants or changes control.
        string lastReason="";bool ended,releasing,lowTime;DateTime stoppedAt=DateTime.MinValue,releaseChecked;
        internal float hoverStop,hoverMode,pressStop,pressMode;internal int pressedButton;
        Image hostIcon;string hostIconPath="";
        int shownSlot=-1;
        readonly System.Windows.Forms.Timer motion=new System.Windows.Forms.Timer();
        static readonly string[] Docks={"top-left","top-centre","top-right","bottom-left","bottom-centre","bottom-right"};
        // Where the person keeps the bar: a dock, or a fraction of the work area.
        string dock="top-centre";double dockX,dockY;
        // How bright the person wants the glow: soft, medium or bright.
        string glowLevel="soft";
        void ApplyGlowLevel() {Overlay.GlowBrightness(glowLevel=="bright"?1f:glowLevel=="medium"?.75f:.55f);}
        bool dragging,dragArmed,displaced,sliding,entering,leaving,quitting;Point dragGrab,dragStart,slideFrom,slideTo;DateTime displacedAt,slideAt,enterAt,leaveAt;int slideMs;float enterFrom,leaveFrom;
        // The last moments of a drag, for the speed the bar is let go at.
        // A bar that is fading out is already gone to everything that asks.
        internal bool BarShown {get {return Visible&&!leaving;}}
        string activity="";DateTime activityAt;
        // Where the current action lands and who is acting. Carried by the
        // activity message for the control bar and a per-window glow; nothing
        // is drawn from them yet, and none of them grants or changes control.
        long activityHwnd;int activityX=Int32.MinValue,activityY=Int32.MinValue;string hostName="";
        readonly System.Windows.Forms.Timer timer = new System.Windows.Forms.Timer();
        volatile string state = "idle"; string token = "";
        // Set while a previous task's input cleanup is unverified: the bar is
        // visible and Stop works, but re-arm, resume and activation refuse.
        // Starts locked when the runtime recovered an unverified prior task, so
        // no path that shows the bar before show_controls can offer re-arm.
        volatile bool rearmLocked=Environment.GetEnvironmentVariable("AGCU_REARM_LOCKED")=="1";
        readonly object stateLock=new object();
        readonly HashSet<string> grants = new HashSet<string>();
        // Granted apps whose tier is click only. Written to the guard file so
        // the input worker enforces the tier at dispatch.
        readonly HashSet<string> clickGrants = new HashSet<string>();
        // Apps approved per agent conversation (session handle, executable).
        // An approval lasts the conversation: it survives End, session expiry
        // and Stop, so continuing after Esc shows no new approval prompt.
        // Apps a person approved in this guardian's own prompts, per conversation.
        // Loaded on first use and saved after each human Allow (ApprovalMemory.cs).
        ApprovalMemory remembered;
        string ApprovalFile {get {return Path.Combine(Path.GetDirectoryName(ControlFence.FileName),"guardian-approvals.json");}}
        ApprovalMemory Approvals() {if(remembered==null)remembered=ApprovalMemory.Load(ApprovalFile,ApprovalMemory.Now());return remembered;}
        void ClearGrants() {grants.Clear();clickGrants.Clear();}
        Form activePrompt; bool captureHidden; bool captureExcluded; bool recordVisuals;
        bool controlsRequested, initialized; DateTime controlsUntil=DateTime.MaxValue;
        long visibilityEpoch,stopEpoch;
        readonly List<Process> workers=new List<Process>();
        readonly object workerLock=new object();
        readonly bool hostManaged=Environment.GetEnvironmentVariable("AGCU_PERMISSION_MODE")=="host-managed";
        long deadline; ulong bootDeadline;
        bool prompting, registered, normalClose;
        string StopLatch {get {return Environment.GetEnvironmentVariable("AGCU_STOP_LATCH");}}
        static readonly object outputLock = new object();
        internal static void Emit(object data) { lock(outputLock) { Console.Out.WriteLine(new JavaScriptSerializer().Serialize(data)); Console.Out.Flush(); } }
        internal static int Run() {
            Console.InputEncoding = new UTF8Encoding(false); Console.OutputEncoding = new UTF8Encoding(false);
            var desktop=DesktopContext.Inspect();
            if(!(bool)desktop["interactive"]) {
                Emit(new {ev="error",code="desktop_context_unavailable",message="Local controls are not attached to the visible input desktop. Start the installed human launcher from the normal desktop. No desktop was switched.",desktop_context=desktop});return 1;
            }
            ControlFence.WatchParent();
            Application.EnableVisualStyles();
            using(Guardian guardian=new Guardian()) {
                if(!guardian.Initialize())return 1;
                Application.Run(guardian);
            }
            return 0;
        }
        Guardian() {
            Text = "Antigravity Computer Use"; TopMost = true; FormBorderStyle = FormBorderStyle.None;
            ShowInTaskbar=false; StartPosition = FormStartPosition.Manual;
            SetStyle(ControlStyles.UserPaint|ControlStyles.AllPaintingInWmPaint|ControlStyles.Opaque,true);
            BackColor=DesktopVisuals.InkSurface;
            stopButton=new HudButton(this,2,DesktopVisuals.StopRect);Controls.Add(stopButton);stopButton.Click += delegate {
                DesktopVisuals.HudModel now=Model();
                if(now.Slot==0)return;
                // Hide takes Stop's slot, so clicks are ignored just after a
                // stop: a second panic click must not dismiss the bar.
                if(now.Slot==2){if((DateTime.UtcNow-stoppedAt).TotalMilliseconds>=600)DismissControls();}
                else Emergency("button");
            };
            modeButton=new HudButton(this,3,DesktopVisuals.ModeRect);Controls.Add(modeButton);modeButton.Click+=delegate {OpenModeMenu();};
            LoadTakeoverMode();
            ApplyScale(Overlay.ScreenScale(Screen.FromPoint(Cursor.Position)),Screen.FromPoint(Cursor.Position));
            // 15, not 16: the system timer ticks every 15.6 ms, so 16 fires every other tick.
            motion.Interval=15;motion.Tick+=delegate {Motion();};
            FormClosing += delegate(object sender, FormClosingEventArgs e) { quitting=true;if(!normalClose&&state!="idle")SetState("stopped",null,false);DismissControls(); };
            timer.Interval = 70; timer.Tick += Tick; timer.Start();
        }
        // Initialize the message handle/hooks without ever showing a window.
        // Application.Run(Form) asks to show its MainForm; SetVisibleCore keeps
        // that implicit startup request hidden until a task explicitly needs it.
        bool Initialize() {
                Mark(this); ApplyRecordingPreference();
                // Taken before any hook or hotkey so a refused second copy
                // leaves nothing behind. The short wait covers this install's
                // own previous controls still exiting.
                bool leaseAbandoned;
                string lease=InputLease.Acquire(2000,out leaseAbandoned);
                if(lease!=null) {
                    Emit(new {ev="error",code=lease,message=lease=="input_lease_held"?InputLease.HeldMessage:"The single-controller lock for this user could not be checked, so control was refused."});
                    return false;
                }
                if(leaseAbandoned)try {ControlFence.Recover();}catch {}
                registered = RegisterHotKey(Handle, 1, 0x4003, 0x7B);
                if (!registered) { Emit(new { ev="error", message="Ctrl+Alt+F12 is unavailable; refusing control" }); return false; }
                // Reinstall the hooks for every activation: Windows can remove a
                // low-level hook silently after a slow callback, and HooksOk
                // would still report the original install.
                Presence.Restart();
                // The hook callback only revokes control; the slower cleanup runs
                // off the hook thread so Windows never times the hook out.
                Presence.OnPanic = delegate {
                    if(state=="active"||state=="paused"||prompting){
                        Interlocked.Increment(ref stopEpoch); ControlFence.LatchStop();
                        ThreadPool.QueueUserWorkItem(delegate { Emergency("escape"); });
                    }
                };
                if (!Presence.HooksOk) { Emit(new { ev="error", message="Physical-input monitoring unavailable" }); UnregisterHotKey(Handle,1);Presence.Stop();return false; }
                Overlay.Configure(1, "Antigravity", 0); Overlay.Start(true);
                Overlay.RecordVisuals(recordVisuals);
                SetState(ControlFence.LatchBlocks(StopLatch)?"stopped":"idle");
                DismissControls();
                initialized=true;
                Emit(new {ev="settings",takeover_mode=takeover.Mode,record_visuals=recordVisuals});
                Emit(new { ev="ready", pid=Process.GetCurrentProcess().Id, hotkey=true, presence=true,desktop_context=DesktopContext.Inspect(),clear_stop=true,session_reason=true,remembered_approvals=true,access_tiers=true,prompt_card=true });
                Thread reader = new Thread(Read); reader.IsBackground = true; reader.Start();
                return true;
        }
        protected override void SetVisibleCore(bool value) {base.SetVisibleCore(value && initialized && controlsRequested && !captureHidden);}
        void SyncVisibility() {
            if(controlsRequested&&!captureHidden) {
                // bar.enter: a fresh appearance fades in; a return from a screenshot does not.
                // A dismissal still fading turns round from where it is.
                if(leaving){leaving=false;entering=true;enterFrom=barAlpha;enterAt=DateTime.UtcNow;motion.Start();}
                else if(!Visible){if(!captureReturn){entering=true;enterFrom=0;enterAt=DateTime.UtcNow;barAlpha=0;motion.Start();}else barAlpha=1;captureReturn=false;Show();}
            }
            // The menu belongs to the bar: it never outlives it. bar.exit:
            // a dismissal fades out; a screenshot hides the bar at once.
            else if(Visible&&!leaving) {
                CloseMenu(true);
                if(captureHidden||quitting||!DesktopVisuals.MotionEnabled)HideNow();
                else {CancelBody();entering=false;leaving=true;leaveFrom=barAlpha;leaveAt=DateTime.UtcNow;motion.Start();}
            }
            else if(leaving&&captureHidden)HideNow();
        }
        void HideNow() {CancelBody();entering=leaving=false;barAlpha=1;Hide();}
        bool captureReturn;
        void ShowControls(int milliseconds) {Interlocked.Increment(ref visibilityEpoch);controlsRequested=true;controlsUntil=milliseconds>0?DateTime.UtcNow.AddMilliseconds(milliseconds):DateTime.MaxValue;SyncVisibility();}
        void DismissControls() {Interlocked.Increment(ref visibilityEpoch);controlsRequested=false;SyncVisibility();}
        protected override bool ShowWithoutActivation { get { return true; } }
        protected override CreateParams CreateParams { get { CreateParams p=base.CreateParams;p.ExStyle|=0x08000080|0x00080000;return p; } }
        // The bar is a layered window with per-pixel alpha, so the pill's
        // edge is smooth. The whole surface, buttons included, is drawn here;
        // the buttons stay real controls for input, tooltips and screen readers.
        protected override void OnPaint(PaintEventArgs e) {}
        protected override void OnPaintBackground(PaintEventArgs e) {}
        float barAlpha=1;
        internal void Present() {
            if(!IsHandleCreated||Width<=0||Height<=0)return;
            // Whatever changed also changes the ghost's picture of the bar.
            if(ghostOwns)bodyPictureStale=true;
            try {
                using(Bitmap surface=new Bitmap(Width,Height,System.Drawing.Imaging.PixelFormat.Format32bppPArgb)) {
                    using(Graphics g=Graphics.FromImage(surface)) {
                        g.Clear(Color.Transparent);g.ScaleTransform(visualScale,visualScale);
                        DesktopVisuals.Hud(g,Model());
                    }
                    // While the ghost draws it, the bar stays hit-testable at alpha 1.
                    byte ba=ghostOwns?(byte)1:(byte)Math.Max(0,Math.Min(255,(int)Math.Round(255*barAlpha)));
                    Overlay.Present(Handle,surface,Left,Top,ba);Trace("bar",Left,Top,Width,Height,ba);
                }
            } catch {}
        }
        protected override void OnVisibleChanged(EventArgs e) {base.OnVisibleChanged(e);if(Visible)Present();}
        // Size, shape and place for one monitor's scale.
        void ApplyScale(float scale,Screen screen) {
            CancelBody();visualScale=scale;
            ClientSize=new Size((int)Math.Round(DesktopVisuals.HudWidth*scale),(int)Math.Round(DesktopVisuals.HudHeight*scale));
            stopButton.Place();modeButton.Place();
            Location=Home(screen.WorkingArea);Present();
        }
        Point Home(Rectangle work) {return HomeFor(dock,work);}
        Point HomeFor(string name,Rectangle work) {
            int side=(int)Math.Ceiling(12*visualScale),edge=(int)Math.Round(18*visualScale);
            int left=work.Left+side,right=work.Right-Width-side,centre=work.Left+(work.Width-Width)/2,up=work.Top+edge,down=work.Bottom-Height-edge;
            switch(name) {
                case "top-left":return new Point(left,up);case "top-right":return new Point(right,up);
                case "bottom-left":return new Point(left,down);case "bottom-centre":return new Point(centre,down);case "bottom-right":return new Point(right,down);
                case "free":
                    try {return WindowGeometry.Fit(new Rectangle(work.Left+(int)(dockX*(work.Width-Width)),work.Top+(int)(dockY*(work.Height-Height)),Width,Height),work).Location;}
                    catch {return new Point(centre,up);}
                default:return new Point(centre,up);
            }
        }
        // What the bar says. State is carried by the words; line 1 never
        // changes inside a state, only line 2 does.
        internal DesktopVisuals.HudModel Model() {
            DesktopVisuals.HudModel m=new DesktopVisuals.HudModel();
            string host=hostName.Length>0?hostName:"Computer Use";
            m.State=prompting?"asking":state;m.Icon=hostIcon;m.StopHover=hoverStop;m.ModeHover=hoverMode;m.Pressed=pressedButton;m.StopPress=pressStop;m.ModePress=pressMode;m.HighContrast=SystemInformation.HighContrast;
            if(prompting) {m.Line1="Waiting for your answer";m.Line2="Allow or deny below";m.Hint=true;m.Slot=1;}
            else if(state=="active") {
                m.Line1=host+" is working";m.Line2=activity.Length>0?activity:"Waiting for the next step";
                if(lowTime)m.Line2+=" · 1 min left";
                m.Hint=true;m.Slot=1;
            }
            else if(state=="stopped") {m.Line1="Stopped";m.Line2=releasing?"Still releasing a key or button":StopReason(lastReason);m.Slot=releasing?0:2;}
            else if(ended) {m.Line1="Session ended";m.Line2="The time limit ran out";m.Slot=2;}
            else {m.Line1=host+" is ready";m.Line2="Not controlling anything";m.Slot=2;}
            return m;
        }
        internal static string StopReason(string reason) {
            switch(reason) {
                case "escape":return "You pressed Esc";
                case "button":return "You pressed Stop";
                case "hotkey":return "You pressed Ctrl+Alt+F12";
                case "input_desktop_changed":return "The screen was locked or switched";
                case "cursor_watchdog_failed":case "watchdog_unavailable":case "guard_persistence_failed":return "A safety check failed";
                default:return "The task was ended";
            }
        }
        sealed class HudButton : Button {
            readonly Guardian owner;readonly int index;readonly Rectangle logical;bool over,down;
            float hoverFrom,pressFrom;DateTime hoverAt,pressAt;
            readonly System.Windows.Forms.Timer fade=new System.Windows.Forms.Timer();
            internal HudButton(Guardian o,int i,Rectangle r) {
                owner=o;index=i;logical=r;FlatStyle=FlatStyle.Flat;FlatAppearance.BorderSize=0;TabStop=false;Cursor=Cursors.Hand;
                SetStyle(ControlStyles.UserPaint|ControlStyles.AllPaintingInWmPaint|ControlStyles.Opaque,true);
                fade.Interval=16;fade.Tick+=delegate {Step();};
            }
            internal void Place() {float s=owner.visualScale;SetBounds((int)Math.Round(logical.X*s),(int)Math.Round(logical.Y*s),(int)Math.Round(logical.Width*s),(int)Math.Round(logical.Height*s));}
            float Hover {get {return index==2?owner.hoverStop:owner.hoverMode;} set {if(index==2)owner.hoverStop=value;else owner.hoverMode=value;}}
            float Pressing {get {return index==2?owner.pressStop:owner.pressMode;} set {if(index==2)owner.pressStop=value;else owner.pressMode=value;}}
            // button.hover: the plate arrives over Fast and leaves over FastLeave.
            // button.press: the icon eases to PressScale over Press, and back on release.
            // Both ease out from wherever they are; with motion reduced they are instant.
            void Step() {
                DateTime now=DateTime.UtcNow;bool motion=DesktopVisuals.MotionEnabled;
                float hoverTo=over?1:0,pressTo=down?1:0;
                double h=(now-hoverAt).TotalMilliseconds/(over?DesktopVisuals.Fast:DesktopVisuals.FastLeave),p=(now-pressAt).TotalMilliseconds/DesktopVisuals.Press;
                Hover=!motion||h>=1?hoverTo:hoverFrom+(hoverTo-hoverFrom)*DesktopVisuals.EaseOut((float)h);
                Pressing=!motion||p>=1?pressTo:pressFrom+(pressTo-pressFrom)*DesktopVisuals.EaseOut((float)p);
                if(Hover==hoverTo&&Pressing==pressTo)fade.Stop();
                owner.Present();
            }
            void Hovered(bool value) {if(over==value)return;over=value;hoverFrom=Hover;hoverAt=DateTime.UtcNow;fade.Start();Step();}
            void Held(bool value) {if(down==value)return;down=value;pressFrom=Pressing;pressAt=DateTime.UtcNow;fade.Start();Step();}
            // Drawn by the bar's own surface; a layered window never shows a child's paint.
            protected override void OnPaint(PaintEventArgs e) {}
            protected override void OnPaintBackground(PaintEventArgs e) {}
            protected override void OnMouseEnter(EventArgs e) {Hovered(true);base.OnMouseEnter(e);}
            protected override void OnMouseLeave(EventArgs e) {if(owner.pressedButton==index)owner.pressedButton=0;Held(false);Hovered(false);base.OnMouseLeave(e);}
            // button.press: confirmed on pointer-down.
            protected override void OnMouseDown(MouseEventArgs e) {owner.pressedButton=index;Held(true);base.OnMouseDown(e);}
            protected override void OnMouseUp(MouseEventArgs e) {owner.pressedButton=0;Held(false);base.OnMouseUp(e);}
            protected override void Dispose(bool disposing) {if(disposing)fade.Dispose();base.Dispose(disposing);}
        }
        void RefreshHud() {
            DesktopVisuals.HudModel m=Model();
            if(m.Slot!=shownSlot) {
                shownSlot=m.Slot;
                stopButton.AccessibleName=m.Slot==2?"Hide controls":"Stop computer use (Esc)";
                tips.SetToolTip(stopButton,m.Slot==2?"Hide controls":m.Slot==1?"Stop computer use · Esc or Ctrl+Alt+F12":"");
                stopButton.Cursor=m.Slot==0?Cursors.Default:Cursors.Hand;
                modeButton.AccessibleName="Settings";tips.SetToolTip(modeButton,"Settings");
            }
            // bar.textChange: line 2 is swapped in place, with no motion.
            AccessibleRole=AccessibleRole.ToolBar;
            AccessibleName=(hostName.Length>0?hostName:"Computer Use")+" computer use: "+m.Line1+", "+m.Line2;
            Present();
        }
        // One frame timer for the bar's own motion. It runs only while
        // something is moving.
        void Motion() {
            if(IsDisposed){motion.Stop();return;}
            bool busy=false;DateTime now=DateTime.UtcNow;
            if(entering) {
                // bar.enter: opacity over Normal; a short fade when motion is reduced.
                double t=(now-enterAt).TotalMilliseconds/(DesktopVisuals.MotionEnabled?DesktopVisuals.Normal:DesktopVisuals.Fast);
                if(t>=1){entering=false;barAlpha=1;}else {barAlpha=enterFrom+(1-enterFrom)*DesktopVisuals.EaseOut((float)t);busy=true;}
                Present();
            }
            if(leaving) {
                // bar.exit: opacity to nothing over NormalLeave, easing out.
                double t=(now-leaveAt).TotalMilliseconds/DesktopVisuals.NormalLeave;
                if(t>=1)HideNow();else {barAlpha=leaveFrom*(1-DesktopVisuals.EaseOut((float)t));busy=true;Present();}
            }
            if(body!=null&&ghostOwns) {
                long tick=Stopwatch.GetTimestamp();double seconds=(tick-bodyTick)/(double)Stopwatch.Frequency;bodyTick=tick;
                if(demo&&body.Held) {
                    Rectangle dw=Screen.FromRectangle(Bounds).WorkingArea;int dm=(int)Math.Ceiling(12*visualScale);
                    demoX+=demoVX*seconds;demoY+=demoVY*seconds;
                    Location=new Point(Band(demoX,dw.Left,dw.Right-Width,dm),Band(demoY,dw.Top,dw.Bottom-Height,dm));
                    if(tick>=demoUntil){body.Hold(Left+Width/2.0,Top+Height/2.0,demoX+Width/2.0,demoY+Height/2.0,seconds);bodyTick=tick;Settle();demo=false;busy=true;return;}
                }
                // While held, the body takes the bar's place once a frame.
                if(body.Held)body.Hold(Left+Width/2.0,Top+Height/2.0,HandX()+Width/2.0,HandY()+Height/2.0,seconds);
                body.Advance(seconds);
                if(!body.Held)Location=new Point((int)Math.Round(body.CentreX-Width/2.0),(int)Math.Round(body.CentreY-Height/2.0));
                // While held, a mouse move has usually drawn this frame already.
                if(body.Done){EndBody();Landed();}else {if(!body.Held||Stopwatch.GetTimestamp()-lastGhostTick>Stopwatch.Frequency/100)PresentGhost();busy=true;}
            }
            if(sliding) {
                double t=(now-slideAt).TotalMilliseconds/slideMs;
                if(t>=1||!DesktopVisuals.MotionEnabled){sliding=false;Location=slideTo;}
                else {float e=DesktopVisuals.EaseInOut((float)t);Location=new Point((int)Math.Round(slideFrom.X+(slideTo.X-slideFrom.X)*e),(int)Math.Round(slideFrom.Y+(slideTo.Y-slideFrom.Y)*e));busy=true;}
            }
            if(!busy)motion.Stop();
        }
        void SlideTo(Point target,int milliseconds) {
            CancelBody();
            if(target==Location){sliding=false;return;}
            slideFrom=Location;slideTo=target;slideAt=DateTime.UtcNow;slideMs=milliseconds;sliding=true;motion.Start();
        }
        // bar.throw and bar.squash: while the person holds or throws the bar,
        // BarBody moves it and the ghost draws it in its moving shape, in a
        // larger click-through window of one fixed size per gesture. The bar
        // is drawn once into a cached picture and only transformed, so its
        // text never re-rasterises mid-motion. Only the frame timer presents.
        // The bar window stays in place for input at alpha 1 (hit-testable).
        BarBody body;BarGhost ghost;Bitmap bodyPicture;Size ghostSize;long bodyTick;bool ghostOwns,bodyPictureStale;
        // Bench only (AGCU_BAR_TRIAL=1): a scripted drag at (demoVX, demoVY)
        // px/s that lets go when it ends, and a log of every present on the
        // bar and its ghost (AGCU_BAR_TRACE names the file).
        static readonly bool barTrial=Environment.GetEnvironmentVariable("AGCU_BAR_TRIAL")=="1";
        static readonly string barTrace=barTrial?Environment.GetEnvironmentVariable("AGCU_BAR_TRACE"):null;
        // Bench variant: AGCU_BAR_VARIANT=glide keeps a gliding bar stretched (BarBody.GlideStretch).
        static readonly bool barGlideVariant=barTrial&&Environment.GetEnvironmentVariable("AGCU_BAR_VARIANT")=="glide";
        // Bench variant: AGCU_BAR_VARIANT=stretch draws the moving bar as one
        // stretched picture, as before the rigid content.
        static readonly bool barStretchVariant=barTrial&&Environment.GetEnvironmentVariable("AGCU_BAR_VARIANT")=="stretch";
        double demoVX,demoVY,demoX,demoY;long demoUntil;bool demo;
        internal static void Trace(string what,int x,int y,int w,int h,int alpha) {Trace(what,x,y,w,h,alpha,0);}
        internal static void Trace(string what,int x,int y,int w,int h,int alpha,double ms) {Trace(what,x,y,w,h,alpha,ms,1,0,0,1);}
        internal static void Trace(string what,int x,int y,int w,int h,int alpha,double ms,double a,double b,double c,double d) {
            if(String.IsNullOrEmpty(barTrace))return;
            try {File.AppendAllText(barTrace,(Stopwatch.GetTimestamp()*1000.0/Stopwatch.Frequency).ToString("0.0")+" "+what+" "+x+" "+y+" "+w+" "+h+" "+alpha+" "+ms.ToString("0.00")+" "+a.ToString("0.000")+" "+b.ToString("0.000")+" "+c.ToString("0.000")+" "+d.ToString("0.000")+"\n");} catch {}
        }
        void StartDemo(double vx,double vy,double seconds) {
            CancelBody();StartBody();if(body==null)return;
            demoVX=vx;demoVY=vy;demoX=Left;demoY=Top;demoUntil=Stopwatch.GetTimestamp()+(long)(seconds*Stopwatch.Frequency);demo=true;
        }
        void StartBody() {
            if(!DesktopVisuals.MotionEnabled)return;
            if(body==null||body.Done)body=new BarBody(Width,Height,visualScale);
            BarBody.GlideStretch=barGlideVariant;
            body.Grab(Left+Width/2.0,Top+Height/2.0);bodyTick=Stopwatch.GetTimestamp();
            Rectangle work=Screen.FromRectangle(Bounds).WorkingArea;int side=(int)Math.Ceiling(12*visualScale),edge=(int)Math.Round(18*visualScale);
            body.Limits(work.Left+side+Width/2.0,work.Right-side-Width/2.0,side,work.Top+edge+Height/2.0,work.Bottom-edge-Height/2.0,edge);
            if(ghost==null||ghost.IsDisposed)ghost=new BarGhost();
            ghost.Recordable(recordVisuals);
            // Room for the largest stretch or swell, and for the lean of a diagonal stretch.
            double most=Math.Exp(BarBody.MaxStrain),lean=body.LeanPx;
            ghostSize=new Size((int)Math.Ceiling(Width*most+lean*Height/Width)+8,(int)Math.Ceiling(Height*most+2*lean)+8);
            RenderBodyPicture();
            // The 16 ms frame timer needs the fine system timer while the bar
            // moves, or it ticks every ~31 ms; it is released when it stops.
            if(!fineTimer)fineTimer=timeBeginPeriod(1)==0;
            // Handoff: the ghost shows first, then the bar goes clear.
            PresentGhost();ghostOwns=true;Present();motion.Start();
        }
        void RenderBodyPicture() {
            Bitmap next=new Bitmap(Width,Height,System.Drawing.Imaging.PixelFormat.Format32bppPArgb);
            using(Graphics g=Graphics.FromImage(next)){g.Clear(Color.Transparent);g.ScaleTransform(visualScale,visualScale);DesktopVisuals.Hud(g,Model());}
            Bitmap old=bodyPicture;bodyPicture=next;bodyPictureStale=false;if(old!=null)old.Dispose();
        }
        // Where the bar's corner would be with no edge holding it back: the
        // pointer less the grab offset (the scripted throw in bench mode).
        double HandX() {return demo?demoX:Cursor.Position.X-dragGrab.X;}
        double HandY() {return demo?demoY:Cursor.Position.Y-dragGrab.Y;}
        long lastGhostTick;const int GhostGap=7;Bitmap ghostSurface;
        void PresentGhost() {
            lastGhostTick=Stopwatch.GetTimestamp();
            if(body==null||ghost==null||ghost.IsDisposed||bodyPicture==null)return;
            if(bodyPictureStale)RenderBodyPicture();
            double a,b,c,d;body.Shape(out a,out b,out c,out d);
            double cx=body.Held?Left+Width/2.0:body.CentreX,cy=body.Held?Top+Height/2.0:body.CentreY;
            // Whole pixels only: a picture drawn at sub-pixel offsets shimmers.
            int gx=(int)Math.Round(cx-ghostSize.Width/2.0),gy=(int)Math.Round(cy-ghostSize.Height/2.0);long began=Stopwatch.GetTimestamp();
            try {
                // One surface per gesture, cleared and reused for every frame.
                if(ghostSurface==null||ghostSurface.Size!=ghostSize){if(ghostSurface!=null)ghostSurface.Dispose();ghostSurface=new Bitmap(ghostSize.Width,ghostSize.Height,System.Drawing.Imaging.PixelFormat.Format32bppPArgb);}
                Bitmap surface=ghostSurface;{
                    using(Graphics g=Graphics.FromImage(surface)) {
                        g.Clear(Color.Transparent);
                        int left=(ghostSize.Width-Width)/2,top=(ghostSize.Height-Height)/2;
                        // At its own shape the picture is copied pixel for pixel, so the text holds still.
                        if(Math.Abs(a-1)<.002&&Math.Abs(d-1)<.002&&Math.Abs(b)<.002&&Math.Abs(c)<.002)g.DrawImageUnscaled(bodyPicture,left,top);
                        else if(!barStretchVariant)DrawRigid(g,a,d);
                        else {
                            g.InterpolationMode=InterpolationMode.Bilinear;g.PixelOffsetMode=PixelOffsetMode.Half;
                            g.TranslateTransform(left+Width/2f,top+Height/2f);
                            using(Matrix shape=new Matrix((float)a,(float)c,(float)b,(float)d,0,0))g.MultiplyTransform(shape);
                            g.DrawImage(bodyPicture,new RectangleF(-Width/2f,-Height/2f,Width,Height));
                        }
                    }
                    byte ga=(byte)Math.Max(0,Math.Min(255,(int)Math.Round(255*barAlpha)));
                    ghost.Show(surface,gx,gy,ga);Trace("ghost",gx,gy,ghostSize.Width,ghostSize.Height,ga,(Stopwatch.GetTimestamp()-began)*1000.0/Stopwatch.Frequency,a,b,c,d);
                }
            } catch {}
        }
        // bar.squash, drawn: only the pill changes shape. Its ends stay round
        // (radius half its drawn height); the text rides the left end and the
        // buttons the right end, copied pixel for pixel, and shrink evenly
        // only when the bar is pressed flatter than they are tall.
        void DrawRigid(Graphics g,double a,double d) {
            DesktopVisuals.RigidHud(g,bodyPicture,visualScale,a,d,ghostSize.Width/2f,ghostSize.Height/2f,Model().HighContrast);
        }
        // The body comes to rest, or is cut short. Handoff: the bar is drawn
        // again first, then the ghost goes.
        bool fineTimer;
        void EndBody() {
            if(fineTimer){timeEndPeriod(1);fineTimer=false;}
            if(!ghostOwns)return;
            ghostOwns=false;Present();
            if(ghost!=null&&!ghost.IsDisposed){ghost.Conceal();Trace("ghost-hide",0,0,0,0,0);}
        }
        void CancelBody() {
            if(body!=null&&!body.Done)body.Snap(Left+Width/2.0,Top+Height/2.0);
            EndBody();
        }
        // A thrown or put-down bar has stopped: remember the dock it is on, or the free place.
        void Landed() {
            Rectangle work=Screen.FromRectangle(Bounds).WorkingArea;string near="free";
            foreach(string name in Docks)if(HomeFor(name,work)==Location){near=name;break;}
            dock=near;
            if(near=="free"){dockX=work.Width>Width?(Left-work.Left)/(double)(work.Width-Width):0;dockY=work.Height>Height?(Top-work.Top)/(double)(work.Height-Height):0;}
            displaced=false;SavePreferences();
        }
        // Drag and reposition. The handle is everything that is not a button:
        // the buttons are separate controls, so a press on one never arrives here.
        protected override void OnMouseDown(MouseEventArgs e) {
            // Only the person's own press may move the bar, never injected input.
            bool physical=(DateTime.UtcNow.Ticks-Presence.LastUserClickTicks)<TimeSpan.TicksPerSecond;
            if(e.Button==MouseButtons.Left&&physical&&!leaving) {
                dragArmed=true;dragStart=Cursor.Position;dragGrab=new Point(Cursor.Position.X-Left,Cursor.Position.Y-Top);
                // A grab catches a bar in flight where it is.
                if(body!=null&&!body.Done&&!body.Held)body.Grab(Left+Width/2.0,Top+Height/2.0);
            }
            base.OnMouseDown(e);
        }
        protected override void OnMouseMove(MouseEventArgs e) {
            if(dragArmed) {
                Point p=Cursor.Position;
                if(!dragging&&(Math.Abs(p.X-dragStart.X)>=4||Math.Abs(p.Y-dragStart.Y)>=4)){dragging=true;sliding=false;if(body==null||body.Done)StartBody();}
                if(dragging) {
                    // bar.drag: 1:1 from the grab point. Past the inset the bar
                    // resists, and it never leaves the work area. The frame
                    // timer feeds the body and draws; this only moves the bar.
                    Rectangle work=Screen.FromPoint(p).WorkingArea;int margin=(int)Math.Ceiling(12*visualScale);
                    Location=new Point(Band(p.X-dragGrab.X,work.Left,work.Right-Width,margin),Band(p.Y-dragGrab.Y,work.Top,work.Bottom-Height,margin));
                    Trace("move",p.X,p.Y,Left,Top,0);
                    // The drawn bar follows the pointer on the same event, not a frame later.
                    // At most one frame every GhostGap ms: a mouse can report every 5 ms.
                    if(body!=null&&ghostOwns&&body.Held&&Stopwatch.GetTimestamp()-lastGhostTick>=Stopwatch.Frequency*GhostGap/1000)PresentGhost();
                }
            }
            base.OnMouseMove(e);
        }
        protected override void OnMouseUp(MouseEventArgs e) {
            bool settle=dragging||body!=null&&!body.Done&&body.Held;dragArmed=dragging=false;
            if(settle)Settle();
            base.OnMouseUp(e);
        }
        // bar.drag: the rubber band. Inside the inset the bar follows exactly;
        // past it each pixel moves it less, and it can never go a whole inset further.
        static int Band(double value,int lowEdge,int highEdge,int margin) {
            double low=lowEdge+margin,high=highEdge-margin;
            if(high<low){low=lowEdge;high=Math.Max(lowEdge,highEdge);margin=0;}
            if(value<low)value=low-Resist(low-value,margin);
            else if(value>high)value=high+Resist(value-high,margin);
            return (int)Math.Round(value);
        }
        static double Resist(double over,double dim) {return dim<=0?0:(1-1/(over*.55/dim+1))*dim;}
        // bar.throw: let go at BarBody.FlingSpeed or faster, the bar glides on
        // with its own speed; reaching a screen edge still fast it squashes
        // against it (BarBody). bar.settle: put down slower, it stays. Either
        // way, stopping within 12 px of a dock lands it there, and the place
        // is remembered when it comes to rest.
        void Settle() {
            bool moving=body!=null&&!body.Done&&body.Held;
            if(moving&&!demo){long tick=Stopwatch.GetTimestamp();body.Hold(Left+Width/2.0,Top+Height/2.0,HandX()+Width/2.0,HandY()+Height/2.0,(tick-bodyTick)/(double)Stopwatch.Frequency);body.Advance((tick-bodyTick)/(double)Stopwatch.Frequency);bodyTick=tick;}
            Screen screen=Screen.FromRectangle(Bounds);float scale=Overlay.ScreenScale(screen);Rectangle work=screen.WorkingArea;
            if(scale!=visualScale) {
                CancelBody();moving=false;
                Point dropped=Location;ApplyScale(scale,screen);
                try {Location=WindowGeometry.Fit(new Rectangle(dropped,Size),work).Location;}catch {}
            }
            int side=(int)Math.Ceiling(12*visualScale),edge=(int)Math.Round(18*visualScale);
            if(moving) {
                double thrown=Math.Sqrt(body.FingerVX*body.FingerVX+body.FingerVY*body.FingerVY)/visualScale;
                double[] dx=new double[Docks.Length],dy=new double[Docks.Length];
                for(int i=0;i<Docks.Length;i++){Point home=HomeFor(Docks[i],work);dx[i]=home.X+Width/2.0;dy[i]=home.Y+Height/2.0;}
                body.Release(thrown>=BarBody.FlingSpeed,work.Left+side+Width/2.0,work.Right-side-Width/2.0,side,work.Top+edge+Height/2.0,work.Bottom-edge-Height/2.0,edge,dx,dy,side);
                motion.Start();
                return;
            }
            // Without the body (reduced motion): a bar let go in the rubber
            // band comes back to the inset, and lands on a dock within 12 px.
            int margin=side;
            Point rest=new Point(Band(Math.Max(work.Left+margin,Math.Min(Left,work.Right-Width-margin)),work.Left,work.Right-Width,margin),Band(Math.Max(work.Top+margin,Math.Min(Top,work.Bottom-Height-margin)),work.Top,work.Bottom-Height,margin));
            string near="free";
            foreach(string name in Docks){Point home=HomeFor(name,work);if(Math.Abs(home.X-rest.X)<=side&&Math.Abs(home.Y-rest.Y)<=side){near=name;break;}}
            dock=near;
            if(near=="free"){dockX=work.Width>Width?(rest.X-work.Left)/(double)(work.Width-Width):0;dockY=work.Height>Height?(rest.Y-work.Top)/(double)(work.Height-Height):0;}
            displaced=false;SavePreferences();SlideTo(Home(work),DesktopVisuals.Normal);
        }
        void MoveToDock(string name) {
            dock=name;displaced=false;SlideTo(Home(Screen.FromRectangle(Bounds).WorkingArea),DesktopVisuals.Slow);SavePreferences();
        }
        void SetHost(string name,string file) {
            if(name!=null&&name.Length>0&&name.Length<=40)hostName=name;
            if(file==null||file==hostIconPath||file.Length>520)return;
            hostIconPath=file;
            // The host's own icon, read from its executable. Decorative only.
            try {
                if(file.EndsWith(".exe",StringComparison.OrdinalIgnoreCase)&&File.Exists(file))
                    using(Icon icon=Icon.ExtractAssociatedIcon(file)){Image old=hostIcon;hostIcon=icon.ToBitmap();if(old!=null)old.Dispose();}
            } catch {hostIcon=null;}
        }
        string PreferenceFile {get {return Path.Combine(Path.GetDirectoryName(ControlFence.FileName),"control-preferences.json");}}
        void LoadTakeoverMode() {
            try {var prefs=js.DeserializeObject(AtomicFile.ReadAllText(PreferenceFile)) as Dictionary<string,object>;
                // A saved "smart" takeover preference from an older build is
                // ignored; the next save rewrites it as manual.
                recordVisuals=prefs.ContainsKey("record_visuals")&&Convert.ToBoolean(prefs["record_visuals"]);
                string saved=prefs.ContainsKey("bar_dock")?Convert.ToString(prefs["bar_dock"]):null;
                if(saved=="free") {
                    double x=Convert.ToDouble(prefs["bar_x"],System.Globalization.CultureInfo.InvariantCulture),y=Convert.ToDouble(prefs["bar_y"],System.Globalization.CultureInfo.InvariantCulture);
                    if(x>=0&&x<=1&&y>=0&&y<=1){dock="free";dockX=x;dockY=y;}
                }
                else if(Array.IndexOf(Docks,saved)>=0)dock=saved;
                string level=prefs.ContainsKey("glow_brightness")?Convert.ToString(prefs["glow_brightness"]):null;
                if(level=="soft"||level=="medium"||level=="bright")glowLevel=level;
            }catch {}
            ApplyGlowLevel();
        }
        void SavePreferences() {
            try {string file=PreferenceFile,temp=file+".tmp";File.WriteAllText(temp,js.Serialize(new {takeover_mode=takeover.Mode,record_visuals=recordVisuals,bar_dock=dock,bar_x=dockX,bar_y=dockY,glow_brightness=glowLevel}));AtomicFile.Publish(temp,file);}catch {Emit(new {ev="visual_warning",message="Could not save control preference"});}
        }
        void ApplyRecordingPreference() {
            // Unlike the recording chrome, permission dialogs always remain excluded.
            captureExcluded=!recordVisuals&&SetWindowDisplayAffinity(Handle,0x11);
            if(recordVisuals)SetWindowDisplayAffinity(Handle,0);
        }
        void ChangeRecordingPreference() {
            recordVisuals=!recordVisuals;ApplyRecordingPreference();Overlay.RecordVisuals(recordVisuals);if(ghost!=null&&!ghost.IsDisposed)ghost.Recordable(recordVisuals);SavePreferences();
            Emit(new {ev="settings",takeover_mode=takeover.Mode,record_visuals=recordVisuals});
        }
        // The Settings menu. It opens from the Settings button, belongs to
        // the bar and never outlives it.
        void OpenModeMenu() {
            if(!BarShown)return;
            if(MenuOpen){menu.Dismiss(false);return;}
            // A menu still closing turns round and opens again.
            if(menu==null||menu.IsDisposed)menu=new BarMenu(this);
            menu.Open(MainMenu());
        }
        static string DockLabel(string name) {
            switch(name) {case "top-left":return "Top left";case "top-right":return "Top right";case "bottom-left":return "Bottom left";case "bottom-centre":return "Bottom centre";case "bottom-right":return "Bottom right";case "free":return "Where you put it";default:return "Top centre";}
        }
        List<DesktopVisuals.MenuItem> MainMenu() {
            var items=new List<DesktopVisuals.MenuItem>();
            DesktopVisuals.MenuItem head=new DesktopVisuals.MenuItem();head.Kind="head";head.Text="Computer Use";items.Add(head);
            DesktopVisuals.MenuItem record=new DesktopVisuals.MenuItem();record.Id=1;record.Text="Show bar and glow in recordings";record.Ticks=true;record.Checked=recordVisuals;items.Add(record);
            DesktopVisuals.MenuItem move=new DesktopVisuals.MenuItem();move.Id=2;move.Text="Move bar";move.Note=DockLabel(dock);move.Chevron=true;items.Add(move);
            // One press steps to the next level; the glow changes at once.
            DesktopVisuals.MenuItem bright=new DesktopVisuals.MenuItem();bright.Id=3;bright.Text="Glow brightness";bright.Note=glowLevel=="bright"?"Bright":glowLevel=="medium"?"Medium":"Soft";items.Add(bright);
            DesktopVisuals.MenuItem rule=new DesktopVisuals.MenuItem();rule.Kind="rule";items.Add(rule);
            DesktopVisuals.MenuItem foot=new DesktopVisuals.MenuItem();foot.Kind="foot";items.Add(foot);
            return items;
        }
        // Moving the bar without dragging it: the six docks, and Reset.
        List<DesktopVisuals.MenuItem> DockMenu() {
            var items=new List<DesktopVisuals.MenuItem>();
            DesktopVisuals.MenuItem head=new DesktopVisuals.MenuItem();head.Kind="head";head.Text="Move bar";items.Add(head);
            for(int i=0;i<Docks.Length;i++) {DesktopVisuals.MenuItem item=new DesktopVisuals.MenuItem();item.Id=10+i;item.Text=DockLabel(Docks[i]);item.Ticks=true;item.Checked=dock==Docks[i];items.Add(item);}
            DesktopVisuals.MenuItem rule=new DesktopVisuals.MenuItem();rule.Kind="rule";items.Add(rule);
            DesktopVisuals.MenuItem reset=new DesktopVisuals.MenuItem();reset.Id=20;reset.Text="Reset";reset.Ticks=true;items.Add(reset);
            return items;
        }
        void MenuChosen(int id) {
            if(id==1){ChangeRecordingPreference();if(MenuOpen)menu.Refresh(MainMenu());}
            else if(id==2){if(MenuOpen)menu.Swap(DockMenu());}
            else if(id==3){glowLevel=glowLevel=="soft"?"medium":glowLevel=="medium"?"bright":"soft";ApplyGlowLevel();SavePreferences();if(MenuOpen)menu.Refresh(MainMenu());}
            else if(id>=10&&id<10+Docks.Length){CloseMenu();MoveToDock(Docks[id-10]);}
            else if(id==20){CloseMenu();MoveToDock("top-centre");}
        }
        // bar.throw: the bar in its moving shape, in a click-through layered
        // window sized to that shape. Shown only while the body moves.
        sealed class BarGhost : Form {
            internal BarGhost() {
                FormBorderStyle=FormBorderStyle.None;ShowInTaskbar=false;TopMost=true;StartPosition=FormStartPosition.Manual;
                SetStyle(ControlStyles.UserPaint|ControlStyles.AllPaintingInWmPaint|ControlStyles.Opaque,true);
            }
            protected override bool ShowWithoutActivation {get {return true;}}
            // Tool window, no activation, layered, and transparent to input.
            protected override CreateParams CreateParams {get {CreateParams p=base.CreateParams;p.ExStyle|=0x08000080|0x00080000|0x20;return p;}}
            protected override void OnPaint(PaintEventArgs e) {}
            protected override void OnPaintBackground(PaintEventArgs e) {}
            bool record;
            internal void Recordable(bool on) {record=on;if(IsHandleCreated)SetWindowDisplayAffinity(Handle,on?0u:0x11u);}
            internal void Show(Bitmap surface,int x,int y,byte alpha) {
                if(IsDisposed)return;
                if(!Visible) {
                    Bounds=new Rectangle(x,y,surface.Width,surface.Height);Show();
                    SetPropW(Handle,"ComputerUseOverlayWindow",new IntPtr(1));SetWindowDisplayAffinity(Handle,record?0u:0x11u);
                }
                Overlay.Present(Handle,surface,x,y,alpha);
            }
            internal void Conceal() {if(!IsDisposed&&Visible)Hide();}
        }
        sealed class BarMenu : Form {
            readonly Guardian owner;List<DesktopVisuals.MenuItem> items=new List<DesktopVisuals.MenuItem>();
            float tall;int hover,pressed;bool low;
            // menu.open and menu.close: how far open the panel is, and where the current run began.
            float level,levelFrom;DateTime levelAt;bool closing;
            // menu.page: the page leaving and its height, with both pages' rows as pictures.
            float beforeTall;Bitmap beforeRows,afterRows;DateTime swapAt;bool swapping;
            // The whole menu at rest, drawn once; re-drawn only when a row's state or the page changes.
            Bitmap cache;
            readonly System.Windows.Forms.Timer tick=new System.Windows.Forms.Timer();
            internal BarMenu(Guardian o) {
                owner=o;FormBorderStyle=FormBorderStyle.None;ShowInTaskbar=false;TopMost=true;StartPosition=FormStartPosition.Manual;
                SetStyle(ControlStyles.UserPaint|ControlStyles.AllPaintingInWmPaint|ControlStyles.Opaque,true);
                AccessibleName="Computer Use settings";AccessibleRole=AccessibleRole.MenuPopup;
                tick.Interval=16;tick.Tick+=delegate {Step();};
            }
            internal bool Dismissing {get {return closing;}}
            protected override bool ShowWithoutActivation {get {return true;}}
            protected override CreateParams CreateParams {get {CreateParams p=base.CreateParams;p.ExStyle|=0x08000080|0x00080000;return p;}}
            protected override void OnPaint(PaintEventArgs e) {}
            protected override void OnPaintBackground(PaintEventArgs e) {}
            float Zoom {get {return owner.visualScale;}}
            int Inset {get {return (int)Math.Round(DesktopVisuals.MenuMargin*Zoom);}}
            // Opens the menu, or turns a closing one round from where it is.
            internal void Open(List<DesktopVisuals.MenuItem> list) {
                EndSwap();ticking.Clear();items=list;tall=DesktopVisuals.MenuLayout(items);hover=pressed=0;
                Place(tall);Render();
                if(!Visible) {
                    level=levelFrom=0;levelAt=DateTime.UtcNow;closing=false;Show();
                    SetPropW(Handle,"ComputerUseOverlayWindow",new IntPtr(1));SetWindowDisplayAffinity(Handle,owner.recordVisuals?0u:0x11u);
                    tick.Start();
                }
                else if(closing){closing=false;levelFrom=level;levelAt=DateTime.UtcNow;}
                Present();
            }
            // A change on the same page is drawn at once, except a tick, which
            // slides its row's text (menu.tick; instant with reduced motion).
            readonly Dictionary<int,float[]> ticking=new Dictionary<int,float[]>();DateTime tickAt;
            internal void Refresh(List<DesktopVisuals.MenuItem> list) {
                if(closing)return;
                EndSwap();
                var before=new Dictionary<int,DesktopVisuals.MenuItem>();
                foreach(DesktopVisuals.MenuItem item in items)if(item.Kind=="row"&&!before.ContainsKey(item.Id))before[item.Id]=item;
                DateTime now=DateTime.UtcNow;bool motion=DesktopVisuals.MotionEnabled;
                var next=new Dictionary<int,float[]>();
                foreach(DesktopVisuals.MenuItem item in list) {
                    DesktopVisuals.MenuItem old;float to=item.Checked?1:0;
                    if(!item.Ticks||item.Kind!="row"||!before.TryGetValue(item.Id,out old)||!old.Ticks)continue;
                    float from=CurrentTick(item.Id,old,now);
                    if(motion&&from!=to){item.TickLevel=from;next[item.Id]=new float[]{from,to};}
                }
                ticking.Clear();foreach(var run in next)ticking[run.Key]=run.Value;tickAt=now;
                items=list;tall=DesktopVisuals.MenuLayout(items);Place(tall);Render();Present();
            }
            // Where a row's tick is now, mid-slide or settled.
            float CurrentTick(int id,DesktopVisuals.MenuItem item,DateTime now) {
                float[] run;
                return ticking.TryGetValue(id,out run)?DesktopVisuals.TickAt((now-tickAt).TotalMilliseconds,run[0],run[1]):item.Tick;
            }
            bool StepTicks(DateTime now) {
                if(ticking.Count==0)return false;
                double ms=(now-tickAt).TotalMilliseconds;
                foreach(DesktopVisuals.MenuItem item in items) {
                    float[] run;if(!ticking.TryGetValue(item.Id,out run))continue;
                    item.TickLevel=ms>=DesktopVisuals.Normal?-1:DesktopVisuals.TickAt(ms,run[0],run[1]);
                }
                if(ms>=DesktopVisuals.Normal)ticking.Clear();
                Render();return true;
            }
            // menu.page: a new page. The panel's height moves while the old rows
            // leave and the new ones arrive (timing in DesktopVisuals.MenuPageAt).
            internal void Swap(List<DesktopVisuals.MenuItem> list) {
                if(closing)return;
                if(!DesktopVisuals.MotionEnabled){hover=pressed=0;Refresh(list);return;}
                EndSwap();ticking.Clear();
                beforeTall=tall;beforeRows=DesktopVisuals.MenuPage(items,tall,Zoom,hover,0);
                items=list;tall=DesktopVisuals.MenuLayout(items);hover=pressed=0;
                afterRows=DesktopVisuals.MenuPage(items,tall,Zoom,0,0);
                swapping=true;swapAt=DateTime.UtcNow;Place(Math.Max(beforeTall,tall));Present();
            }
            void EndSwap() {
                if(!swapping)return;
                swapping=false;
                if(beforeRows!=null){beforeRows.Dispose();beforeRows=null;}
                if(afterRows!=null){afterRows.Dispose();afterRows=null;}
                Place(tall);Render();
            }
            // menu.close: reversed over NormalLeave. While closing it takes no
            // input; at once when the bar hides or a screenshot needs the screen.
            internal void Dismiss(bool atOnce) {
                if(IsDisposed)return;
                if(atOnce||!Visible||!IsHandleCreated){Close();return;}
                if(closing)return;
                EndSwap();
                closing=true;levelFrom=level;levelAt=DateTime.UtcNow;
                if(hover!=0||pressed!=0){hover=pressed=0;Render();}
            }
            // 8 px under the bar, right edges aligned; above it when the bar is
            // docked low, where the bottom edge stays put as the height changes.
            void Place(float height) {
                float s=Zoom;int margin=Inset;
                Size size=new Size((int)Math.Round((DesktopVisuals.MenuWidth+2*DesktopVisuals.MenuMargin)*s),(int)Math.Round((height+2*DesktopVisuals.MenuMargin)*s));
                Rectangle work=Screen.FromRectangle(owner.Bounds).WorkingArea;
                low=owner.Top+owner.Height/2>work.Top+work.Height/2;
                int gap=(int)Math.Round(8*s),x=owner.Right-size.Width+margin,y=low?owner.Top-gap-size.Height+margin:owner.Bottom+gap-margin;
                x=Math.Max(work.Left-margin,Math.Min(x,work.Right-size.Width+margin));
                Bounds=new Rectangle(new Point(x,y),size);
            }
            void Render() {
                if(Width<=0||Height<=0)return;
                Bitmap next=new Bitmap(Width,Height,System.Drawing.Imaging.PixelFormat.Format32bppPArgb);
                using(Graphics g=Graphics.FromImage(next)) {g.Clear(Color.Transparent);g.ScaleTransform(Zoom,Zoom);DesktopVisuals.Menu(g,items,tall,hover,pressed);}
                Bitmap old=cache;cache=next;if(old!=null)old.Dispose();
            }
            // One frame of a page change, at the form's size.
            Bitmap Between() {
                float move,gone,come;DesktopVisuals.MenuPageAt((DateTime.UtcNow-swapAt).TotalMilliseconds,out move,out gone,out come);
                float s=Zoom,height=beforeTall+(tall-beforeTall)*move,top=low?Height/s-DesktopVisuals.MenuMargin-height:DesktopVisuals.MenuMargin;
                Bitmap frame=new Bitmap(Width,Height,System.Drawing.Imaging.PixelFormat.Format32bppPArgb);
                using(Graphics g=Graphics.FromImage(frame)) {
                    g.Clear(Color.Transparent);g.ScaleTransform(s,s);
                    DesktopVisuals.MenuBetween(g,new RectangleF(DesktopVisuals.MenuMargin,top,DesktopVisuals.MenuWidth,height),s,beforeRows,gone,afterRows,come);
                }
                return frame;
            }
            void Present() {
                if(!IsHandleCreated||Width<=0||Height<=0||cache==null)return;
                try {
                    Bitmap frame=swapping?Between():null;
                    try {
                        Bitmap content=frame!=null?frame:cache;
                        if(level>=1){Overlay.Present(Handle,content,Left,Top,255);return;}
                        // menu.open: opacity and scale from MenuFrom, growing from the
                        // corner nearest the Settings button. Reduced motion: opacity only.
                        float grow=DesktopVisuals.MotionEnabled?DesktopVisuals.MenuFrom+(1-DesktopVisuals.MenuFrom)*level:1;
                        using(Bitmap surface=new Bitmap(Width,Height,System.Drawing.Imaging.PixelFormat.Format32bppPArgb)) {
                            using(Graphics g=Graphics.FromImage(surface)) {
                                g.Clear(Color.Transparent);g.InterpolationMode=InterpolationMode.HighQualityBilinear;g.PixelOffsetMode=PixelOffsetMode.HighQuality;
                                float ox=Width-Inset,oy=low?Height-Inset:Inset;
                                g.TranslateTransform(ox,oy);g.ScaleTransform(grow,grow);g.TranslateTransform(-ox,-oy);
                                g.DrawImage(content,new Rectangle(0,0,content.Width,content.Height));
                            }
                            Overlay.Present(Handle,surface,Left,Top,(byte)Math.Max(0,Math.Min(255,(int)Math.Round(255*level))));
                        }
                    } finally {if(frame!=null)frame.Dispose();}
                } catch {}
            }
            void Step() {
                if(IsDisposed)return;
                // The bar leaving closes the menu at once.
                if(!owner.BarShown){Close();return;}
                DateTime now=DateTime.UtcNow;bool motion=DesktopVisuals.MotionEnabled,redraw=false;
                if(closing||level<1) {
                    double t=(now-levelAt).TotalMilliseconds/(closing?(motion?DesktopVisuals.NormalLeave:DesktopVisuals.FastLeave):(motion?DesktopVisuals.Normal:DesktopVisuals.Fast));
                    if(closing&&t>=1){Close();return;}
                    float e=DesktopVisuals.EaseOut((float)Math.Min(1,t));
                    level=t>=1?1:closing?levelFrom*(1-e):levelFrom+(1-levelFrom)*e;redraw=true;
                }
                if(swapping){if((now-swapAt).TotalMilliseconds>=DesktopVisuals.Normal)EndSwap();redraw=true;}
                if(StepTicks(now))redraw=true;
                if(redraw)Present();
                if(closing)return;
                // A press anywhere else closes the menu.
                if(Control.MouseButtons!=MouseButtons.None&&!PanelBounds().Contains(Cursor.Position)&&!owner.Bounds.Contains(Cursor.Position))Dismiss(false);
            }
            Rectangle PanelBounds() {
                int margin=Inset;
                return new Rectangle(Left+margin,Top+margin,Width-2*margin,Height-2*margin);
            }
            bool Still {get {return !closing&&!swapping;}}
            int Hit(Point client) {
                float s=Zoom;PointF p=new PointF(client.X/s-DesktopVisuals.MenuMargin,client.Y/s-DesktopVisuals.MenuMargin);
                foreach(DesktopVisuals.MenuItem item in items)if(item.Kind=="row"&&item.Bounds.Contains(p))return item.Id;
                return 0;
            }
            protected override void OnMouseMove(MouseEventArgs e) {int id=Still?Hit(e.Location):0;if(Still&&id!=hover){hover=id;Cursor=id!=0?Cursors.Hand:Cursors.Default;Render();Present();}base.OnMouseMove(e);}
            protected override void OnMouseLeave(EventArgs e) {if(Still&&(hover!=0||pressed!=0)){hover=pressed=0;Render();Present();}base.OnMouseLeave(e);}
            protected override void OnMouseDown(MouseEventArgs e) {if(Still){pressed=Hit(e.Location);Render();Present();}base.OnMouseDown(e);}
            protected override void OnMouseUp(MouseEventArgs e) {
                if(!Still){base.OnMouseUp(e);return;}
                int id=Hit(e.Location),was=pressed;pressed=0;Render();Present();base.OnMouseUp(e);
                if(id!=0&&id==was)owner.MenuChosen(id);
            }
            protected override void OnFormClosed(FormClosedEventArgs e) {
                tick.Stop();tick.Dispose();
                foreach(Bitmap image in new Bitmap[]{cache,beforeRows,afterRows})if(image!=null)image.Dispose();
                cache=beforeRows=afterRows=null;base.OnFormClosed(e);
            }
        }
        // The access prompt. It stays a modal dialog with a real text box and
        // real buttons, so focus, the keyboard and screen readers behave as in
        // any dialog; only the drawing is ours. The card behind it (shadow,
        // round corners) is a second window that takes no input.
        internal sealed class AccessPrompt : Form {
            [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr h,IntPtr after,int x,int y,int cx,int cy,uint flags);
            [DllImport("uxtheme.dll",CharSet=CharSet.Unicode)] static extern int SetWindowTheme(IntPtr h,string app,string ids);
            readonly float zoom;readonly bool contrast;readonly Rectangle anchor;readonly string title;readonly DesktopVisuals.PromptApp app;
            readonly TextBox body=new TextBox();readonly PromptButton allow,deny;readonly Font face;readonly float rule;
            Shade shade;
            internal bool Unmarked;   // the bench's trial stays visible to screenshots
            int Px(float logical) {return (int)Math.Round(logical*zoom);}
            // bar: the control bar's bounds when it is on screen, or empty.
            // forApp: the app this asks for, drawn as a row under the heading; the
            // message is then the detail text. Without it the first line of the
            // message is the heading.
            internal AccessPrompt(string message,float scale,bool highContrast,Rectangle bar,DesktopVisuals.PromptApp forApp=null,string heading=null) {
                zoom=scale;contrast=highContrast;anchor=bar;app=forApp;
                AutoScaleMode=AutoScaleMode.None;FormBorderStyle=FormBorderStyle.None;ShowInTaskbar=false;StartPosition=FormStartPosition.Manual;
                MaximizeBox=false;MinimizeBox=false;   // a double-click or a drag to the screen edge must not resize it
                BackColor=DesktopVisuals.PromptSurface(contrast);
                SetStyle(ControlStyles.UserPaint|ControlStyles.AllPaintingInWmPaint|ControlStyles.OptimizedDoubleBuffer,true);
                // The first line is the question. Anything else is shown whole.
                string text=(message??"").Replace("\r\n","\n").Trim();int cut=text.IndexOf('\n');
                if(app!=null&&!String.IsNullOrEmpty(heading))title=heading;
                else if(cut>0&&cut<=64){title=text.Substring(0,cut).Trim();text=text.Substring(cut).Trim();}
                else title="Computer Use needs your answer";
                AccessibleName=title;AccessibleRole=AccessibleRole.Dialog;
                if(app!=null)AccessibleDescription=app.Name+". "+app.Tag+". "+app.Sentence+". "+app.Sub+".";
                int pad=Px(DesktopVisuals.PromptPad),wide=Px(DesktopVisuals.PromptWidth-2*DesktopVisuals.PromptInset),most=Px(DesktopVisuals.PromptBodyMost);
                face=DesktopVisuals.PromptFont(zoom);
                body.Multiline=true;body.ReadOnly=true;body.BorderStyle=BorderStyle.None;body.Font=face;body.TabIndex=2;
                body.BackColor=BackColor;body.ForeColor=DesktopVisuals.PromptInk(contrast);body.AccessibleName="Request";
                body.Text=text.Replace("\n","\r\n");body.SetBounds(pad-Px(3),Px(DesktopVisuals.PromptTop(app!=null)),wide-2*pad+Px(3),most);   // the box insets its own text by 3
                body.HandleCreated+=delegate {if(!contrast)try {SetWindowTheme(body.Handle,"DarkMode_Explorer",null);}catch {}};
                // As tall as its text, up to the limit; past that it scrolls, and nothing is cut.
                int tall=Fill();
                if(tall>most){body.ScrollBars=ScrollBars.Vertical;tall=most;}
                body.Height=tall;body.Select(0,0);Controls.Add(body);
                rule=DesktopVisuals.PromptTop(app!=null)+tall/zoom+12;
                int ring=Px(DesktopVisuals.PromptRing),across=Px(DesktopVisuals.PromptButtonWidth)+2*ring,down=Px(DesktopVisuals.PromptButtonHeight)+2*ring,row=Px(rule+12)-ring;
                deny=new PromptButton(this,"Deny",false);allow=new PromptButton(this,"Allow",true);
                deny.SetBounds(wide-pad-across+ring,row,across,down);allow.SetBounds(deny.Left-Px(8)+2*ring-across,row,across,down);
                deny.DialogResult=DialogResult.No;allow.DialogResult=DialogResult.Yes;deny.TabIndex=0;allow.TabIndex=1;
                Controls.Add(deny);Controls.Add(allow);
                // Enter and Esc both mean Deny, and Deny holds the focus when the prompt opens.
                CancelButton=deny;AcceptButton=deny;ActiveControl=deny;
                ClientSize=new Size(wide,Px(rule+12+DesktopVisuals.PromptButtonHeight+DesktopVisuals.PromptPad));
                Place();
            }
            // The bench's app request, as the guardian composes it for a row.
            internal static AccessPrompt SampleRow(bool click,float scale,bool highContrast,Rectangle bar) {
                string detail=click
                    ?"C:\\Program Files\\WindowsApps\\Microsoft.WindowsTerminal_8wekyb3d8bbwe\\WindowsTerminal.exe\r\nPID 9120\r\n\r\nTask: Read the build output and press the Run button."
                    :"C:\\Windows\\System32\\notepad.exe\r\nPID 18244\r\n\r\nTask: Type the meeting notes into Notepad and save them.";
                detail+="\r\n\r\nIts screenshots and accessibility text go to Antigravity's configured model. Ordinary actions run autonomously. Consequential effects need a separate confirmation. Your real mouse/keyboard will be used. Esc or Ctrl+Alt+F12 stops. Use a disposable account/VM for important data.";
                return new AccessPrompt(detail,scale,highContrast,bar,DesktopVisuals.PromptApp.For(click?"click":"full",click?"Windows Terminal":"Notepad",!click),"Allow Antigravity to use this app?");
            }
            // The text's height at the box's width, as the box itself wraps it.
            int Fill() {
                int lines=body.GetLineFromCharIndex(body.TextLength)+1,line=face.Height;
                if(lines>1) {
                    int step=body.GetPositionFromCharIndex(body.GetFirstCharIndexFromLine(1)).Y-body.GetPositionFromCharIndex(0).Y;
                    if(step>0)line=step;
                }
                return lines*line+Px(2);
            }
            // 8 px under the bar and centred on it, above it when the bar is
            // docked low; in the middle of the screen when there is no bar.
            void Place() {
                Rectangle work=(anchor.IsEmpty?Screen.PrimaryScreen:Screen.FromRectangle(anchor)).WorkingArea;
                int inset=Px(DesktopVisuals.PromptInset),keep=Px(12)+inset,x,y;
                if(anchor.IsEmpty){x=work.Left+(work.Width-Width)/2;y=work.Top+(work.Height-Height)/2;}
                else {
                    bool low=anchor.Top+anchor.Height/2>work.Top+work.Height/2;
                    x=anchor.Left+(anchor.Width-Width)/2;y=low?anchor.Top-Px(8)-inset-Height:anchor.Bottom+Px(8)+inset;
                }
                x=Math.Max(work.Left+keep,Math.Min(x,work.Right-keep-Width));y=Math.Max(work.Top+keep,Math.Min(y,work.Bottom-keep-Height));
                Location=new Point(x,y);
            }
            float NoteWidth {get {return (allow.Left+Px(DesktopVisuals.PromptRing))/zoom-DesktopVisuals.PromptPad-12;}}
            protected override void OnPaint(PaintEventArgs e) {
                e.Graphics.Clear(BackColor);e.Graphics.ScaleTransform(zoom,zoom);
                DesktopVisuals.PromptFace(e.Graphics,Width/zoom,title,rule,NoteWidth,contrast,app);
            }
            protected override void OnLoad(EventArgs e) {base.OnLoad(e);shade=new Shade();shade.Lay(Bounds,zoom,contrast);}
            protected override void OnShown(EventArgs e) {
                base.OnShown(e);
                if(shade!=null&&!Unmarked)Mark(shade);
                Under();
            }
            protected override void OnActivated(EventArgs e) {base.OnActivated(e);Under();}
            protected override void OnMove(EventArgs e) {base.OnMove(e);if(shade!=null&&!shade.IsDisposed)shade.Lay(Bounds,zoom,contrast);}
            // The card stays directly behind the dialog.
            void Under() {if(shade!=null&&!shade.IsDisposed&&IsHandleCreated)SetWindowPos(shade.Handle,Handle,0,0,0,0,0x0013);}
            // The title strip moves the prompt, so it can be slid off whatever it covers.
            protected override void WndProc(ref Message m) {
                base.WndProc(ref m);
                if(m.Msg==0x0084&&m.Result==(IntPtr)1) {
                    Point at=PointToClient(new Point(unchecked((short)(long)m.LParam),unchecked((short)((long)m.LParam>>16))));
                    if(at.Y<body.Top)m.Result=(IntPtr)2;
                }
            }
            protected override void OnFormClosed(FormClosedEventArgs e) {if(shade!=null&&!shade.IsDisposed)shade.Close();base.OnFormClosed(e);}
            protected override void Dispose(bool disposing) {
                if(disposing){if(shade!=null&&!shade.IsDisposed)shade.Dispose();face.Dispose();}
                base.Dispose(disposing);
            }
            // The bench's picture of the prompt: the same layout, with the
            // text and buttons drawn in place of the live controls.
            // hover, press and focus: 0 none, 1 Allow, 2 Deny.
            internal Bitmap Picture(int hover,int press,int focus) {
                int margin=Px(DesktopVisuals.PromptMargin+DesktopVisuals.PromptInset),ring=Px(DesktopVisuals.PromptRing);
                Bitmap sheet=new Bitmap(Width+2*margin,Height+2*margin,System.Drawing.Imaging.PixelFormat.Format32bppArgb);
                using(Graphics g=Graphics.FromImage(sheet)) {
                    g.Clear(Color.FromArgb(31,33,40));
                    var saved=g.Save();g.ScaleTransform(zoom,zoom);
                    DesktopVisuals.PromptCard(g,new RectangleF(DesktopVisuals.PromptMargin,DesktopVisuals.PromptMargin,sheet.Width/zoom-2*DesktopVisuals.PromptMargin,sheet.Height/zoom-2*DesktopVisuals.PromptMargin),contrast);
                    g.Restore(saved);
                    using(Bitmap inner=new Bitmap(Width,Height,System.Drawing.Imaging.PixelFormat.Format32bppArgb)) {
                        using(Graphics f=Graphics.FromImage(inner)) {
                            f.Clear(BackColor);
                            TextRenderer.DrawText(f,body.Text,face,body.Bounds,body.ForeColor,BackColor,TextFormatFlags.WordBreak|TextFormatFlags.TextBoxControl|TextFormatFlags.NoPrefix);
                            f.ScaleTransform(zoom,zoom);
                            DesktopVisuals.PromptFace(f,Width/zoom,title,rule,NoteWidth,contrast,app);
                            foreach(PromptButton button in new PromptButton[]{allow,deny}) {
                                int which=button==allow?1:2;
                                DesktopVisuals.PromptButton(f,new RectangleF((button.Left+ring)/zoom,(button.Top+ring)/zoom,DesktopVisuals.PromptButtonWidth,DesktopVisuals.PromptButtonHeight),button.Text,button==allow,hover==which,press==which,focus==which,contrast);
                            }
                        }
                        g.DrawImage(inner,new Rectangle(margin,margin,Width,Height));
                    }
                }
                return sheet;
            }
            sealed class PromptButton : Button {
                readonly AccessPrompt owner;readonly bool filled;bool hover,down;
                internal PromptButton(AccessPrompt o,string text,bool fill) {
                    owner=o;filled=fill;Text=text;Cursor=Cursors.Hand;
                    SetStyle(ControlStyles.UserPaint|ControlStyles.AllPaintingInWmPaint|ControlStyles.OptimizedDoubleBuffer,true);
                }
                protected override void OnPaint(PaintEventArgs e) {
                    e.Graphics.Clear(owner.BackColor);e.Graphics.ScaleTransform(owner.zoom,owner.zoom);
                    DesktopVisuals.PromptButton(e.Graphics,new RectangleF(DesktopVisuals.PromptRing,DesktopVisuals.PromptRing,DesktopVisuals.PromptButtonWidth,DesktopVisuals.PromptButtonHeight),Text,filled,hover,down,Focused,owner.contrast);
                }
                void Set(ref bool field,bool value) {if(field!=value){field=value;Invalidate();}}
                protected override void OnMouseEnter(EventArgs e) {Set(ref hover,true);base.OnMouseEnter(e);}
                protected override void OnMouseLeave(EventArgs e) {Set(ref hover,false);Set(ref down,false);base.OnMouseLeave(e);}
                protected override void OnMouseDown(MouseEventArgs e) {if(e.Button==MouseButtons.Left)Set(ref down,true);base.OnMouseDown(e);}
                protected override void OnMouseUp(MouseEventArgs e) {Set(ref down,false);base.OnMouseUp(e);}
                protected override void OnKeyDown(KeyEventArgs e) {if(e.KeyCode==Keys.Space)Set(ref down,true);base.OnKeyDown(e);}
                protected override void OnKeyUp(KeyEventArgs e) {Set(ref down,false);base.OnKeyUp(e);}
                protected override void OnGotFocus(EventArgs e) {base.OnGotFocus(e);Invalidate();}
                protected override void OnLostFocus(EventArgs e) {Set(ref down,false);base.OnLostFocus(e);Invalidate();}
            }
            sealed class Shade : Form {
                Bitmap card;
                internal Shade() {
                    FormBorderStyle=FormBorderStyle.None;ShowInTaskbar=false;TopMost=true;StartPosition=FormStartPosition.Manual;
                    SetStyle(ControlStyles.Opaque,true);
                }
                protected override bool ShowWithoutActivation {get {return true;}}
                protected override CreateParams CreateParams {get {CreateParams p=base.CreateParams;p.ExStyle|=0x08000080|0x00080000|0x00000020;return p;}}
                protected override void OnPaint(PaintEventArgs e) {}
                protected override void OnPaintBackground(PaintEventArgs e) {}
                // Draws the card around the dialog's bounds and follows them.
                internal void Lay(Rectangle dialog,float zoom,bool contrast) {
                    int margin=(int)Math.Round((DesktopVisuals.PromptMargin+DesktopVisuals.PromptInset)*zoom);
                    Rectangle place=Rectangle.Inflate(dialog,margin,margin);
                    if(card==null||card.Size!=place.Size) {
                        if(card!=null)card.Dispose();
                        card=new Bitmap(place.Width,place.Height,System.Drawing.Imaging.PixelFormat.Format32bppPArgb);
                        using(Graphics g=Graphics.FromImage(card)) {
                            g.Clear(Color.Transparent);g.ScaleTransform(zoom,zoom);
                            DesktopVisuals.PromptCard(g,new RectangleF(DesktopVisuals.PromptMargin,DesktopVisuals.PromptMargin,place.Width/zoom-2*DesktopVisuals.PromptMargin,place.Height/zoom-2*DesktopVisuals.PromptMargin),contrast);
                        }
                    }
                    Bounds=place;
                    if(!Visible)Show();
                    try {Overlay.Present(Handle,card,place.X,place.Y,255);}catch {}
                }
                protected override void Dispose(bool disposing) {if(disposing&&card!=null){card.Dispose();card=null;}base.Dispose(disposing);}
            }
        }
        // Bench: shows one sample prompt for a few seconds, visible to
        // screenshots, and prints how it was answered. kind: 0 app, 1 action,
        // 2 launch. bar: "top", "bottom" or "corner" places it against a bar
        // docked there; anything else is no bar.
        internal static void PromptTrial(int seconds,int kind,string bar) {
            Application.EnableVisualStyles();
            Screen screen=Screen.PrimaryScreen;float scale=Overlay.ScreenScale(screen);Rectangle work=screen.WorkingArea,dock=Rectangle.Empty;
            Size pill=new Size((int)Math.Round(DesktopVisuals.HudWidth*scale),(int)Math.Round(DesktopVisuals.HudHeight*scale));int inset=(int)Math.Ceiling(12*scale);
            if(bar=="top")dock=new Rectangle(new Point(work.Left+(work.Width-pill.Width)/2,work.Top+inset),pill);
            else if(bar=="bottom")dock=new Rectangle(new Point(work.Left+(work.Width-pill.Width)/2,work.Bottom-inset-pill.Height),pill);
            else if(bar=="corner")dock=new Rectangle(new Point(work.Right-inset-pill.Width,work.Bottom-inset-pill.Height),pill);
            // kind 3 and 4 are the app row at full control and click only.
            using(AccessPrompt prompt=kind>=3?AccessPrompt.SampleRow(kind==4,scale,SystemInformation.HighContrast,dock):new AccessPrompt(DesktopVisuals.PromptSamples[Math.Max(0,Math.Min(2,kind))],scale,SystemInformation.HighContrast,dock)) {
                prompt.Unmarked=true;prompt.Text="Computer Use — prompt trial";prompt.TopMost=true;
                System.Windows.Forms.Timer end=new System.Windows.Forms.Timer();end.Interval=Math.Max(1,seconds)*1000;
                end.Tick+=delegate {end.Stop();prompt.Close();};end.Start();
                DialogResult answer=prompt.ShowDialog();end.Dispose();
                Console.Out.WriteLine("prompt trial: answer="+answer+" bounds="+prompt.Bounds+" scale="+scale);
            }
        }
        internal static void Mark(Form f) {
            SetPropW(f.Handle, "ComputerUseOverlayWindow", new IntPtr(1));
            SetWindowDisplayAffinity(f.Handle, 0x11);
        }
        internal static string ResolveGuardState(string proposed,long capturedStop,long currentStop,bool latched) {
            return proposed!="stopped"&&(capturedStop!=currentStop||latched)?"stopped":proposed;
        }
        void WriteState(long capturedStop=-1) { lock(stateLock) {
            if(capturedStop>=0) {
                state=ResolveGuardState(state,capturedStop,Interlocked.Read(ref stopEpoch),ControlFence.LatchBlocks(StopLatch));
                if(state=="stopped")ClearGrants();
            }
            string f = ControlFence.FileName;
            if (String.IsNullOrEmpty(f)) return;
            string temp = f + ".tmp";
            File.WriteAllText(temp, state+"|"+token+"|"+deadline.ToString()+"|"+Convert.ToBase64String(Encoding.UTF8.GetBytes(String.Join("\n",grants)))+"|"+bootDeadline.ToString()+"|"+Convert.ToBase64String(Encoding.UTF8.GetBytes(String.Join("\n",clickGrants))));
            AtomicFile.Publish(temp,f);
        } }
        void SetState(string next,string reason=null,bool updateVisibility=true,long humanRearmEpoch=-1) {
            long capturedStop=humanRearmEpoch>=0?humanRearmEpoch:Interlocked.Read(ref stopEpoch);
            if (state == "stopped" && next != "stopped" && humanRearmEpoch<0) return;
            if(next=="stopped")ControlFence.LatchStop();
            if(next=="stopped"&&state!="stopped")stoppedAt=DateTime.UtcNow;
            if(next=="stopped"&&reason!=null)lastReason=reason;
            if(next=="active"){ended=false;lowTime=false;releasing=false;}
            if(next=="idle")ended=reason=="session_expired";
            state = next; if(state=="stopped")ClearGrants(); takeover.Reset(Presence.Capture());
            try { WriteState(capturedStop); }
            catch {
                // A failed state transition must never skip cleanup or leave a
                // newly active session usable on an older native fence.
                state="stopped";ClearGrants();ControlFence.LatchStop();
                GuardCleanup.Run(StopWorkers,ControlFence.Recover,Overlay.HideAll,CursorSafety.Restore);
                try { RefreshHud(); } catch { }
                Emit(new {ev="state",state="stopped",reason="guard_persistence_failed",custom_cursor=CursorSafety.Applied});return;
            }
            RefreshHud();
            if (state != "active") {
                // Missing or failed ledgers must not interrupt the remaining
                // cleanup or leave the guardian claiming an idle/paused state.
                GuardCleanup.Run(StopWorkers,ControlFence.Recover,Overlay.HideAll,CursorSafety.Restore);
                activityHwnd=0;activityX=Int32.MinValue;activityY=Int32.MinValue;activity="";
                if(InputLedger.HasHeld()) {
                    state="stopped";ClearGrants();ControlFence.LatchStop();reason="input_cleanup_failed";releasing=true;releaseChecked=DateTime.UtcNow;
                    try {WriteState();}catch {reason="guard_persistence_failed";}
                    try {RefreshHud();}catch {}
                }
            }
            else if(!CursorSafety.Apply()) {
                if(!CursorSafety.CheckWatchdog()) { Emergency("watchdog_unavailable"); return; }
                Emit(new {ev="visual_warning",message="Custom pointer unavailable; Windows pointer retained"});
            }
            if(updateVisibility) {
                if(state=="active"||state=="paused")ShowControls(0);
                else if(state=="stopped")ShowControls(releasing?0:4000);
                // Session ended is a confirmation too: 4 s, then the bar leaves.
                else if(ended&&BarShown)ShowControls(4000);
                else DismissControls();
            }
            Emit(new { ev="state", state=state, reason=reason, custom_cursor=CursorSafety.Applied });
        }
        void Emergency(string reason="request") {
            // Hook thread invalidates the native fence BEFORE waiting for the UI thread.
            Interlocked.Increment(ref stopEpoch);
            if(state!="stopped")stoppedAt=DateTime.UtcNow;
            lastReason=reason;
            state="stopped"; ControlFence.LatchStop(); try { WriteState(); } catch { }
            // glow.stop: the glow leaves at once, whatever it was doing.
            Overlay.GlowStop();
            GuardCleanup.Run(StopWorkers,ControlFence.Recover); Emit(new { ev="state", state="stopped", reason=reason });
            long emergencyEpoch=Interlocked.Increment(ref visibilityEpoch);
            MethodInvoker cleanup=delegate { if(activePrompt!=null) activePrompt.Close(); ClearGrants(); SetState("stopped",null,Interlocked.Read(ref visibilityEpoch)==emergencyEpoch); };
            try {if(InvokeRequired)BeginInvoke(cleanup);else cleanup();} catch { }
        }
        void StopWorkers() {
            lock(workerLock) {
                foreach(Process p in workers)try {if(!p.HasExited)p.Kill();}catch{}
                // A submitted kill is not confirmed exit. Retain unresolved
                // handles for acknowledgement and human-resume checks.
                workers.RemoveAll(delegate(Process p){try{return p.HasExited;}catch{return false;}});
            }
        }
        bool WorkersExited(int timeoutMs) {
            Process[] snapshot;lock(workerLock){snapshot=workers.ToArray();}
            return NativeStopReceipt.WorkersExited(snapshot,timeoutMs);
        }
        void WriteWorkers() {
            List<string> live=new List<string>();
            foreach(Process p in workers)try {if(!p.HasExited)live.Add(p.Id+":"+p.StartTime.ToUniversalTime().Ticks);}catch {}
            string file=ControlFence.FileName+".workers",temp=file+".tmp";File.WriteAllLines(temp,live);
            AtomicFile.Publish(temp,file);
        }
        void Tick(object sender, EventArgs e) {
            if(controlsRequested && DateTime.UtcNow>=controlsUntil) {
                // The pointer over the bar, or its open menu, holds the timer.
                if(Bounds.Contains(Cursor.Position)||MenuOpen)controlsUntil=DateTime.UtcNow.AddMilliseconds(600);
                else DismissControls();
            }
            if((state=="active"||state=="paused"||prompting)&&ControlFence.LatchBlocks(StopLatch)) {Emergency(ControlFence.LatchEntryBlocks(StopLatch+".unconfirmed")?"guardian_stop_unconfirmed":"persisted_emergency_stop");return;}
            if((state=="active"||state=="paused"||prompting)&&!(bool)DesktopContext.Inspect()["interactive"]) {Emergency("input_desktop_changed");DismissControls();return;}
            if (prompting || captureHidden) return;
            if(activity!="" && (DateTime.UtcNow-activityAt).TotalMilliseconds>1200) {activity="";RefreshHud();}
            if(state=="active"&&!lowTime&&deadline-DateTime.UtcNow.Ticks<=60*TimeSpan.TicksPerSecond){lowTime=true;RefreshHud();}
            // A stop that could not release held input at once keeps the bar
            // up, without Hide, until the release is confirmed.
            if(releasing&&(DateTime.UtcNow-releaseChecked).TotalMilliseconds>=1000) {
                releaseChecked=DateTime.UtcNow;
                if(state!="stopped"||!InputLedger.HasHeld()){releasing=false;if(state=="stopped")ShowControls(4000);RefreshHud();}
            }
            // bar.return: home again once the click that needed the room is over.
            if(displaced&&!dragging&&(DateTime.UtcNow-displacedAt).TotalMilliseconds>1500&&(DateTime.UtcNow-activityAt).TotalMilliseconds>1200) {
                displaced=false;SlideTo(Home(Screen.FromRectangle(Bounds).WorkingArea),DesktopVisuals.Slow);
            }
            if (state == "active") {
                if(!CursorSafety.CheckWatchdog()){Emergency("cursor_watchdog_failed");return;}
                if (DateTime.UtcNow.Ticks >= deadline || !NativeDeadline.Valid(bootDeadline,NativeDeadline.GetTickCount64())) { SetState("idle","session_expired"); return; }
                Overlay.MarkActive();
                if (Overlay.ConsumeStop()) SetState("stopped");
            }
        }
        void Read() {
            try {
                string line;
                while ((line=Console.ReadLine()) != null) {
                    Dictionary<string, object> msg = js.DeserializeObject(line) as Dictionary<string, object>;
                    if (msg != null) BeginInvoke((MethodInvoker)delegate { Receive(msg); });
                }
            } catch { }
            try { BeginInvoke((MethodInvoker)delegate {normalClose=state=="idle";if(!normalClose)SetState("stopped",null,false);DismissControls();Close(); }); } catch { }
        }
        void Receive(Dictionary<string, object> m) {
            string op = Convert.ToString(m["op"]); object id=m.ContainsKey("id")?m["id"]:null;
            if(op=="visual_status") {Emit(new {id=id,state=state,controls_visible=BarShown,bounds=new int[]{Left,Top,Width,Height},cursor=CursorSafety.Applied,watchdog_pid=CursorSafety.WatchdogPid,glow_opacity=Overlay.GlowOpacity,takeover_mode=takeover.Mode,record_visuals=recordVisuals,activity_hwnd=activityHwnd,activity_point=activityX==Int32.MinValue?null:new int[]{activityX,activityY},host_name=hostName,line1=Model().Line1,line2=Model().Line2,dock=dock,glow=Overlay.GlowReport()});return;}
            if(op=="avoid_input") {
                bool canAvoid=state=="active"&&m.ContainsKey("token")&&Convert.ToString(m["token"])==token;
                bool moved=false;
                try {
                    object[] values=m.ContainsKey("rect")?m["rect"] as object[]:null;
                    int[] rect=new int[4];
                    if(values==null||values.Length!=4)canAvoid=false;
                    else for(int i=0;i<4;i++)if(!Int32.TryParse(Convert.ToString(values[i]),out rect[i])||Math.Abs((long)rect[i])>10000000)canAvoid=false;
                    if(rect[2]<=0||rect[3]<=0)canAvoid=false;
                    if(canAvoid&&BarShown) {
                        Rectangle placement;
                        canAvoid=WindowGeometry.AvoidHud(Bounds,new Rectangle(rect[0],rect[1],rect[2],rect[3]),Screen.FromRectangle(Bounds).WorkingArea,(int)Math.Ceiling(12*visualScale),out placement);
                        // bar.stepAside is a jump, so the reply always reports the final place.
                        if(canAvoid&&placement!=Bounds){sliding=false;CancelBody();Location=placement.Location;moved=true;displaced=true;displacedAt=DateTime.UtcNow;}
                    }
                }catch{canAvoid=false;}
                // This operation never changes Stop, state, grants or visibility.
                Emit(new {id=id,allowed=canAvoid,moved=moved,state=state});return;
            }
            // Bench only: a scripted throw of the bar (see StartDemo).
            if(op=="bar_demo"&&barTrial) {
                StartDemo(Convert.ToDouble(m["vx"]),Convert.ToDouble(m["vy"]),m.ContainsKey("seconds")?Convert.ToDouble(m["seconds"]):.25);
                Emit(new {id=id,started=body!=null});return;
            }
            if(op=="show_controls") {
                rearmLocked=m.ContainsKey("rearm_locked")&&Convert.ToBoolean(m["rearm_locked"]);
                var context=DesktopContext.Inspect();
                if(!(bool)context["interactive"]) {DismissControls();Emit(new {id=id,state=state,controls_visible=false,desktop_context=context,error=new {code="desktop_context_unavailable",message="Controls cannot be shown on the visible input desktop. Use the installed local launcher; no desktop was switched."}});return;}
                ended=false;ShowControls(0);RefreshHud();Emit(new {id=id,state=state,controls_visible=BarShown,desktop_context=context,human_rearm_required=false,rearm_locked=rearmLocked});return;
            }
            if(op=="dismiss_controls") {if(state=="active"||state=="paused")Emergency("dismiss");DismissControls();Emit(new {id=id,state=state,controls_visible=BarShown});return;}
            if(op=="activity" && state=="active") {
                string action=Convert.ToString(m["action"]);bool feedback=m.ContainsKey("click_feedback")&&Convert.ToBoolean(m["click_feedback"]);
                switch(action) {case "move":activity="Moving";break;case "click":activity="Clicking";break;case "drag":activity="Dragging";break;case "scroll":activity="Scrolling";break;case "type":case "set_value":case "key":activity="Typing";break;case "observe":activity="Reading the screen";break;default:activity="Working";break;}
                activityAt=DateTime.UtcNow;
                // A point belongs only to the message that carries it: a later
                // action without one goes back to following the pointer.
                bool pointed=false;
                try {
                    long target;
                    if(m.ContainsKey("hwnd")&&Int64.TryParse(Convert.ToString(m["hwnd"]),out target)&&target>0) {
                        // Only a window of an app approved for this task is
                        // accepted. A message that names no window keeps the last one.
                        string key=Convert.ToString(ControlFence.Identity(target)["key"]);
                        if(grants.Contains(key)){if(activityHwnd!=target){activityX=Int32.MinValue;activityY=Int32.MinValue;}activityHwnd=target;}
                    }
                    object[] point=m.ContainsKey("point")?m["point"] as object[]:null;int px,py;
                    if(activityHwnd!=0&&point!=null&&point.Length==2&&Int32.TryParse(Convert.ToString(point[0]),out px)&&Int32.TryParse(Convert.ToString(point[1]),out py)&&Math.Abs((long)px)<10000000&&Math.Abs((long)py)<10000000) {activityX=px;activityY=py;pointed=true;}
                    if(m.ContainsKey("host_name"))SetHost(Convert.ToString(m["host_name"]),m.ContainsKey("host_path")?Convert.ToString(m["host_path"]):null);
                } catch {}
                // The glow follows the last window that received an action.
                // Reading the screen shows it without a pulse.
                if(activityHwnd!=0)Overlay.GlowTarget(activityHwnd,activityX,activityY,pointed,action!="observe",feedback);
                RefreshHud();
                if(feedback)Overlay.ClickFeedback();
                return;
            }
            if(op=="attach") {
                try {
                    Process p=Process.GetProcessById(Convert.ToInt32(m["pid"]));
                    if(p.Id!=Process.GetCurrentProcess().Id && String.Equals(p.MainModule.FileName,Process.GetCurrentProcess().MainModule.FileName,StringComparison.OrdinalIgnoreCase))
                        lock(workerLock) { if(!workers.Exists(v=>v.Id==p.Id))workers.Add(p);WriteWorkers(); }
                } catch { }
                return;
            }
            if (op == "clear_stop") {
                // A confirmed Stop ended the previous task. The next task
                // clears it here, with no human gate, once cleanup is proven:
                // keys and buttons released, prior workers gone. An
                // unconfirmed Stop or an unreadable marker is never cleared.
                bool cleared=false;string why=null;
                if(state!="stopped") {cleared=state=="idle";if(!cleared)why="not_stopped";}
                else if(rearmLocked)why="recovered_cleanup_unverified";
                else {
                    long epoch=Interlocked.Read(ref stopEpoch);
                    try {ControlFence.Recover();}catch {}
                    if(InputLedger.HasHeld()||!WorkersExited(2000))why="input_cleanup_unverified";
                    else if(String.IsNullOrEmpty(StopLatch))why="stop_persistence_failed";
                    else if(ControlFence.LatchEntryBlocks(StopLatch+".unconfirmed"))why="guardian_stop_unconfirmed";
                    else {
                        try {
                            if(ControlFence.LatchEntryBlocks(StopLatch)) {
                                string marker=AtomicFile.ReadAllText(StopLatch);
                                if(marker.StartsWith("unconfirmed:",StringComparison.Ordinal))why="guardian_stop_unconfirmed";
                                else if(marker!="stopped")why="stop_persistence_failed";
                                else File.Delete(StopLatch);
                            }
                        } catch {why="stop_persistence_failed";}
                        if(why==null) {
                            if(Interlocked.Read(ref stopEpoch)!=epoch) {ControlFence.LatchStop();why="stopped_again";}
                            else {SetState("idle","stop_cleared",true,epoch);cleared=state=="idle";if(!cleared)why="stopped_again";}
                        }
                    }
                }
                Emit(new {id=id,cleared=cleared,state=state,reason=why,workers_stopped=cleared,input_cleanup_confirmed=cleared});return;
            }
            if (op == "stop") {
                Emergency();
                string nonce=m.ContainsKey("stop_nonce")?Convert.ToString(m["stop_nonce"]):null;
                if(NativeStopReceipt.ValidNonce(nonce)){
                    bool exited=WorkersExited(2000),clean=false;
                    try{clean=exited&&!InputLedger.HasHeld()&&AtomicFile.ReadAllText(ControlFence.FileName).StartsWith("stopped|",StringComparison.Ordinal)&&ControlFence.LatchBlocks(StopLatch);}catch{}
                    Emit(new {id=id,state="stopped",stop_nonce=nonce,guardian_pid=Process.GetCurrentProcess().Id,guard_file=Path.GetFileName(ControlFence.FileName),workers_stopped=exited,input_cleanup_confirmed=clean});
                }
                return;
            }
            if (op == "shutdown") { normalClose=state=="idle";Close();return; }
            if (op == "end") {
                ClearGrants(); SetState(state=="stopped"||state=="paused"?state:"idle");DismissControls();
                string nonce=m.ContainsKey("end_nonce")?Convert.ToString(m["end_nonce"]):null;
                if(NativeStopReceipt.ValidNonce(nonce)){
                    bool exited=WorkersExited(2000),clean=false;
                    try{clean=exited&&!InputLedger.HasHeld()&&AtomicFile.ReadAllText(ControlFence.FileName).StartsWith(state+"|",StringComparison.Ordinal)&&state!="active"&&!BarShown;}catch{}
                    if(!clean){Emergency();DismissControls();}
                    Emit(new {id=id,state=state,end_nonce=nonce,guardian_pid=Process.GetCurrentProcess().Id,guard_file=Path.GetFileName(ControlFence.FileName),workers_stopped=exited,input_cleanup_confirmed=clean,controls_visible=BarShown});
                }else Emit(new {id=id,state=state,controls_visible=BarShown});
                return;
            }
            if (op == "capture") {
                captureHidden=true;
                if(!captureExcluded || !Overlay.CaptureExcluded) { Overlay.HideImmediate(); CloseMenu(true); HideNow(); }
                Emit(new {id=id,allowed=true}); return;
            }
            if (op == "capture_end") { captureHidden=false;captureReturn=true;SyncVisibility();captureReturn=false;return; }
            if (op == "activate") {
                bool accepted=false;
                if (!rearmLocked && state != "stopped" && state != "paused" && !InputLedger.HasHeld()) {
                    string nextToken=Convert.ToString(m["token"]);long requested=Convert.ToInt64(m["deadline"]);
                    ulong nextBoot=NativeDeadline.Create(requested,DateTime.UtcNow.Ticks,NativeDeadline.GetTickCount64(),ControlContract.Number("session_ms",600000));
                    if(!String.IsNullOrEmpty(nextToken)&&nextBoot>0){token=nextToken;deadline=requested;bootDeadline=nextBoot;SetState("active");accepted=state=="active";}
                }
                Emit(new { id=id, allowed=accepted, state=state }); return;
            }
            if (op != "prompt") return;
            if (state == "stopped" || state == "paused") { Emit(new { id=id, allowed=false, state=state }); return; }
            // An operator-selected host-managed deployment trusts the host's
            // execution review (direct skill commands or the legacy adapter).
            // No authenticated Turbo/preset token is inferred from transport.
            // This is immutable startup configuration, never a tool argument.
            string kind=Convert.ToString(m["kind"]);
            string handle=m.ContainsKey("session_handle")?Convert.ToString(m["session_handle"]):null;
            if(handle!=null&&(handle.Length==0||handle.Length>64))handle=null;
            string executable=null;
            if(kind=="app")try {executable=Convert.ToString(ControlFence.Identity(Convert.ToInt64(m["hwnd"]))["path"]).ToLowerInvariant();}catch {}
            // Already approved in this conversation: restored without a prompt.
            bool known=kind=="app"&&handle!=null&&executable!=null&&m.ContainsKey("remembered")&&Convert.ToBoolean(m["remembered"])
                &&Approvals().Allows(handle,executable,m.ContainsKey("tier")?Convert.ToString(m["tier"]):"full",ApprovalMemory.Now());
            bool allowed=hostManaged||known; bool timedOut=false;
            if(!allowed) {
            prompting=true; Overlay.HideAll();
            // An app request that carries card:1 is shown as a row: the name
            // and path come from this process's own look at the window, and the
            // tag from the same tier that is granted below. Anything else,
            // or a tier with no row, keeps the text card.
            DesktopVisuals.PromptApp row=null;string heading=null,request=Convert.ToString(m["message"]);
            if(kind=="app"&&executable!=null&&m.ContainsKey("card")&&Convert.ToString(m["card"])=="1") {
                try {
                    Dictionary<string,object> seen=ControlFence.Identity(Convert.ToInt64(m["hwnd"]));string file=Convert.ToString(seen["path"]);
                    row=DesktopVisuals.PromptApp.For(m.ContainsKey("tier")?Convert.ToString(m["tier"]):"full",AppName(file),handle!=null);
                    if(row!=null) {
                        heading="Allow "+(hostName.Length>0?hostName:"the agent")+" to use this app?";
                        request=file+"\r\nPID "+Convert.ToString(seen["pid"])+PromptLine(m,"task","\r\n\r\nTask: ")+PromptLine(m,"notice","\r\n\r\n");
                    }
                } catch {row=null;heading=null;request=Convert.ToString(m["message"]);}
            }
            using (Form dialog = new AccessPrompt(request,visualScale,SystemInformation.HighContrast,BarShown?Bounds:Rectangle.Empty,row,heading)) {
                activePrompt=dialog;
                dialog.Text="Computer Use — local permission"; dialog.TopMost=true;
                System.Windows.Forms.Timer expiry=new System.Windows.Forms.Timer(); expiry.Interval=90000;
                expiry.Tick += delegate { timedOut=true; dialog.DialogResult=DialogResult.No; dialog.Close(); }; expiry.Start();
                dialog.Shown += delegate { Mark(dialog); };
                allowed = dialog.ShowDialog(this) == DialogResult.Yes;
                expiry.Dispose();
                activePrompt=null;
            }
            prompting=false; takeover.Reset(Presence.Capture());
            }
            if (state == "stopped") allowed=false;
            string permit=null;
            if(allowed && kind=="app") {
                string appKey=Convert.ToString(ControlFence.Identity(Convert.ToInt64(m["hwnd"]))["key"]);
                grants.Add(appKey);
                if(m.ContainsKey("tier")&&Convert.ToString(m["tier"])=="click")clickGrants.Add(appKey);else clickGrants.Remove(appKey);
                // Only a person's own Allow is kept (a remembered one counts as
                // use). A host-managed deployment never showed a prompt, so
                // nothing it authorises is recorded as human-approved.
                if(!hostManaged&&handle!=null&&executable!=null) {
                    // The tier as it was asked for: one this record has no rule for is not kept.
                    if(Approvals().Remember(handle,executable,m.ContainsKey("tier")?Convert.ToString(m["tier"]):"full",ApprovalMemory.Now()))Approvals().Save(ApprovalFile);
                }
                WriteState();
            }
            if(allowed && kind=="action") {
                permit=Guid.NewGuid().ToString("N");
                Dictionary<string,object> a=m["args"] as Dictionary<string,object>;
                string appKey=a.ContainsKey("hwnd")?Convert.ToString(ControlFence.Identity(Convert.ToInt64(a["hwnd"]))["key"]):"";
                Directory.CreateDirectory(ControlFence.FileName+".permits");
                File.WriteAllLines(Path.Combine(ControlFence.FileName+".permits",permit),new string[] { token,
                    FingerprintFor(m,a),appKey,DateTime.UtcNow.AddSeconds(90).Ticks.ToString() });
            }
            int host;
            if (allowed && m.ContainsKey("host_pid") && Int32.TryParse(Convert.ToString(m["host_pid"]),out host)) AllowSetForegroundWindow(host);
            Emit(new { id=id, allowed=allowed, state=state, permit=permit, decision=allowed?(hostManaged?"host-authorized":known?"remembered":"allowed"):(state=="stopped"?"stopped":(timedOut?"timeout":"denied")) });
        }
        // The app's own description of itself, or its file name. Never blank.
        static string AppName(string file) {
            string name="";
            try {name=(FileVersionInfo.GetVersionInfo(file).FileDescription??"").Trim();} catch {}
            if(name.Length==0||name.Length>48)try {name=Path.GetFileNameWithoutExtension(file);} catch {}
            if(String.IsNullOrEmpty(name))name=Path.GetFileName(file);
            return name;
        }
        // One optional text field of a prompt request, bounded, behind its lead.
        static string PromptLine(Dictionary<string,object> m,string field,string lead) {
            if(!m.ContainsKey(field)||m[field]==null)return "";
            string text=Convert.ToString(m[field]).Trim();
            if(text.Length==0)return "";
            if(text.Length>2000)text=text.Substring(0,2000)+"…";
            return lead+text.Replace("\r\n","\n").Replace("\n","\r\n");
        }
        string FingerprintFor(Dictionary<string,object> m, Dictionary<string,object> a) {
            return ControlFence.Fingerprint(Convert.ToString(m["action_op"]),a,Convert.ToString(m["label"]));
        }
        protected override void WndProc(ref Message m) {
            if (m.Msg==0x0312) Emergency("hotkey");
            base.WndProc(ref m);
        }
        protected override void OnClosed(EventArgs e) {
            if (registered) UnregisterHotKey(Handle,1);
            LiquidGlassPackageClient.Close();motion.Dispose();
            CursorSafety.Close();Presence.Stop(); Overlay.Stop(); InputLease.Release(); base.OnClosed(e);
        }
    }
}
