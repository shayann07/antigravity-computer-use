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
                if(ControlContract.Pattern("sensitive_key_pattern","enter|return|delete|alt\\+|win|meta|super|ctrl\\+[svx]",key)) return true;
            }
            if(a.ContainsKey("hwnd")) {
                string name=Path.GetFileNameWithoutExtension(Convert.ToString(ControlFence.Identity(Convert.ToInt64(a["hwnd"]))["path"])).ToLowerInvariant();
                System.Text.StringBuilder cls=new System.Text.StringBuilder(256); Native.GetClassName(new IntPtr(Convert.ToInt64(a["hwnd"])),cls,cls.Capacity);
                bool console=cls.ToString().Contains("Console")||cls.ToString().Contains("CASCADIA")||cls.ToString().Contains("mintty");
                if((console||ControlContract.Pattern("sensitive_process_pattern","^(windowsterminal|regedit|systemsettings|control|code|idea64|rider64)$",name)) && op!="focus") return true;
            }
            if(ControlContract.Pattern("sensitive_label_pattern","send|submit|pay|purchase|buy|delete|remove|install|upload|share|password|permission|transfer|sign.in",label)) return true;
            return false;
        }
        internal static string FileName { get { return Environment.GetEnvironmentVariable("AGCU_GUARD_FILE"); } }
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
            if(!String.IsNullOrEmpty(latch)&&File.Exists(latch))throw new AxonError("control_stopped","Emergency Stop remains latched. Local human re-arm is required.",null);
            string[] state;string original;
            try { original=File.ReadAllText(FileName);state = original.Split('|'); }
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
                if(!GuardUnchanged(original,File.ReadAllText(FileName),!String.IsNullOrEmpty(latch)&&File.Exists(latch)))
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
            string[] state=File.ReadAllText(FileName).Split('|');
            string appKey="";
            if(a.ContainsKey("hwnd")) {
                Dictionary<string,object> identity=Identity(Convert.ToInt64(a["hwnd"]));
                appKey=Convert.ToString(identity["key"]);
                string grants=state.Length>3?Encoding.UTF8.GetString(Convert.FromBase64String(state[3])):"";
                if(!new List<string>(grants.Split('\n')).Contains(appKey))
                    throw new AxonError("app_not_approved","This application instance has no native human grant.",null);
            }
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
                try { approval=File.ReadAllLines(f); File.Delete(f); }
                catch { throw new AxonError("confirmation_required","Approval missing, expired or consumed.",null); }
                long until;
                if(approval.Length!=4 || approval[0]!=Token || approval[1]!=Fingerprint(op,a,label) || approval[2]!=appKey ||
                    !Int64.TryParse(approval[3],out until) || DateTime.UtcNow.Ticks>=until)
                    throw new AxonError("approval_changed","Approved target/action changed; observe again.",null);
            }
        }
        internal static void LatchStop() {
            string file=Environment.GetEnvironmentVariable("AGCU_STOP_LATCH");
            if(!String.IsNullOrEmpty(file))try {File.WriteAllText(file,"stopped");}catch {}
        }
        internal static void WatchParent() {
            int pid;
            if (!Int32.TryParse(Environment.GetEnvironmentVariable("AGCU_PARENT_PID"), out pid)) return;
            Thread t = new Thread(delegate() {
                try { using (Process p = Process.GetProcessById(pid)) p.WaitForExit(); } catch { }
                bool wasIdle=false;try {wasIdle=File.ReadAllText(FileName).StartsWith("idle|");}catch {}
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

    internal sealed class Guardian : Form {
        [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr h,int how);
        [DllImport("user32.dll")] static extern bool RegisterHotKey(IntPtr h, int id, uint modifiers, uint vk);
        [DllImport("user32.dll")] static extern bool UnregisterHotKey(IntPtr h, int id);
        [DllImport("user32.dll")] static extern bool AllowSetForegroundWindow(int pid);
        [DllImport("user32.dll")] static extern bool SetWindowDisplayAffinity(IntPtr h, uint affinity);
        [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern bool SetPropW(IntPtr h, string key, IntPtr value);
        readonly JavaScriptSerializer js = new JavaScriptSerializer();
        readonly ToolTip tips = new ToolTip();
        HudButton toggle, stopButton, modeButton;
        readonly ContextMenuStrip modeMenu=new ContextMenuStrip();
        readonly TakeoverPolicy takeover=new TakeoverPolicy(Environment.GetEnvironmentVariable("AGCU_TAKEOVER_MODE"));
        float visualScale=1, phase;
        int visualTick;
        string activity="";DateTime activityAt;
        readonly System.Windows.Forms.Timer timer = new System.Windows.Forms.Timer();
        volatile string state = "idle"; string token = "";
        readonly object stateLock=new object();
        readonly HashSet<string> grants = new HashSet<string>();
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
            SetStyle(ControlStyles.UserPaint|ControlStyles.AllPaintingInWmPaint|ControlStyles.OptimizedDoubleBuffer,true);
            BackColor=Color.FromArgb(22,23,35);
            visualScale=Overlay.ScreenScale(Screen.FromPoint(Cursor.Position));
            ClientSize = new Size((int)(DesktopVisuals.HudWidth*visualScale),(int)(DesktopVisuals.HudHeight*visualScale));
            Rectangle monitor=Screen.FromPoint(Cursor.Position).WorkingArea;
            Location=new Point(monitor.Left+(monitor.Width-Width)/2,monitor.Top+(int)(18*visualScale));
            using(GraphicsPath rounded=Overlay.RoundRect(new RectangleF(0,0,Width,Height),21*visualScale))Region=new Region(rounded);
            toggle=ButtonAt(1,DesktopVisuals.ToggleRect); toggle.Click += delegate {
                if(state=="active")SetState("paused");
                else {
                    long humanEpoch=Interlocked.Read(ref stopEpoch);
                    try {ControlFence.Recover();}catch {}
                    if(InputLedger.HasHeld()){Emit(new {ev="visual_warning",message="Held-input cleanup is incomplete; control stays paused/stopped"});return;}
                    deadline=DateTime.UtcNow.AddMinutes(10).Ticks;bootDeadline=NativeDeadline.Create(deadline,DateTime.UtcNow.Ticks,NativeDeadline.GetTickCount64(),ControlContract.Number("session_ms",600000));
                    if(bootDeadline==0){Emit(new {ev="error",message="Cannot establish the native session deadline; control stays paused/stopped"});return;}
                    if(Interlocked.Read(ref stopEpoch)!=humanEpoch)return;
                    if(state=="stopped"&&!String.IsNullOrEmpty(StopLatch)) {
                        try { if(File.ReadAllText(StopLatch).StartsWith("unconfirmed:",StringComparison.Ordinal)) { Emit(new {ev="visual_warning",message="Stop delivery is unconfirmed; inspect prior input cleanup before re-arm"}); return; } }
                        catch { Emit(new {ev="error",message="Cannot inspect the emergency latch; control stays stopped"}); return; }
                        try {File.Delete(StopLatch);}catch {Emit(new {ev="error",message="Cannot clear the emergency latch; control stays stopped"});return;}
                    }
                    if(Interlocked.Read(ref stopEpoch)!=humanEpoch){ControlFence.LatchStop();return;}
                    SetState(state=="stopped"||state=="idle"?"idle":"active",null,true,humanEpoch);if(state!="stopped")Emit(new {ev="human_resume",state=state});
                }
            };
            stopButton=ButtonAt(2,DesktopVisuals.StopRect); stopButton.Click += delegate {
                if(state=="stopped")DismissControls();else Emergency("button");
            };
            modeButton=ButtonAt(3,DesktopVisuals.ModeRect);modeButton.Click+=delegate {OpenModeMenu();};
            LoadTakeoverMode();
            tips.SetToolTip(stopButton,"Stop immediately · Esc or Ctrl+Alt+F12");
            tips.SetToolTip(toggle,"Pause, resume, or re-arm control. Resuming requires a fresh observation.");
            FormClosing += delegate(object sender, FormClosingEventArgs e) { if(!normalClose&&state!="idle")SetState("stopped",null,false);DismissControls(); };
            LiquidGlassPackageClient.SurfaceReady += PackageSurfaceReady;
            timer.Interval = 70; timer.Tick += Tick; timer.Start();
        }
        // Initialize the message handle/hooks without ever showing a window.
        // Application.Run(Form) asks to show its MainForm; SetVisibleCore keeps
        // that implicit startup request hidden until a task explicitly needs it.
        bool Initialize() {
                Mark(this); ApplyRecordingPreference();
                registered = RegisterHotKey(Handle, 1, 0x4003, 0x7B);
                if (!registered) { Emit(new { ev="error", message="Ctrl+Alt+F12 is unavailable; refusing control" }); return false; }
                Presence.Start();
                Presence.OnPanic = delegate { if(state=="active"||state=="paused"||prompting)Emergency("escape"); };
                if (!Presence.HooksOk) { Emit(new { ev="error", message="Physical-input monitoring unavailable" }); UnregisterHotKey(Handle,1);Presence.Stop();return false; }
                Overlay.Configure(1, "Antigravity", 0); Overlay.Start(true);
                Overlay.RecordVisuals(recordVisuals);
                SetState(!String.IsNullOrEmpty(StopLatch)&&File.Exists(StopLatch)?"stopped":"idle");
                DismissControls();
                initialized=true;
                Emit(new {ev="settings",takeover_mode=takeover.Mode,record_visuals=recordVisuals});
                Emit(new { ev="ready", pid=Process.GetCurrentProcess().Id, hotkey=true, presence=true,desktop_context=DesktopContext.Inspect() });
                Thread reader = new Thread(Read); reader.IsBackground = true; reader.Start();
                return true;
        }
        protected override void SetVisibleCore(bool value) {base.SetVisibleCore(value && initialized && controlsRequested && !captureHidden);}
        void SyncVisibility() {if(controlsRequested&&!captureHidden){if(!Visible)Show();}else if(Visible)Hide();}
        void ShowControls(int milliseconds) {Interlocked.Increment(ref visibilityEpoch);controlsRequested=true;controlsUntil=milliseconds>0?DateTime.UtcNow.AddMilliseconds(milliseconds):DateTime.MaxValue;SyncVisibility();}
        void DismissControls() {Interlocked.Increment(ref visibilityEpoch);controlsRequested=false;SyncVisibility();}
        protected override bool ShowWithoutActivation { get { return true; } }
        protected override CreateParams CreateParams { get { CreateParams p=base.CreateParams;p.ExStyle|=0x08000080;return p; } }
        protected override void OnPaint(PaintEventArgs e) {
            e.Graphics.ScaleTransform(visualScale,visualScale);DesktopVisuals.Hud(e.Graphics,state,0,phase,activity);
        }
        HudButton ButtonAt(int index,Rectangle rect) {
            HudButton b=new HudButton(this,index,rect);
            b.SetBounds((int)(rect.X*visualScale),(int)(rect.Y*visualScale),(int)(rect.Width*visualScale),(int)(rect.Height*visualScale));
            Controls.Add(b);return b;
        }
        sealed class HudButton : Button {
            readonly Guardian owner;readonly int index;readonly Rectangle logical;bool hover;
            internal HudButton(Guardian o,int i,Rectangle r) {owner=o;index=i;logical=r;FlatStyle=FlatStyle.Flat;FlatAppearance.BorderSize=0;TabStop=false;Cursor=Cursors.Hand;}
            protected override void OnPaint(PaintEventArgs e) {
                e.Graphics.ScaleTransform(owner.visualScale,owner.visualScale);
                e.Graphics.TranslateTransform(-logical.X,-logical.Y);
                DesktopVisuals.Hud(e.Graphics,owner.state,hover?index:0,owner.phase,owner.activity);
            }
            protected override void OnMouseEnter(EventArgs e) {hover=true;Invalidate();base.OnMouseEnter(e);}
            protected override void OnMouseLeave(EventArgs e) {hover=false;Invalidate();base.OnMouseLeave(e);}
        }
        void RefreshHud() {
            toggle.AccessibleName=state=="active"?"Pause computer use":state=="paused"?"Resume computer use":"Re-arm computer use";
            stopButton.AccessibleName=state=="stopped"?"Dismiss stopped computer use controls":"Stop computer use immediately";
            tips.SetToolTip(stopButton,state=="stopped"?"Dismiss controls. Emergency Stop stays latched.":"Stop immediately · Esc or Ctrl+Alt+F12");
            modeButton.AccessibleName="Control settings. Takeover mode: "+takeover.Mode;
            tips.SetToolTip(modeButton,takeover.Mode=="manual"?"Manual pause: mouse and keyboard do not interrupt. Click for control settings.":"Smart takeover: ignores jitter; deliberate input pauses. Click for control settings.");
            AccessibleName="Antigravity computer use: "+state;
            Invalidate();toggle.Invalidate();stopButton.Invalidate();modeButton.Invalidate();
        }
        void PackageSurfaceReady() {
            try { if(!IsDisposed && IsHandleCreated) BeginInvoke((MethodInvoker)delegate { if(!IsDisposed) RefreshHud(); }); } catch { }
        }
        string PreferenceFile {get {return Path.Combine(Path.GetDirectoryName(ControlFence.FileName),"control-preferences.json");}}
        void LoadTakeoverMode() {
            try {var prefs=js.DeserializeObject(File.ReadAllText(PreferenceFile)) as Dictionary<string,object>;
                string mode=Convert.ToString(prefs["takeover_mode"]);if(mode=="manual"||mode=="smart")takeover.SetMode(mode,Presence.Capture());
                recordVisuals=prefs.ContainsKey("record_visuals")&&Convert.ToBoolean(prefs["record_visuals"]);
            }catch {}
        }
        void SavePreferences() {
            try {string file=PreferenceFile,temp=file+".tmp";File.WriteAllText(temp,js.Serialize(new {takeover_mode=takeover.Mode,record_visuals=recordVisuals}));if(File.Exists(file))File.Replace(temp,file,null);else File.Move(temp,file);}catch {Emit(new {ev="visual_warning",message="Could not save control preference"});}
        }
        void ApplyRecordingPreference() {
            // Unlike the recording chrome, permission dialogs always remain excluded.
            captureExcluded=!recordVisuals&&SetWindowDisplayAffinity(Handle,0x11);
            if(recordVisuals)SetWindowDisplayAffinity(Handle,0);
        }
        void ChangeRecordingPreference() {
            recordVisuals=!recordVisuals;ApplyRecordingPreference();Overlay.RecordVisuals(recordVisuals);SavePreferences();
            Emit(new {ev="settings",takeover_mode=takeover.Mode,record_visuals=recordVisuals});
        }
        void ChangeTakeoverMode(string mode) {
            takeover.SetMode(mode,Presence.Capture());
            SavePreferences();
            RefreshHud();Emit(new {ev="settings",takeover_mode=takeover.Mode});
        }
        void OpenModeMenu() {
            modeMenu.Items.Clear();modeMenu.BackColor=Color.FromArgb(32,35,40);modeMenu.ForeColor=Color.FromArgb(234,237,239);
            modeMenu.ShowImageMargin=true;modeMenu.ShowCheckMargin=false;modeMenu.Font=new Font(Overlay.UiFont,10);modeMenu.Padding=new Padding(6);
            modeMenu.Renderer=new ToolStripProfessionalRenderer(new ControlMenuColors());
            ToolStripMenuItem manual=new ToolStripMenuItem("Keep working — Pause or Esc to interrupt");manual.Checked=takeover.Mode=="manual";manual.Click+=delegate {ChangeTakeoverMode("manual");};
            ToolStripMenuItem smart=new ToolStripMenuItem("Yield on input — deliberate input pauses");smart.Checked=takeover.Mode=="smart";smart.Click+=delegate {ChangeTakeoverMode("smart");};
            modeMenu.Items.Add(manual);modeMenu.Items.Add(smart);modeMenu.Items.Add(new ToolStripSeparator());
            ToolStripMenuItem recording=new ToolStripMenuItem("Show glow and controls in screen recordings");recording.Checked=recordVisuals;recording.Click+=delegate {ChangeRecordingPreference();};modeMenu.Items.Add(recording);
            ToolStripMenuItem hint=new ToolStripMenuItem("Esc always stops immediately");hint.Enabled=false;modeMenu.Items.Add(hint);
            ToolStripMenuItem dismiss=new ToolStripMenuItem("Dismiss controls and keep stopped");dismiss.Click+=delegate {if(state!="stopped")Emergency("dismiss");DismissControls();};modeMenu.Items.Add(dismiss);
            modeMenu.Show(modeButton,new Point(0,modeButton.Height));
            SetPropW(modeMenu.Handle,"ComputerUseOverlayWindow",new IntPtr(1));SetWindowDisplayAffinity(modeMenu.Handle,0x11);
        }
        sealed class ControlMenuColors:ProfessionalColorTable {
            public override Color ToolStripDropDownBackground {get{return Color.FromArgb(32,35,40);}}
            public override Color ImageMarginGradientBegin {get{return ToolStripDropDownBackground;}}
            public override Color ImageMarginGradientMiddle {get{return ToolStripDropDownBackground;}}
            public override Color ImageMarginGradientEnd {get{return ToolStripDropDownBackground;}}
            public override Color MenuItemSelected {get{return Color.FromArgb(55,67,77);}}
            public override Color MenuItemBorder {get{return Color.FromArgb(75,90,103);}}
            public override Color MenuBorder {get{return Color.FromArgb(63,70,77);}}
            public override Color CheckBackground {get{return MenuItemSelected;}}
            public override Color CheckSelectedBackground {get{return MenuItemSelected;}}
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
                state=ResolveGuardState(state,capturedStop,Interlocked.Read(ref stopEpoch),!String.IsNullOrEmpty(StopLatch)&&File.Exists(StopLatch));
                if(state=="stopped")grants.Clear();
            }
            string f = ControlFence.FileName;
            if (String.IsNullOrEmpty(f)) return;
            string temp = f + ".tmp";
            File.WriteAllText(temp, state+"|"+token+"|"+deadline.ToString()+"|"+Convert.ToBase64String(Encoding.UTF8.GetBytes(String.Join("\n",grants)))+"|"+bootDeadline.ToString());
            if (File.Exists(f)) File.Replace(temp, f, null); else File.Move(temp,f);
        } }
        void SetState(string next,string reason=null,bool updateVisibility=true,long humanRearmEpoch=-1) {
            long capturedStop=humanRearmEpoch>=0?humanRearmEpoch:Interlocked.Read(ref stopEpoch);
            if (state == "stopped" && next != "stopped" && humanRearmEpoch<0) return;
            if(next=="stopped")ControlFence.LatchStop();
            state = next; if(state=="stopped")grants.Clear(); takeover.Reset(Presence.Capture());
            try { WriteState(capturedStop); }
            catch {
                // A failed state transition must never skip cleanup or leave a
                // newly active session usable on an older native fence.
                state="stopped";grants.Clear();ControlFence.LatchStop();
                GuardCleanup.Run(StopWorkers,ControlFence.Recover,Overlay.HideAll,CursorSafety.Restore);
                try { RefreshHud(); } catch { }
                Emit(new {ev="state",state="stopped",reason="guard_persistence_failed",custom_cursor=CursorSafety.Applied});return;
            }
            RefreshHud();
            if (state != "active") {
                // Missing or failed ledgers must not interrupt the remaining
                // cleanup or leave the guardian claiming an idle/paused state.
                GuardCleanup.Run(StopWorkers,ControlFence.Recover,Overlay.HideAll,CursorSafety.Restore);
                if(InputLedger.HasHeld()) {
                    state="stopped";grants.Clear();ControlFence.LatchStop();reason="input_cleanup_failed";
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
                else if(state=="stopped")ShowControls(8000);
                else DismissControls();
            }
            Emit(new { ev="state", state=state, reason=reason, custom_cursor=CursorSafety.Applied });
        }
        void Emergency(string reason="request") {
            // Hook thread invalidates the native fence BEFORE waiting for the UI thread.
            Interlocked.Increment(ref stopEpoch);
            state="stopped"; ControlFence.LatchStop(); try { WriteState(); } catch { }
            GuardCleanup.Run(StopWorkers,ControlFence.Recover); Emit(new { ev="state", state="stopped", reason=reason });
            long emergencyEpoch=Interlocked.Increment(ref visibilityEpoch);
            MethodInvoker cleanup=delegate { if(activePrompt!=null) activePrompt.Close(); grants.Clear(); SetState("stopped",null,Interlocked.Read(ref visibilityEpoch)==emergencyEpoch); };
            try {if(InvokeRequired)BeginInvoke(cleanup);else cleanup();} catch { }
        }
        void StopWorkers() {
            lock(workerLock) { foreach(Process p in workers) try { if(!p.HasExited)p.Kill(); } catch { } workers.Clear(); }
        }
        void WriteWorkers() {
            List<string> live=new List<string>();
            foreach(Process p in workers)try {if(!p.HasExited)live.Add(p.Id+":"+p.StartTime.ToUniversalTime().Ticks);}catch {}
            string file=ControlFence.FileName+".workers",temp=file+".tmp";File.WriteAllLines(temp,live);
            if(File.Exists(file))File.Replace(temp,file,null);else File.Move(temp,file);
        }
        void Tick(object sender, EventArgs e) {
            if(controlsRequested && DateTime.UtcNow>=controlsUntil)DismissControls();
            if((state=="active"||state=="paused"||prompting)&&!(bool)DesktopContext.Inspect()["interactive"]) {Emergency("input_desktop_changed");DismissControls();return;}
            if (prompting || captureHidden) return;
            if(activity!="" && (DateTime.UtcNow-activityAt).TotalMilliseconds>1200) {activity="";RefreshHud();}
            if(++visualTick%3==0 && state=="active" && DesktopVisuals.MotionEnabled) {phase+=.14f;Invalidate();}
            if (state == "active") {
                if(!CursorSafety.CheckWatchdog()){Emergency("cursor_watchdog_failed");return;}
                if (DateTime.UtcNow.Ticks >= deadline || !NativeDeadline.Valid(bootDeadline,NativeDeadline.GetTickCount64())) { SetState("idle"); return; }
                if(!modeMenu.Visible && takeover.ShouldPause(Presence.Capture(),TakeoverPolicy.NowMs,visualScale)) {SetState("paused","human_takeover");return;}
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
            if(op=="visual_status") {Emit(new {id=id,state=state,controls_visible=Visible,cursor=CursorSafety.Applied,watchdog_pid=CursorSafety.WatchdogPid,glow_opacity=Overlay.GlowOpacity,takeover_mode=takeover.Mode,record_visuals=recordVisuals});return;}
            if(op=="show_controls") {
                var context=DesktopContext.Inspect();
                if(!(bool)context["interactive"]) {DismissControls();Emit(new {id=id,state=state,controls_visible=false,desktop_context=context,error=new {code="desktop_context_unavailable",message="Controls cannot be shown on the visible input desktop. Use the installed local launcher; no desktop was switched."}});return;}
                ShowControls(state=="stopped"||state=="idle"?30000:0);Emit(new {id=id,state=state,controls_visible=Visible,desktop_context=context,human_rearm_required=state=="stopped"});return;
            }
            if(op=="dismiss_controls") {if(state=="active"||state=="paused")Emergency("dismiss");DismissControls();Emit(new {id=id,state=state,controls_visible=Visible});return;}
            if(op=="activity" && state=="active") {
                string action=Convert.ToString(m["action"]);
                switch(action) {case "move":activity="Moving";break;case "click":activity="Clicking";break;case "drag":activity="Dragging";break;case "scroll":activity="Scrolling";break;case "type":case "set_value":case "key":activity="Typing";break;default:activity="Checking";break;}
                activityAt=DateTime.UtcNow;RefreshHud();
                if(m.ContainsKey("click_feedback")&&Convert.ToBoolean(m["click_feedback"]))Overlay.ClickFeedback();
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
            if (op == "resume") {
                // Soft takeover only. The host permission policy must authorize
                // a chat-directed Resume. Emergency Stop remains human-only.
                try {ControlFence.Recover();}catch {}
                bool resumeAllowed=hostManaged && state=="paused" && !InputLedger.HasHeld();
                if(resumeAllowed) {deadline=DateTime.UtcNow.AddMinutes(10).Ticks;bootDeadline=NativeDeadline.Create(deadline,DateTime.UtcNow.Ticks,NativeDeadline.GetTickCount64(),ControlContract.Number("session_ms",600000));if(bootDeadline==0)resumeAllowed=false;else {SetState("active","host_authorized_resume");resumeAllowed=state=="active";if(resumeAllowed)Emit(new {ev="host_resume",state=state});}}
                Emit(new {id=id,allowed=resumeAllowed,state=state});return;
            }
            if (op == "pause") { SetState("paused","requested_pause"); return; }
            if (op == "stop") { Emergency(); return; }
            if (op == "shutdown") { normalClose=state=="idle";Close();return; }
            if (op == "end") { grants.Clear(); SetState(state=="stopped"||state=="paused"?state:"idle");DismissControls();Emit(new {id=id,state=state,controls_visible=Visible});return; }
            if (op == "capture") {
                captureHidden=true;
                if(!captureExcluded || !Overlay.CaptureExcluded) { Overlay.HideImmediate(); Hide(); }
                Emit(new {id=id,allowed=true}); return;
            }
            if (op == "capture_end") { captureHidden=false;SyncVisibility();return; }
            if (op == "activate") {
                bool accepted=false;
                if (state != "stopped" && state != "paused" && !InputLedger.HasHeld()) {
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
            bool allowed=hostManaged; bool timedOut=false;
            if(!hostManaged) {
            prompting=true; Overlay.HideAll();
            using (Form dialog = new Form()) {
                activePrompt=dialog;
                dialog.Text="Computer Use — local permission"; dialog.TopMost=true;
                dialog.ClientSize=new Size(700,440); dialog.StartPosition=FormStartPosition.CenterScreen;
                TextBox body=new TextBox(); body.Multiline=true; body.ReadOnly=true; body.ScrollBars=ScrollBars.Vertical;
                body.Font=new Font("Segoe UI",11); body.SetBounds(16,16,668,350);
                body.Text=Convert.ToString(m["message"]); dialog.Controls.Add(body);
                Button yes=new Button(); yes.Text="Allow"; yes.SetBounds(16,385,120,32); yes.DialogResult=DialogResult.Yes; dialog.Controls.Add(yes);
                Button no=new Button(); no.Text="Deny"; no.SetBounds(152,385,120,32); no.DialogResult=DialogResult.No; dialog.Controls.Add(no);
                dialog.CancelButton=no; dialog.AcceptButton=no;
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
            if(allowed && Convert.ToString(m["kind"])=="app") {
                grants.Add(Convert.ToString(ControlFence.Identity(Convert.ToInt64(m["hwnd"]))["key"])); WriteState();
            }
            if(allowed && Convert.ToString(m["kind"])=="action") {
                permit=Guid.NewGuid().ToString("N");
                Dictionary<string,object> a=m["args"] as Dictionary<string,object>;
                string appKey=a.ContainsKey("hwnd")?Convert.ToString(ControlFence.Identity(Convert.ToInt64(a["hwnd"]))["key"]):"";
                Directory.CreateDirectory(ControlFence.FileName+".permits");
                File.WriteAllLines(Path.Combine(ControlFence.FileName+".permits",permit),new string[] { token,
                    FingerprintFor(m,a),appKey,DateTime.UtcNow.AddSeconds(90).Ticks.ToString() });
            }
            int host;
            if (allowed && m.ContainsKey("host_pid") && Int32.TryParse(Convert.ToString(m["host_pid"]),out host)) AllowSetForegroundWindow(host);
            Emit(new { id=id, allowed=allowed, state=state, permit=permit, decision=allowed?(hostManaged?"host-authorized":"allowed"):(state=="stopped"?"stopped":(timedOut?"timeout":"denied")) });
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
            LiquidGlassPackageClient.SurfaceReady -= PackageSurfaceReady;LiquidGlassPackageClient.Close();
            CursorSafety.Close();Presence.Stop(); Overlay.Stop(); base.OnClosed(e);
        }
    }
}
