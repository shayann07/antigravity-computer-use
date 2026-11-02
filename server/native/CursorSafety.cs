// Temporary native system-arrow styling with an independent crash watchdog.
// SetSystemCursor consumes its cursor handle. SPI_SETCURSORS restores the
// configured Windows cursor scheme; no registry or user-profile writes occur.
using System;
using System.IO;
using System.Drawing;
using System.Drawing.Imaging;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;

namespace Axon {
    internal static class CursorSafety {
        [StructLayout(LayoutKind.Sequential)] struct IconInfo {
            [MarshalAs(UnmanagedType.Bool)] internal bool icon;
            internal uint x,y;internal IntPtr mask,color;
        }
        [DllImport("user32.dll",SetLastError=true)] static extern IntPtr CreateIconIndirect(ref IconInfo info);
        [DllImport("user32.dll",SetLastError=true)] static extern bool SetSystemCursor(IntPtr cursor,uint id);
        [DllImport("user32.dll")] static extern bool DestroyCursor(IntPtr cursor);
        [DllImport("user32.dll")] static extern int GetSystemMetrics(int index);
        [DllImport("user32.dll")] static extern IntPtr LoadCursor(IntPtr instance,IntPtr id);
        [DllImport("user32.dll")] static extern bool DrawIconEx(IntPtr dc,int x,int y,IntPtr icon,int w,int h,uint step,IntPtr brush,uint flags);
        [StructLayout(LayoutKind.Sequential)] struct CursorInfo {internal int size,flags;internal IntPtr cursor;internal Native.POINT point;}
        [DllImport("user32.dll")] static extern bool GetCursorInfo(ref CursorInfo info);
        [DllImport("gdi32.dll")] static extern IntPtr CreateBitmap(int w,int h,uint planes,uint bits,IntPtr data);
        [DllImport("gdi32.dll")] static extern bool DeleteObject(IntPtr obj);
        [DllImport("user32.dll")] static extern bool SystemParametersInfo(uint action,uint value,IntPtr data,uint flags);
        static Process watchdog;
        static bool applied,monitoring;
        static readonly object gate=new object();
        internal static bool Applied { get { lock(gate)return applied; } }
        internal static bool ArmReceiptMatches(string receipt,string nonce,int pid) {
            return NativeStopReceipt.ValidNonce(nonce)&&pid>0&&receipt=="armed "+nonce+" "+pid;
        }
        internal static int WatchdogPid {get {lock(gate)return watchdog!=null&&!watchdog.HasExited?watchdog.Id:0;}}
        internal static void WriteWatchdogRecord(string file,int pid,long started) {
            if(String.IsNullOrEmpty(file)||pid<=0||started<=0)throw new ArgumentException("Invalid watchdog identity.");
            string temp=file+"."+Guid.NewGuid().ToString("N")+".tmp";
            try {
                byte[] bytes=System.Text.Encoding.UTF8.GetBytes(pid+"|"+started);
                using(var stream=new FileStream(temp,FileMode.CreateNew,FileAccess.Write,FileShare.None)){stream.Write(bytes,0,bytes.Length);stream.Flush(true);}
                if(File.Exists(file))File.Replace(temp,file,null);else File.Move(temp,file);
            } finally {try{if(File.Exists(temp))File.Delete(temp);}catch{}}
        }
        static bool EnsureWatchdog() {
            if(watchdog!=null && !watchdog.HasExited)return true;
            ProcessStartInfo info=new ProcessStartInfo(Process.GetCurrentProcess().MainModule.FileName,
                "--cursor-watchdog "+Process.GetCurrentProcess().Id+" "+Process.GetCurrentProcess().StartTime.ToUniversalTime().Ticks);
            info.UseShellExecute=false;info.CreateNoWindow=true;info.RedirectStandardInput=true;info.RedirectStandardOutput=true;
            watchdog=Process.Start(info);
            Process startingWatchdog=watchdog;
            Task<string> ready=Task.Factory.StartNew(delegate {return startingWatchdog.StandardOutput.ReadLine();});
            if(!ready.Wait(5000) || ready.Result!="cursor-watchdog-ready") {
                try {watchdog.Kill();}catch {}watchdog=null;return false;
            }
            // Recovery must be able to wait for this process to exit before
            // treating the old input ledger as final. Missing metadata fails closed.
            try { WriteWatchdogRecord(ControlFence.FileName+".watchdog",watchdog.Id,watchdog.StartTime.ToUniversalTime().Ticks); }
            catch { try {watchdog.Kill();}catch {}watchdog=null;return false; }
            return true;
        }
        internal static bool Apply() {
            lock(gate) {
                if(applied && watchdog!=null && !watchdog.HasExited)return true;
                try {
                    monitoring=false;
                    if(!EnsureWatchdog())return false;
                    // The watchdog must be armed BEFORE changing shared cursors.
                    Process armProcess=watchdog;string armNonce=Guid.NewGuid().ToString("N");
                    armProcess.StandardInput.WriteLine("arm "+armNonce);armProcess.StandardInput.Flush();
                    Task<string> acknowledgement=Task.Factory.StartNew(delegate {return armProcess.StandardOutput.ReadLine();});
                    if(!acknowledgement.Wait(2000)||watchdog!=armProcess||armProcess.HasExited||!ArmReceiptMatches(acknowledgement.Result,armNonce,armProcess.Id))throw new InvalidOperationException("Cursor watchdog did not acknowledge this arming request");
                    monitoring=true;
                    if(!File.ReadAllText(ControlFence.FileName).StartsWith("active|")){Restore();return false;}
                    int size=Math.Max(32,GetSystemMetrics(13));
                    foreach(uint role in new uint[]{32512,32649,32513,32650})
                    using(Bitmap bitmap=new Bitmap(size,size,PixelFormat.Format32bppArgb)) {
                        using(Graphics g=Graphics.FromImage(bitmap)) {
                            g.SmoothingMode=System.Drawing.Drawing2D.SmoothingMode.AntiAlias;
                            g.ScaleTransform(size/32f,size/32f);DesktopVisuals.NativeCursor(g,role);
                        }
                        IntPtr color=bitmap.GetHbitmap(Color.Transparent),mask=CreateBitmap(size,size,1,1,IntPtr.Zero),cursor=IntPtr.Zero;
                        try {
                            IconInfo icon=new IconInfo();icon.icon=false;icon.x=(uint)Math.Round((role==32513?16:4)*size/32f);icon.y=(uint)Math.Round((role==32513?16:2)*size/32f);icon.color=color;icon.mask=mask;
                            if(!File.ReadAllText(ControlFence.FileName).StartsWith("active|"))throw new InvalidOperationException("Control ended during cursor setup");
                            cursor=CreateIconIndirect(ref icon);
                            if(cursor==IntPtr.Zero || !SetSystemCursor(cursor,role))throw new InvalidOperationException("Windows refused custom cursor role");
                            cursor=IntPtr.Zero;applied=true;
                        } finally {if(cursor!=IntPtr.Zero)DestroyCursor(cursor);DeleteObject(color);DeleteObject(mask);}
                    }
                    if(!File.ReadAllText(ControlFence.FileName).StartsWith("active|")){Restore();return false;}
                    return true;
                }catch {
                    // A cursor rendering failure must not disarm the independent
                    // crash monitor. If arming itself failed, monitoring remains
                    // false and the guardian refuses control.
                    if(applied || watchdog!=null)SystemParametersInfo(0x57,0,IntPtr.Zero,0);
                    applied=false;return false;
                }
            }
        }
        internal static void Restore() {
            lock(gate) {
                // Also handles failure after the cursor was created but before
                // the local success flag was recorded.
                if(applied || watchdog!=null)SystemParametersInfo(0x57,0,IntPtr.Zero,0);
                applied=false;
                // Do not abandon independent cleanup while the journal is
                // missing, unreadable, or still contains a held input.
                if(InputLedger.HasHeld())return;
                try {if(watchdog!=null&&!watchdog.HasExited){watchdog.StandardInput.WriteLine("disarm");watchdog.StandardInput.Flush();}}catch {}
                monitoring=false;
            }
        }
        internal static bool CheckWatchdog() {
            lock(gate) {if(!monitoring||watchdog==null||watchdog.HasExited){Restore();return false;}return true;}
        }
        internal static void Close() {
            lock(gate) {
                Restore();
                try {if(watchdog!=null&&!watchdog.HasExited){watchdog.StandardInput.Close();if(!watchdog.WaitForExit(1500))watchdog.Kill();}}catch {}
                if(watchdog!=null)watchdog.Dispose();watchdog=null;
            }
        }
        static volatile bool armed,finished;
        static readonly object watchGate=new object();static long armEpoch;
        // Pure classification is shared with the headless contract test. An
        // unreadable or malformed active record never means safe disarm.
        internal static string WatchdogState(string text,ulong bootNow) {
            if(String.IsNullOrEmpty(text))return "invalid";
            string[] state=text.Split('|');
            if(state.Length<3)return "invalid";
            if(state[0]=="idle"||state[0]=="paused"||state[0]=="stopped")return "inactive";
            long wall;ulong until;
            if(state[0]!="active"||String.IsNullOrEmpty(state[1])||state.Length<5||
               !Int64.TryParse(state[2],out wall)||wall<=0||!UInt64.TryParse(state[4],out until)||until==0)return "invalid";
            return NativeDeadline.Valid(until,bootNow)?"active":"expired";
        }
        internal static bool WatchdogGraceElapsed(string state,ulong since,ulong now) {
            if(state!="invalid"&&state!="expired"&&state!="inactive")return false;
            ulong grace=state=="invalid"?1000UL:5000UL;
            return now>=since&&now-since>=grace;
        }
        static void CrashCleanup() {
            // This process outlives a hard-killed UI, and does not depend on the
            // Node event loop to revoke input or release keys/buttons.
            string file=ControlFence.FileName;
            ControlFence.LatchStop();
            try {File.WriteAllText(file,"stopped||0|");}catch {}
            try {
                foreach(string line in File.ReadAllLines(file+".workers")) {
                    string[] parts=line.Split(':');if(parts.Length!=2)continue;
                    using(Process p=Process.GetProcessById(Int32.Parse(parts[0])))
                        if(p.StartTime.ToUniversalTime().Ticks.ToString()==parts[1] &&
                           String.Equals(p.MainModule.FileName,Process.GetCurrentProcess().MainModule.FileName,StringComparison.OrdinalIgnoreCase))p.Kill();
                }
            }catch {}
            ControlFence.Recover();SystemParametersInfo(0x57,0,IntPtr.Zero,0);
        }
        internal static void Probe(string file,uint role=32512,bool shown=false) {
            int size=Math.Max(32,GetSystemMetrics(13));
            using(Bitmap image=new Bitmap(size,size)) {
                using(Graphics g=Graphics.FromImage(image)) {
                    g.Clear(Color.FromArgb(28,27,38));IntPtr dc=g.GetHdc();
                    IntPtr cursor=LoadCursor(IntPtr.Zero,new IntPtr(role));
                    if(shown) {CursorInfo info=new CursorInfo();info.size=Marshal.SizeOf(info);if(!GetCursorInfo(ref info))throw new Exception("Cannot inspect shown cursor");cursor=info.cursor;}
                    try {if(!DrawIconEx(dc,0,0,cursor,size,size,0,IntPtr.Zero,3))throw new Exception("Cannot inspect current cursor");}
                    finally{g.ReleaseHdc(dc);}
                }
                image.Save(file,ImageFormat.Png);
            }
        }
        internal static int Watch(int ownerPid,long started) {
            using(Process owner=Process.GetProcessById(ownerPid)) {
                if(owner.StartTime.ToUniversalTime().Ticks!=started)return 2;
                Thread input=new Thread(delegate() {
                    try {
                        string line;while((line=Console.ReadLine())!=null) {
                            if(line.StartsWith("arm ",StringComparison.Ordinal)&&NativeStopReceipt.ValidNonce(line.Substring(4))) {lock(watchGate){armed=true;armEpoch++;}Console.WriteLine("armed "+line.Substring(4)+" "+Process.GetCurrentProcess().Id);Console.Out.Flush();}
                            if(line=="disarm") {lock(watchGate){if(armed)SystemParametersInfo(0x57,0,IntPtr.Zero,0);armed=false;armEpoch++;}}
                        }
                    }finally {finished=true;}
                });input.IsBackground=true;input.Start();
                Console.WriteLine("cursor-watchdog-ready");Console.Out.Flush();
                ulong problemSince=0;string problem="",problemState="";
                try {
                    while(!finished && !owner.WaitForExit(100)) {
                        long epoch;lock(watchGate){epoch=armed?armEpoch:-1;}
                        if(epoch>=0) {
                            string file=ControlFence.FileName;
                            string stop=Environment.GetEnvironmentVariable("AGCU_STOP_LATCH");
                            if(ControlFence.LatchBlocks(stop))lock(watchGate){
                                if(armed&&armEpoch==epoch){CrashCleanup();armed=false;armEpoch++;return 3;}
                            }
                            ulong now=NativeDeadline.GetTickCount64();string status,text="";
                            try {text=File.ReadAllText(file);status=WatchdogState(text,now);}catch {status="invalid";}
                            if(status=="active"){problem="";problemState="";problemSince=0;}
                            else {
                                if(problem!=status||problemState!=text){problem=status;problemState=text;problemSince=now;}
                                // Only the guardian's explicit disarm, after
                                // worker termination and input recovery, ends
                                // crash protection. Allow normal cleanup time.
                                if(WatchdogGraceElapsed(status,problemSince,now))lock(watchGate){
                                    if(armed&&armEpoch==epoch){
                                        // A new state or disarm may have arrived
                                        // while the guard was being inspected.
                                        string latest="";try{latest=File.ReadAllText(file);}catch{}
                                        if(latest==text){CrashCleanup();armed=false;armEpoch++;return 3;}
                                    }
                                }
                            }
                        }
                    }
                }finally {if(armed)CrashCleanup();}
            }
            return 0;
        }
    }
}
