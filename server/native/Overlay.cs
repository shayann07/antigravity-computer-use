// Overlay - everything Computer Use puts on screen.
//
// Four windows in one colour - and one colour per Claude. A second session on
// the same desktop draws its own cursor, marker, ring and banner in the next
// hue along, so two agents working at once are two things you can tell apart
// rather than one thing behaving strangely:
//   - a glow around the window it is working in (click-through)
//   - a banner reading "Claude is using your computer", with Stop
//   - a Claude-coloured cursor showing where it is, alongside yours
//   - a marker naming each control as it is touched
//
// Rendering is per-pixel alpha via UpdateLayeredWindow, not a colour key. A
// TransparencyKey knocks out one exact colour, so every antialiased edge blends
// toward that colour and leaves a fringe of it around curves and text - with a
// magenta key that is a visible purple halo on everything, the cursor included.
// Real alpha has no such edge, and it hit-tests for free: fully transparent
// pixels pass clicks through without needing WS_EX_TRANSPARENT.
//
// The ring and the banner are separate windows on purpose. A painted ring on a
// clickable window would put a live 4px band around every screen edge, eating
// clicks meant for the taskbar, corner hot zones and window resize handles.
//
// The shared layered renderer is adapted from the attributed MIT upstream.
// Guardian mode follows the real cursor; temporary native arrow styling and
// independent crash restoration live in CursorSafety.cs.

using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;
using System.Threading;
using System.Windows.Forms;

namespace Axon
{
    internal static class Overlay
    {
        [DllImport("user32.dll")] static extern bool SetWindowDisplayAffinity(IntPtr hwnd, uint affinity);
        [DllImport("user32.dll")] static extern bool GetCursorPos(out NPOINT p);
        [DllImport("user32.dll")] static extern IntPtr MonitorFromPoint(NPOINT p,uint flags);
        [DllImport("shcore.dll")] static extern int GetDpiForMonitor(IntPtr monitor,int kind,out uint x,out uint y);
        internal static float ScreenScale(Screen screen) {
            try { uint x,y;IntPtr monitor=MonitorFromPoint(new NPOINT(screen.Bounds.Left+1,screen.Bounds.Top+1),2);
                if(GetDpiForMonitor(monitor,0,out x,out y)==0)return x/96f;
            }catch {}return 1;
        }
        [DllImport("user32.dll")] static extern IntPtr GetDC(IntPtr hwnd);
        [DllImport("user32.dll")] static extern int ReleaseDC(IntPtr hwnd, IntPtr hdc);
        [DllImport("gdi32.dll")] static extern IntPtr CreateCompatibleDC(IntPtr hdc);
        [DllImport("gdi32.dll")] static extern bool DeleteDC(IntPtr hdc);
        [DllImport("gdi32.dll")] static extern IntPtr SelectObject(IntPtr hdc, IntPtr obj);
        [DllImport("gdi32.dll")] static extern bool DeleteObject(IntPtr obj);
        [DllImport("user32.dll", SetLastError = true)]
        static extern bool UpdateLayeredWindow(IntPtr hwnd, IntPtr hdcDst, ref NPOINT pptDst, ref NSIZE psize,
                                               IntPtr hdcSrc, ref NPOINT pptSrc, int crKey,
                                               ref BLENDFUNCTION pblend, int dwFlags);

        [StructLayout(LayoutKind.Sequential)] internal struct NPOINT { public int X, Y; public NPOINT(int x, int y) { X = x; Y = y; } }
        [StructLayout(LayoutKind.Sequential)] internal struct NSIZE { public int W, H; public NSIZE(int w, int h) { W = w; H = h; } }
        [StructLayout(LayoutKind.Sequential)]
        internal struct BLENDFUNCTION { public byte BlendOp, BlendFlags, SourceConstantAlpha, AlphaFormat; }

        [DllImport("gdi32.dll")] static extern IntPtr CreateDIBSection(IntPtr hdc, ref BITMAPINFOHEADER header, uint usage, out IntPtr bits, IntPtr section, uint offset);
        [StructLayout(LayoutKind.Sequential)]
        internal struct BITMAPINFOHEADER { public int biSize, biWidth, biHeight; public short biPlanes, biBitCount; public int biCompression, biSizeImage, biXPelsPerMeter, biYPelsPerMeter, biClrUsed, biClrImportant; }
        [DllImport("user32.dll")] static extern bool IsWindow(IntPtr h);
        [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
        [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
        [DllImport("user32.dll")] static extern bool IsZoomed(IntPtr h);
        [DllImport("user32.dll")] static extern IntPtr GetWindow(IntPtr h, uint relation);
        [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int w, int height, uint flags);
        [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr h, int attribute, out NRECT value, int size);
        [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr h, int attribute, out int value, int size);
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] static extern IntPtr CreateWaitableTimerExW(IntPtr attributes, string name, uint flags, uint access);
        [DllImport("kernel32.dll")] static extern bool SetWaitableTimer(IntPtr timer, ref long due, int period, IntPtr routine, IntPtr argument, bool resume);
        [DllImport("kernel32.dll")] static extern uint WaitForMultipleObjects(uint count, IntPtr[] handles, bool all, uint milliseconds);

        const uint WDA_EXCLUDEFROMCAPTURE = 0x00000011;
        const int ULW_ALPHA = 0x02;
        const byte AC_SRC_OVER = 0x00, AC_SRC_ALPHA = 0x01;

        // Anthropic's own palette. One accent, everywhere - ring, banner, cursor
        // and marker all draw from it, so this reads as one thing rather than as
        // a colour scheme.
        internal static readonly Color Claude = Color.FromArgb(217, 119, 87);   // #D97757

        // With two Claudes on one desktop there are two cursors, two markers and
        // two banners, and they are all the same shape. Colour is what tells
        // them apart - the same thing a shared document does for two people
        // editing it. Session one keeps Claude's own colour, so a single session
        // looks exactly as it always did; later sessions take the next hue.
        // Whichever colour a cursor is, the banner and marker of that session
        // match it, so "who just clicked that" is answerable at a glance.
        static readonly Color[] Accents = new Color[]
        {
            Color.FromArgb(217, 119, 87),    // #D97757  Claude
            Color.FromArgb(170, 132, 255),   // Antigravity violet
            Color.FromArgb(139, 111, 196),   // #8B6FC4  violet
            Color.FromArgb( 90, 158, 106),   // #5A9E6A  green
            Color.FromArgb(198, 133, 61),    // #C6853D  amber
            Color.FromArgb(190, 96, 122),    // #BE607A  rose
        };

        internal static Color Accent
        {
            get
            {
                int i = _slot;
                if (i < 0) i = 0;
                return Accents[i % Accents.Length];
            }
        }

        internal static string AccentHex
        {
            get
            {
                Color c = Accent;
                return "#" + c.R.ToString("X2") + c.G.ToString("X2") + c.B.ToString("X2");
            }
        }
        internal static readonly Color Ink = Color.FromArgb(20, 20, 19);        // #141413
        internal static readonly Color Paper = Color.FromArgb(250, 249, 245);   // #FAF9F5

        static Thread _thread;
        static MarkerForm _marker;
        static Glow _glow;
        static BannerForm _banner;
        static CursorForm _cursor;
        static System.Windows.Forms.Timer _idleTimer;
        static volatile bool _stopRequested;
        static volatile bool _enabled = true;
        static volatile bool _ready;
        static IntPtr _markerHwnd, _bannerHwnd, _cursorHwnd;
        static IntPtr[] _glowHwnds = new IntPtr[0];
        static IntPtr[] OwnWindows() {
            IntPtr[] glow=_glowHwnds;IntPtr[] all=new IntPtr[glow.Length+3];
            all[0]=_markerHwnd;all[1]=_bannerHwnd;all[2]=_cursorHwnd;Array.Copy(glow,0,all,3,glow.Length);return all;
        }
        static string _fontName;

        // Which banner row this session owns, and what to call it. Two Claude
        // Code sessions on one desktop would otherwise draw the same banner in
        // the same place, hiding one Stop button behind the other - so each
        // session gets its own row, and says which one it is.
        static int _slot;
        static string _sessionLabel;
        static int _peers;

        // What Claude is doing right now, in a few words, after the banner's
        // message: "typing in notepad", "thinking". Codex's preview window
        // shows the activity; a banner that says what it is doing is the same
        // reassurance at a fraction of the screen.
        static string _status = "";

        internal static void Status(string s)
        {
            _status = s ?? "";
            if (!Enabled || _banner == null) return;
            try
            {
                _banner.BeginInvoke((MethodInvoker)delegate
                {
                    try { _banner.Relayout(); } catch { }
                });
            }
            catch { }
        }

        internal static void Configure(int slot, string label, int peers)
        {
            _slot = slot < 0 ? 0 : (slot > 8 ? 8 : slot);
            _sessionLabel = label;
            _peers = peers < 0 ? 0 : peers;
            if (!Enabled || _banner == null) return;
            try
            {
                _banner.BeginInvoke((MethodInvoker)delegate
                {
                    try { _banner.Relayout(); } catch { }
                });
            }
            catch { }
        }

        internal static bool Enabled { get { return _enabled && _ready; } }
        internal static float GlowOpacity {get {Glow glow=_glow;return glow==null?0:glow.OpacityValue;}}
        // The window the agent is working in, and where in it the last action
        // landed. The glow follows that window; nothing else is decided here.
        internal static void GlowTarget(long hwnd,int x,int y,bool hasPoint,bool pulse,bool sampleNow) {
            if(!Enabled||_marker==null||_glow==null)return;
            try {_marker.BeginInvoke((MethodInvoker)delegate {try {_glow.Target(new IntPtr(hwnd),x,y,hasPoint,pulse,sampleNow);}catch {}});}catch {}
        }
        // glow.stop: 67 ms from whatever it was doing. Safe from any thread.
        // The bench, live: lights one window for a few seconds and prints what
        // the glow achieved (frame times, processor time). Not used by the product.
        internal static void GlowTrial(long hwnd,int seconds) {
            Glow glow=new Glow();glow.Trial=true;System.Diagnostics.Process self=System.Diagnostics.Process.GetCurrentProcess();
            System.Windows.Forms.Timer tick=new System.Windows.Forms.Timer();tick.Interval=1000;int passed=0;TimeSpan before=TimeSpan.Zero;
            tick.Tick+=delegate {
                passed++;
                if(passed==1)Console.WriteLine("entered "+new System.Web.Script.Serialization.JavaScriptSerializer().Serialize(glow.Report()));
                // The first two seconds hold the entrance; the rest is the glow at rest.
                if(passed==2){self.Refresh();before=self.TotalProcessorTime;}
                if(passed>=seconds) {
                    self.Refresh();double share=(self.TotalProcessorTime-before).TotalMilliseconds/((passed-2)*10.0);
                    Console.WriteLine("rest "+new System.Web.Script.Serialization.JavaScriptSerializer().Serialize(glow.Report())+" cpu_percent_of_one_core="+share.ToString("0.0")+" frames="+glow.composed+" compose_ms_each="+(glow.composing/Math.Max(1,glow.composed)).ToString("0.00")+" present_ms_each="+(glow.presenting/Math.Max(1,glow.composed)).ToString("0.00"));
                    tick.Stop();Application.ExitThread();
                }
            };
            tick.Start();try {glow.Target(new IntPtr(hwnd),0,0,false,false,false);}catch(Exception e){Console.WriteLine(e.ToString());}
            Application.Run();
        }
        internal static void GlowBrightness(float level) {
            GlowLevel=level;
            if(_marker==null||_glow==null)return;
            try {_marker.BeginInvoke((MethodInvoker)delegate {try {_glow.Bright(level);}catch {}});}catch {}
        }
        static volatile float GlowLevel=.55f;
        internal static void GlowStop() {
            if(_marker==null||_glow==null)return;
            try {_marker.BeginInvoke((MethodInvoker)delegate {try {_glow.Exit(DesktopVisuals.FastLeave);}catch {}});}catch {}
        }
        internal static object GlowReport() {
            if(!Enabled||_marker==null||_glow==null)return null;
            try {return _marker.Invoke((Func<object>)delegate {return _glow.Report();});}catch {return null;}
        }
        internal static void ClickFeedback() {
            if(!Enabled||_marker==null)return;
            try {_marker.BeginInvoke((MethodInvoker)delegate {if(_cursor.Visible)_cursor.Ping();});}catch {}
        }
        internal static bool StopRequested { get { return _stopRequested; } }

        internal static bool IsOwnWindow(IntPtr h)
        {
            if (h == IntPtr.Zero) return false;
            if (h == _markerHwnd || h == _bannerHwnd || h == _cursorHwnd) return true;
            foreach (IntPtr strip in _glowHwnds) if (h == strip) return true;
            return false;
        }

        // Every overlay window carries a window property naming it as ours, so
        // ANY Computer Use host can recognise ANY other one's chrome. Without
        // this, a second Claude session's banner is just an unexplained window
        // to the first: listable, targetable, and clickable. A window property
        // is readable across processes and dies with the window, so there is
        // nothing to clean up and nothing to get out of date.
        const string MarkerProp = "ComputerUseOverlayWindow";

        [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern bool SetPropW(IntPtr h, string name, IntPtr data);
        [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern IntPtr GetPropW(IntPtr h, string name);
        [DllImport("user32.dll")] static extern int GetWindowLongW(IntPtr h, int index);
        [DllImport("user32.dll")] static extern int SetWindowLongW(IntPtr h, int index, int value);
        [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out NRECT r);

        [StructLayout(LayoutKind.Sequential)] internal struct NRECT { public int Left, Top, Right, Bottom; }

        const int GWL_EXSTYLE = -20;
        const int WS_EX_TRANSPARENT = 0x00000020;

        internal static bool IsAnyOverlayWindow(IntPtr h)
        {
            if (h == IntPtr.Zero) return false;
            if (IsOwnWindow(h)) return true;
            try { return GetPropW(h, MarkerProp) != IntPtr.Zero; }
            catch { return false; }
        }

        static void Mark(IntPtr h)
        {
            try { SetPropW(h, MarkerProp, new IntPtr(1)); } catch { }
        }

        // The banner is the one overlay window that accepts clicks - Stop has to
        // be pressable - which means it also swallows a real click aimed at
        // whatever is underneath it. A control near the top of the screen is a
        // perfectly ordinary thing to click. So for the length of one injected
        // click the banner is made transparent to the mouse: it stays visible,
        // it just stops being in the way. Returns true if that was needed.
        internal static bool BeginClickThrough(int x, int y)
        {
            return BeginClickThroughRect(x, y, 1, 1);
        }

        // Takes the whole control, not just the point, because the banner does
        // more than swallow the click: while it covers part of a control, the
        // provider's own idea of where that control is clickable shifts to the
        // sliver still showing, which puts the click on the element's edge and
        // often misses it entirely. Stepping aside before the point is worked
        // out is what makes a real click on a control near the top of the
        // screen land where it should.
        internal static bool BeginClickThroughRect(int x, int y, int w, int h_)
        {
            IntPtr h = _bannerHwnd;
            if (h == IntPtr.Zero) return false;
            try
            {
                NRECT r;
                if (!GetWindowRect(h, out r)) return false;
                if (x >= r.Right || x + w <= r.Left || y >= r.Bottom || y + h_ <= r.Top) return false;
                int ex = GetWindowLongW(h, GWL_EXSTYLE);
                if ((ex & WS_EX_TRANSPARENT) != 0) return false;
                SetWindowLongW(h, GWL_EXSTYLE, ex | WS_EX_TRANSPARENT);
                return true;
            }
            catch { return false; }
        }

        internal static void EndClickThrough()
        {
            IntPtr h = _bannerHwnd;
            if (h == IntPtr.Zero) return;
            try
            {
                int ex = GetWindowLongW(h, GWL_EXSTYLE);
                SetWindowLongW(h, GWL_EXSTYLE, ex & ~WS_EX_TRANSPARENT);
            }
            catch { }
        }

        internal static bool ConsumeStop()
        {
            if (!_stopRequested) return false;
            _stopRequested = false;
            return true;
        }

        internal static void RequestStop() { _stopRequested = true; }

        // OpenAI Sans and Söhne are licensed faces that cannot ship inside a
        // plugin, so this resolves the closest grotesque actually installed
        // rather than pretending to be either.
        internal static string UiFont
        {
            get
            {
                if (_fontName != null) return _fontName;
                string[] wanted = { "Segoe UI Variable Text", "Inter", "Segoe UI", "Arial" };
                foreach (string want in wanted)
                {
                    try
                    {
                        foreach (FontFamily f in FontFamily.Families)
                            if (string.Equals(f.Name, want, StringComparison.OrdinalIgnoreCase))
                            {
                                _fontName = want;
                                return _fontName;
                            }
                    }
                    catch { }
                }
                _fontName = "Segoe UI";
                return _fontName;
            }
        }

        internal static void Start(bool enabled)
        {
            _enabled = enabled;
            if (!enabled) return;
            try
            {
                _thread = new Thread(Run);
                _thread.IsBackground = true;
                _thread.SetApartmentState(ApartmentState.STA);
                _thread.Name = "computer-use-overlay";
                _thread.Start();
                for (int i = 0; i < 60 && !_ready; i++) Thread.Sleep(25);
            }
            catch { _enabled = false; }
        }

        static void Run()
        {
            try
            {
                _marker = new MarkerForm(); _marker.CreateControl(); _markerHwnd = _marker.Handle; Exclude(_markerHwnd); Mark(_markerHwnd);
                _glow = new Glow(); _glow.Bright(GlowLevel); _glowHwnds = _glow.Handles(); foreach (IntPtr strip in _glowHwnds) { Exclude(strip); Mark(strip); }
                _banner = new BannerForm(); _banner.CreateControl(); _bannerHwnd = _banner.Handle; Exclude(_bannerHwnd); Mark(_bannerHwnd);
                _cursor = new CursorForm(); _cursor.CreateControl(); _cursorHwnd = _cursor.Handle; Exclude(_cursorHwnd); Mark(_cursorHwnd);

                _idleTimer = new System.Windows.Forms.Timer();
                _idleTimer.Interval = 2200;
                _idleTimer.Tick += delegate
                {
                    _idleTimer.Stop();
                    try { _glow.Exit(DesktopVisuals.NormalLeave); } catch { }
                    try { _banner.Vanish(); } catch { }
                    try { _cursor.Vanish(); } catch { }
                };

                _ready = true;
                Application.Run(_marker);
            }
            catch { _enabled = false; }
            finally
            {
                _ready = false;
                _markerHwnd = _bannerHwnd = _cursorHwnd = IntPtr.Zero; _glowHwnds = new IntPtr[0];
            }
        }

        internal static bool CaptureExcluded=true;
        static volatile bool _recordVisuals;
        // Local recording preference only. The action protocol cannot change it.
        // Agent screenshots still hide these windows through Guardian.capture.
        internal static void RecordVisuals(bool enabled)
        {
            _recordVisuals=enabled;
            if(!Enabled||_marker==null)return;
            _marker.Invoke((MethodInvoker)delegate {
                CaptureExcluded=!enabled;
                foreach(IntPtr h in OwnWindows())
                    if(h!=IntPtr.Zero)Exclude(h);
            });
        }
        static void Exclude(IntPtr h)
        {
            try { if(!SetWindowDisplayAffinity(h,_recordVisuals?0:WDA_EXCLUDEFROMCAPTURE)) CaptureExcluded=false; } catch { CaptureExcluded=false; }
        }

        // When Computer Use last began doing something. Escape reads this to tell
        // "stop what you are doing" from an Escape the user pressed in their own
        // application while nothing of ours was running.
        static long _lastActiveTicks;

        internal static bool ActiveWithin(int ms)
        {
            long t = System.Threading.Interlocked.Read(ref _lastActiveTicks);
            if (t == 0) return false;
            return (DateTime.UtcNow.Ticks - t) / TimeSpan.TicksPerMillisecond < ms;
        }

        // ------------------------------------------------------------------
        // Virtual desktops.
        //
        // A window belongs to the desktop it was created on. So the banner that
        // says "Claude is using your computer", and the Stop button on it, are
        // invisible the moment the user switches to another virtual desktop -
        // which is precisely when they are most entitled to know that something
        // is still driving their machine. Windows exposes a documented way for a
        // process to move its OWN windows between desktops, so the chrome
        // follows the person rather than staying where it was born.
        //
        // On a Windows without the interface, every call here is a no-op and
        // nothing else changes.
        [ComImport, Guid("AA509086-5CA9-4C25-8F95-589D3C07B48A")]
        class VirtualDesktopManagerClass { }

        [ComImport, InterfaceType(ComInterfaceType.InterfaceIsIUnknown), Guid("A5CD92FF-29BE-454C-8D04-D82879FB3F1B")]
        interface IVirtualDesktopManager
        {
            [PreserveSig] int IsWindowOnCurrentVirtualDesktop(IntPtr hwnd, out int onCurrent);
            [PreserveSig] int GetWindowDesktopId(IntPtr hwnd, out Guid desktopId);
            [PreserveSig] int MoveWindowToDesktop(IntPtr hwnd, ref Guid desktopId);
        }

        static IVirtualDesktopManager _desktops;
        static bool _desktopsTried;
        static int _lastFollowTick;

        static IVirtualDesktopManager Desktops
        {
            get
            {
                if (!_desktopsTried)
                {
                    _desktopsTried = true;
                    try { _desktops = (IVirtualDesktopManager)new VirtualDesktopManagerClass(); }
                    catch { _desktops = null; }
                }
                return _desktops;
            }
        }

        // 1 = on the desktop the user is looking at, 0 = on another one,
        // -1 = this Windows cannot say.
        internal static int OnCurrentDesktop(IntPtr h)
        {
            IVirtualDesktopManager vdm = Desktops;
            if (vdm == null || h == IntPtr.Zero) return -1;
            try
            {
                int on;
                if (vdm.IsWindowOnCurrentVirtualDesktop(h, out on) != 0) return -1;
                return on != 0 ? 1 : 0;
            }
            catch { return -1; }
        }

        // Is this session's banner - the thing carrying the Stop button - on the
        // desktop the user is actually looking at? The whole accountability
        // story depends on the answer being yes.
        internal static int OverlayHere() { return OnCurrentDesktop(_bannerHwnd); }

        static void FollowToCurrentDesktop()
        {
            IVirtualDesktopManager vdm = Desktops;
            if (vdm == null || _bannerHwnd == IntPtr.Zero) return;
            // Cheap, but not free, and this runs on every action.
            int now = Environment.TickCount;
            if (now - _lastFollowTick < 1000 && _lastFollowTick != 0) return;
            _lastFollowTick = now;
            try
            {
                if (OnCurrentDesktop(_bannerHwnd) != 0) return;

                // Which desktop is current? Ask a window that is already on it.
                IntPtr fg = Native.GetForegroundWindow();
                if (fg == IntPtr.Zero || IsAnyOverlayWindow(fg)) return;
                Guid id;
                if (vdm.GetWindowDesktopId(fg, out id) != 0 || id == Guid.Empty) return;

                // The glow is not moved: it belongs to its window's desktop.
                IntPtr[] all = new IntPtr[] { _markerHwnd, _bannerHwnd, _cursorHwnd };
                foreach (IntPtr h in all)
                {
                    if (h == IntPtr.Zero) continue;
                    try { vdm.MoveWindowToDesktop(h, ref id); } catch { }
                }
            }
            catch { }
        }

        internal static void HideImmediate() {
            if(_marker==null)return;
            try { _marker.Invoke((MethodInvoker)delegate { _glow.Suspend(); _banner.Hide(); _cursor.Hide(); _marker.Hide(); }); } catch { }
        }
        internal static void HideAll() {
            if (_marker == null) return;
            try { _marker.BeginInvoke((MethodInvoker)delegate { _glow.Exit(DesktopVisuals.NormalLeave); _banner.Vanish(); _cursor.Vanish(); _marker.Hide(); }); } catch { }
        }
        internal static void MarkActive()
        {
            FollowToCurrentDesktop();
            System.Threading.Interlocked.Exchange(ref _lastActiveTicks, DateTime.UtcNow.Ticks);
            if (!Enabled || _banner == null) return;
            try
            {
                _banner.BeginInvoke((MethodInvoker)delegate
                {
                    try
                    {
                        _glow.Resume();
                        if (Environment.GetEnvironmentVariable("AGCU_GUARDIAN") == "1") _cursor.FollowRealCursor();
                        if (Environment.GetEnvironmentVariable("AGCU_GUARDIAN") != "1") _banner.Appear();
                        if (_idleTimer != null) { _idleTimer.Stop(); _idleTimer.Start(); }
                    }
                    catch { }
                });
            }
            catch { }
        }

        // rect is screen coordinates; label says what happened and to what.
        internal static void Flash(int[] rect, string label)
        {
            if (!Enabled || rect == null || _marker == null) return;
            try
            {
                _marker.BeginInvoke((MethodInvoker)delegate
                {
                    try
                    {
                        Rectangle r = new Rectangle(rect[0], rect[1], rect[2], rect[3]);
                        _marker.Flash(r, label);
                        if (_cursor != null) _cursor.MoveTo(r.Left + r.Width / 2, r.Top + r.Height / 2);
                    }
                    catch { }
                });
            }
            catch { }
        }

        internal static void Stop()
        {
            try { if (_marker != null) _marker.BeginInvoke((MethodInvoker)delegate { Application.ExitThread(); }); }
            catch { }
        }

        // Puts a premultiplied surface on a layered window, at a place and an
        // overall opacity. The control bar uses it, so its pill has a smooth edge.
        internal static void Present(IntPtr hwnd, Bitmap surface, int x, int y, byte alpha)
        {
            IntPtr screenDc = GetDC(IntPtr.Zero), memDc = CreateCompatibleDC(screenDc), bitmap = surface.GetHbitmap(Color.FromArgb(0)), old = SelectObject(memDc, bitmap);
            try
            {
                NSIZE size = new NSIZE(surface.Width, surface.Height); NPOINT src = new NPOINT(0, 0), dst = new NPOINT(x, y);
                BLENDFUNCTION blend = new BLENDFUNCTION(); blend.BlendOp = AC_SRC_OVER; blend.SourceConstantAlpha = alpha; blend.AlphaFormat = AC_SRC_ALPHA;
                UpdateLayeredWindow(hwnd, screenDc, ref dst, ref size, memDc, ref src, 0, ref blend, ULW_ALPHA);
            }
            finally { SelectObject(memDc, old); DeleteObject(bitmap); DeleteDC(memDc); ReleaseDC(IntPtr.Zero, screenDc); }
        }

        internal static GraphicsPath RoundRect(RectangleF r, float radius)
        {
            GraphicsPath p = new GraphicsPath();
            float d = radius * 2;
            if (d > r.Height) d = r.Height;
            if (d > r.Width) d = r.Width;
            if (d <= 0) { p.AddRectangle(r); return p; }
            p.AddArc(r.X, r.Y, d, d, 180, 90);
            p.AddArc(r.Right - d, r.Y, d, d, 270, 90);
            p.AddArc(r.Right - d, r.Bottom - d, d, d, 0, 90);
            p.AddArc(r.X, r.Bottom - d, d, d, 90, 90);
            p.CloseFigure();
            return p;
        }

        internal static Color Shade(Color c, float amount)
        {
            return Color.FromArgb(c.A,
                (int)Math.Max(0, Math.Min(255, c.R * (1 - amount))),
                (int)Math.Max(0, Math.Min(255, c.G * (1 - amount))),
                (int)Math.Max(0, Math.Min(255, c.B * (1 - amount))));
        }

        // ------------------------------------------------------------------
        // Shared base: layered, topmost, never activating, per-pixel alpha.
        // ------------------------------------------------------------------
        abstract class GhostForm : Form
        {
            IntPtr _hBitmap = IntPtr.Zero;
            Size _cached = Size.Empty;
            byte _alpha = 255;
            System.Windows.Forms.Timer _anim;
            Action _animDone;

            protected GhostForm(bool clickThrough)
            {
                ClickThrough = clickThrough;
                FormBorderStyle = FormBorderStyle.None;
                ShowInTaskbar = false;
                TopMost = true;
                StartPosition = FormStartPosition.Manual;
                // No TransparencyKey and no background painting: the entire
                // surface comes from UpdateLayeredWindow.
                SetStyle(ControlStyles.Opaque, true);
            }

            protected bool ClickThrough;
            protected override bool ShowWithoutActivation { get { return true; } }

            protected override CreateParams CreateParams
            {
                get
                {
                    CreateParams cp = base.CreateParams;
                    cp.ExStyle |= 0x00000080    // WS_EX_TOOLWINDOW  - out of alt-tab
                               |  0x08000000    // WS_EX_NOACTIVATE  - never takes focus
                               |  0x00080000;   // WS_EX_LAYERED
                    if (ClickThrough) cp.ExStyle |= 0x00000020;  // WS_EX_TRANSPARENT
                    return cp;
                }
            }

            protected override void OnPaintBackground(PaintEventArgs e) { }
            protected override void OnPaint(PaintEventArgs e) { }

            // Subclasses draw onto a fully transparent surface.
            protected abstract void Render(Graphics g);

            protected void Redraw()
            {
                if (!IsHandleCreated || Width <= 0 || Height <= 0) return;
                ReleaseBitmap();
                using (Bitmap bmp = new Bitmap(Width, Height, PixelFormat.Format32bppArgb))
                {
                    using (Graphics g = Graphics.FromImage(bmp))
                    {
                        g.Clear(Color.Transparent);
                        g.SmoothingMode = SmoothingMode.AntiAlias;
                        g.TextRenderingHint = System.Drawing.Text.TextRenderingHint.AntiAliasGridFit;
                        Render(g);
                    }
                    _hBitmap = bmp.GetHbitmap(Color.FromArgb(0));
                    _cached = new Size(Width, Height);
                }
                Push();
            }

            // Blits the cached surface at the current position and alpha. No
            // allocation and no repaint, which is what makes fading a window the
            // size of the desktop affordable.
            protected void Push()
            {
                if (_hBitmap == IntPtr.Zero || !IsHandleCreated) return;
                // The drawing context is kept with the surface, so a frame
                // does not make and destroy one.
                if (_memDc == IntPtr.Zero)
                {
                    IntPtr screen = GetDC(IntPtr.Zero);
                    _memDc = CreateCompatibleDC(screen); ReleaseDC(IntPtr.Zero, screen);
                    if (_memDc == IntPtr.Zero) return;
                    _memOld = SelectObject(_memDc, _hBitmap);
                }
                IntPtr screenDc = IntPtr.Zero, memDc = _memDc;
                {
                    NSIZE size = new NSIZE(_cached.Width, _cached.Height);
                    NPOINT src = new NPOINT(0, 0);
                    NPOINT dst = new NPOINT(Left, Top);
                    BLENDFUNCTION blend = new BLENDFUNCTION();
                    blend.BlendOp = AC_SRC_OVER;
                    blend.BlendFlags = 0;
                    blend.SourceConstantAlpha = _alpha;
                    blend.AlphaFormat = AC_SRC_ALPHA;
                    UpdateLayeredWindow(Handle, screenDc, ref dst, ref size, memDc, ref src, 0, ref blend, ULW_ALPHA);
                }
            }
            IntPtr _memDc = IntPtr.Zero, _memOld = IntPtr.Zero;

            void ReleaseBitmap()
            {
                if (_memDc != IntPtr.Zero) { SelectObject(_memDc, _memOld); DeleteDC(_memDc); _memDc = IntPtr.Zero; }
                if (_hBitmap != IntPtr.Zero) { DeleteObject(_hBitmap); _hBitmap = IntPtr.Zero; }
                _bits = IntPtr.Zero;
            }

            // A surface written as raw premultiplied ARGB pixels, for content
            // that is computed per pixel. The section is kept between frames,
            // so an animation only copies bytes and blits.
            IntPtr _bits = IntPtr.Zero;
            protected void SetSurface(int[] pixels, int width, int height)
            {
                if (!IsHandleCreated || width <= 0 || height <= 0 || pixels == null) return;
                if (_bits == IntPtr.Zero || _cached.Width != width || _cached.Height != height)
                {
                    ReleaseBitmap();
                    BITMAPINFOHEADER header = new BITMAPINFOHEADER();
                    header.biSize = 40; header.biWidth = width; header.biHeight = -height; header.biPlanes = 1; header.biBitCount = 32;
                    IntPtr bits;
                    _hBitmap = CreateDIBSection(IntPtr.Zero, ref header, 0, out bits, IntPtr.Zero, 0);
                    if (_hBitmap == IntPtr.Zero) return;
                    _bits = bits; _cached = new Size(width, height);
                }
                Marshal.Copy(pixels, 0, _bits, Math.Min(pixels.Length, width * height));
                Push();
            }

            // Redraws through one kept canvas, for surfaces that animate: no
            // bitmap is made or thrown away per frame.
            Bitmap _canvas; int[] _canvasPixels;
            protected void RedrawKept()
            {
                if (!IsHandleCreated || Width <= 0 || Height <= 0) return;
                if (_canvas == null || _canvas.Width != Width || _canvas.Height != Height)
                {
                    if (_canvas != null) _canvas.Dispose();
                    _canvas = new Bitmap(Width, Height, PixelFormat.Format32bppPArgb); _canvasPixels = new int[Width * Height];
                }
                using (Graphics g = Graphics.FromImage(_canvas))
                {
                    g.Clear(Color.Transparent);
                    g.SmoothingMode = SmoothingMode.AntiAlias;
                    Render(g);
                }
                BitmapData data = _canvas.LockBits(new Rectangle(0, 0, Width, Height), ImageLockMode.ReadOnly, PixelFormat.Format32bppPArgb);
                try { Marshal.Copy(data.Scan0, _canvasPixels, 0, _canvasPixels.Length); } finally { _canvas.UnlockBits(data); }
                SetSurface(_canvasPixels, Width, Height);
            }

            protected float Alpha
            {
                get { return _alpha / 255f; }
                set
                {
                    byte a = (byte)Math.Max(0, Math.Min(255, (int)(value * 255)));
                    if (a == _alpha) return;
                    _alpha = a;
                    Push();
                }
            }

            protected void PlaceAt(int x, int y) { Location = new Point(x, y); Push(); }
            // A move alone: the picture is already there, so nothing is uploaded.
            protected void SlideTo(int x, int y) { if (Left != x || Top != y) Location = new Point(x, y); }

            // Entering elements ease out: quick to arrive, gentle to settle.
            protected void Animate(int durationMs, Action<float> step, Action done)
            {
                StopAnimation();
                DateTime start = DateTime.UtcNow;
                _animDone = done;
                _anim = new System.Windows.Forms.Timer();
                _anim.Interval = 16;
                _anim.Tick += delegate
                {
                    double elapsed = (DateTime.UtcNow - start).TotalMilliseconds;
                    float t = durationMs <= 0 ? 1f : (float)Math.Min(1.0, elapsed / durationMs);
                    float e = 1f - (float)Math.Pow(1 - t, 3);
                    try { step(e); } catch { }
                    if (t >= 1f)
                    {
                        Action d = _animDone;
                        StopAnimation();
                        if (d != null) { try { d(); } catch { } }
                    }
                };
                _anim.Start();
            }

            protected void StopAnimation()
            {
                _animDone = null;
                if (_anim != null) { _anim.Stop(); _anim.Dispose(); _anim = null; }
            }

            protected static float Lerp(float a, float b, float t) { return a + (b - a) * t; }

            protected override void Dispose(bool disposing)
            {
                if (disposing) { StopAnimation(); ReleaseBitmap(); if (_canvas != null) _canvas.Dispose(); }
                base.Dispose(disposing);
            }
        }

        // ------------------------------------------------------------------
        // The glow around the app the agent is working in. Four thin strips,
        // one per edge, so only bands are ever uploaded and never the empty
        // interior. They sit directly above the target window, not topmost: a
        // window in front of the target covers the glow too.
        sealed class GlowStrip : GhostForm
        {
            internal GlowStrip() : base(true) { TopMost = false; Bounds = new Rectangle(-10000, -10000, 10, 10); }
            protected override void Render(Graphics g) { }
            internal void Surface(int[] pixels, Rectangle where) { SetBounds(where.X, where.Y, where.Width, where.Height); SetSurface(pixels, where.Width, where.Height); }
            internal void Shift(int x, int y) { SlideTo(x, y); }
            internal float Level { get { return Alpha; } set { Alpha = value; } }
        }

        sealed class Glow
        {
            const uint GW_HWNDPREV = 3;
            const uint SWP_QUIET = 0x0001 | 0x0002 | 0x0010 | 0x0200 | 0x0400;   // no size, move, activate, owner z-order or change notice
            // Strips 0..3 carry the edge band, 4..7 the deep wash behind it.
            readonly GlowStrip[] strips = new GlowStrip[8];
            // Follows the window. Runs while a target is set.
            readonly System.Windows.Forms.Timer watch = new System.Windows.Forms.Timer();
            readonly System.Diagnostics.Stopwatch clock = System.Diagnostics.Stopwatch.StartNew();
            // The frame clock: a thread of its own, in step with the display.
            // It works out each frame's light; this (the UI) thread only puts
            // the finished frame on screen. One frame is in flight at a time.
            readonly Thread pacer; readonly AutoResetEvent wake = new AutoResetEvent(false);
            int inFlight;

            // Owned by the UI thread.
            IntPtr target = IntPtr.Zero;
            readonly bool[] inside = new bool[4];
            Rectangle seen = Rectangle.Empty;       // the last bounds read
            double seenAt, lastShown = -1;
            Point shift = Point.Empty;              // where the window has moved since the bake
            bool shown, leaving, passing, suspended, moved, waiting;
            float master;                           // overall opacity
            bool hasPoint; int pointX, pointY;
            readonly double[] gaps = new double[64]; int gapCount;

            // Shared with the frame clock, under gate. Nothing waits while holding it.
            readonly object gate = new object();
            sealed class Job
            {
                internal GlowField Edge, Veil; internal int Generation; internal bool Band, Wash, Done;
                internal double Time; internal float X, Y, Grow, Bright, Master; internal int Every;
            }
            GlowField edge, veil;
            int generation; volatile bool live; bool bandDue, washDue;
            double bandAt, washAt, still;
            double enterAt = -1, pointAt = -1, brightAt = -1, masterAt = -1, masterFrom, masterTo, masterMs;
            float aimX, aimY, pointFromX, pointFromY, pointToX, pointToY;
            float bright = .55f, brightFrom, brightTo = .55f;

            internal Glow()
            {
                for (int i = 0; i < 8; i++) { strips[i] = new GlowStrip(); strips[i].CreateControl(); IntPtr handle = strips[i].Handle; }
                watch.Interval = 40; watch.Tick += delegate { try { Watch(); } catch (Exception e) { if (Trial) Console.WriteLine(e.ToString()); } };
                pacer = new Thread(Pace); pacer.IsBackground = true; pacer.Name = "glow frames"; pacer.Start();
            }
            internal bool Trial; internal double composing, presenting; internal int composed;
            internal IntPtr[] Handles() { IntPtr[] all = new IntPtr[8]; for (int i = 0; i < 8; i++) all[i] = strips[i].Handle; return all; }
            bool Lit { get { return shown && !suspended && !leaving && !passing; } }
            // What a caller is told: there or not, never a value part-way.
            internal float OpacityValue { get { return Lit ? 1 : 0; } }
            double Now { get { return clock.Elapsed.TotalMilliseconds; } }
            GlowField Field(int strip) { return strip < 4 ? edge : veil; }

            internal object Report()
            {
                Rectangle f = edge == null || !Lit ? Rectangle.Empty : edge.Frame;
                double typical = 0, worst = 0;
                if (gapCount > 0)
                {
                    int count = Math.Min(gapCount, gaps.Length); double[] sorted = new double[count];
                    Array.Copy(gaps, sorted, count); Array.Sort(sorted); typical = sorted[count / 2]; worst = sorted[count - 1];
                }
                return new { shown = Lit, target = target.ToInt64(), frame = new int[] { f.X + shift.X, f.Y + shift.Y, f.Width, f.Height }, inside = (bool[])inside.Clone(), opacity = master, animating = live, frame_ms = Math.Round(typical, 1), frame_worst_ms = Math.Round(worst, 1) };
            }

            void Wake() { lock (gate) live = shown && !suspended && edge != null; wake.Set(); }

            internal void Target(IntPtr hwnd, int x, int y, bool point, bool acted, bool sampleNow)
            {
                if (hwnd == IntPtr.Zero) return;
                if (hwnd != target)
                {
                    // The agent moved to another window: this one's glow
                    // leaves, and the new one enters on its own bounds.
                    Pass(); target = hwnd; seen = Rectangle.Empty; hasPoint = false;
                }
                if (leaving) { leaving = false; if (shown) FadeTo(1, DesktopVisuals.Normal); }
                suspended = false;
                if (point) SetPoint(x, y);
                else if (sampleNow) SamplePointer();
                else if (acted) sampleAt = Now + 180;
                if (!watch.Enabled) { watch.Start(); Watch(); }
            }
            double sampleAt = -1;

            // The pointer is where a click, drag or scroll just landed. It is
            // read once, just after the action, never followed.
            void SamplePointer()
            {
                NPOINT p; if (!GetCursorPos(out p)) return;
                Rectangle f = seen; f.Inflate(24, 24);
                if (f.Contains(p.X, p.Y)) SetPoint(p.X, p.Y);
            }

            // glow.action: the one answer to the agent's work. The bright
            // zone travels to the new point; it does not jump, and nothing
            // else moves.
            void SetPoint(int x, int y)
            {
                hasPoint = true; pointX = x; pointY = y;
                if (!shown || passing) return;
                lock (gate)
                {
                    if (edge == null) return;
                    float fx = x - shift.X, fy = y - shift.Y;
                    if (!DesktopVisuals.MotionEnabled) { aimX = fx; aimY = fy; pointAt = -1; }
                    else { pointFromX = aimX; pointFromY = aimY; pointToX = fx; pointToY = fy; pointAt = Now; }
                    bandDue = true;
                }
                Wake();
            }

            // glow.brightness: the person's setting, eased so it never snaps.
            internal void Bright(float level)
            {
                lock (gate)
                {
                    if (!shown || !DesktopVisuals.MotionEnabled) { bright = brightTo = level; brightAt = -1; }
                    else { brightFrom = bright; brightTo = level; brightAt = Now; }
                    bandDue = washDue = true;
                }
                Wake();
            }

            bool Read(out Rectangle bounds, out Rectangle monitor, out Rectangle work, out float scale)
            {
                bounds = monitor = work = Rectangle.Empty; scale = 1;
                IntPtr h = target;
                if (h == IntPtr.Zero || !IsWindow(h) || !IsWindowVisible(h) || IsIconic(h)) return false;
                int cloaked;
                if (DwmGetWindowAttribute(h, 14, out cloaked, 4) == 0 && cloaked != 0) return false;
                if (OnCurrentDesktop(h) == 0) return false;
                NRECT r;
                if (DwmGetWindowAttribute(h, 9, out r, 16) != 0 && !GetWindowRect(h, out r)) return false;
                Screen screen = Screen.FromHandle(h);
                monitor = screen.Bounds; work = screen.WorkingArea; scale = ScreenScale(screen);
                // The visible frame: a maximised window ends at the work area,
                // and nothing is ever drawn on another monitor.
                bounds = Rectangle.Intersect(Rectangle.FromLTRB(r.Left, r.Top, r.Right, r.Bottom), IsZoomed(h) ? work : monitor);
                return bounds.Width >= 48 && bounds.Height >= 48;
            }

            // Each edge decides for itself: outside when it has room on its
            // own monitor, inside when it does not. 26 px to go in, 34 to come
            // back out, so a window resting near an edge does not flicker.
            static bool[] Sides(Rectangle bounds, Rectangle work, float scale, bool[] before)
            {
                int[] room = { bounds.Top - work.Top, work.Right - bounds.Right, work.Bottom - bounds.Bottom, bounds.Left - work.Left };
                bool[] result = new bool[4];
                for (int i = 0; i < 4; i++) result[i] = room[i] < (before[i] ? 34 : 26) * scale;
                return result;
            }

            int CornerRadius(float scale)
            {
                // Rounded window corners exist where this attribute does.
                int preference;
                if (DwmGetWindowAttribute(target, 33, out preference, 4) != 0 || preference == 1) return 0;
                return (int)Math.Round((preference == 3 ? 4 : 8) * scale);
            }

            // New geometry. Frames already on their way belong to the old
            // one and are dropped when they arrive.
            void Bake(Rectangle bounds, Rectangle monitor, float scale, float x, float y)
            {
                int radius = CornerRadius(scale);
                GlowField band = new GlowField(GlowField.Edge, bounds, inside, scale, radius, monitor), wash = new GlowField(GlowField.Veil, bounds, inside, scale, radius, monitor);
                lock (gate) { edge = band; veil = wash; generation++; aimX = x; aimY = y; pointAt = -1; bandDue = washDue = true; }
                shift = Point.Empty;
            }

            void Watch()
            {
                if (target == IntPtr.Zero) { watch.Stop(); return; }
                if (suspended || leaving) return;
                double now = Now;
                Rectangle bounds, monitor, work; float scale;
                if (!Read(out bounds, out monitor, out work, out scale))
                {
                    // Minimised, hidden, closed or on another desktop: no glow.
                    Pass();
                    seen = Rectangle.Empty;
                    if (!IsWindow(target) && !shown) { target = IntPtr.Zero; lock (gate) edge = veil = null; watch.Stop(); }
                    return;
                }
                if (sampleAt >= 0 && now >= sampleAt) { sampleAt = -1; SamplePointer(); }
                if (bounds != seen)
                {
                    bool first = seen.IsEmpty;
                    if (shown && !passing && bounds.Size == seen.Size)
                    {
                        // glow.follow: locked to the frame, 1:1, no easing.
                        shift = new Point(bounds.X - edge.Frame.X, bounds.Y - edge.Frame.Y);
                        for (int i = 0; i < 8; i++) { Rectangle strip = Field(i).Strips[i % 4]; if (!strip.IsEmpty) strips[i].Shift(strip.X + shift.X, strip.Y + shift.Y); }
                        moved = true;
                    }
                    else Pass();   // a jump: the old geometry is wrong
                    seen = bounds; seenAt = first ? now - 1000 : now;
                    if (!first) return;
                }
                // Sides are decided on settled bounds only.
                if (now - seenAt < 120 || passing) return;
                if (!shown) Enter(bounds, work, monitor, scale);
                else if (moved)
                {
                    moved = false;
                    bool[] sides = Sides(bounds, work, scale, inside);
                    bool same = sides[0] == inside[0] && sides[1] == inside[1] && sides[2] == inside[2] && sides[3] == inside[3];
                    if (!same) Pass();
                    else
                    {
                        // Same sides: bake again where the window now rests.
                        // The strips keep the old picture until the new one lands.
                        float ax, ay; lock (gate) { ax = (pointAt >= 0 ? pointToX : aimX) + shift.X; ay = (pointAt >= 0 ? pointToY : aimY) + shift.Y; }
                        Bake(bounds, monitor, scale, ax, ay); Wake();
                    }
                }
                else if (!live && DesktopVisuals.MotionEnabled) Wake();
                Order();
            }

            // glow.enter: one moment. The light fades up while the band
            // widens from the window's edge, over Slow, easing out. With
            // motion reduced it is a short fade and nothing grows.
            void Enter(Rectangle bounds, Rectangle work, Rectangle monitor, float scale)
            {
                bool[] sides = Sides(bounds, work, scale, inside);
                for (int i = 0; i < 4; i++) inside[i] = sides[i];
                Rectangle near = bounds; near.Inflate(24, 24);
                bool aimed = hasPoint && near.Contains(pointX, pointY);
                Bake(bounds, monitor, scale, aimed ? pointX : bounds.Left + bounds.Width / 2f, aimed ? pointY : bounds.Bottom);
                bool motion = DesktopVisuals.MotionEnabled;
                moved = false; leaving = passing = false; master = 0; gapCount = 0; lastShown = -1;
                lock (gate)
                {
                    bright = brightTo; brightAt = -1; enterAt = motion ? Now : -1;
                    masterFrom = 0; masterTo = 1; masterAt = Now; masterMs = motion ? DesktopVisuals.Slow : DesktopVisuals.Fast;
                }
                // The strips are shown by the first frame, so they never show an old picture.
                shown = true; waiting = true; Wake();
            }

            // ---- The frame clock's side. It sleeps on a high-resolution
            // timer until the next frame is due, or until it is woken, so a
            // resting glow costs only its frames.
            void Pace()
            {
                IntPtr timer = CreateWaitableTimerExW(IntPtr.Zero, null, 2, 0x1F0003);   // high resolution where Windows has it
                if (timer == IntPtr.Zero) timer = CreateWaitableTimerExW(IntPtr.Zero, null, 0, 0x1F0003);
                IntPtr[] either = { timer, wake.SafeWaitHandle.DangerousGetHandle() };
                double next = 0;
                while (true)
                {
                    try
                    {
                        if (!live) { wake.WaitOne(); next = 0; continue; }
                        double wait = next - Now;
                        if (wait > 1)
                        {
                            long due = -(long)(wait * 10000);
                            if (timer == IntPtr.Zero || !SetWaitableTimer(timer, ref due, 0, IntPtr.Zero, IntPtr.Zero, false)) Thread.Sleep((int)wait);
                            else WaitForMultipleObjects(2, either, false, 1000);
                            if (!live) continue;
                        }
                        if (Interlocked.CompareExchange(ref inFlight, 1, 0) != 0) { next = Now + 2; continue; }
                        Job job; lock (gate) job = Next();
                        next = Now + (job == null ? DesktopVisuals.GlowRestFrame : job.Every);
                        if (job == null) { Interlocked.Exchange(ref inFlight, 0); continue; }
                        double began = Now;
                        if (job.Band) job.Edge.Compose(job.Time, job.X, job.Y, job.Grow, job.Bright);
                        if (job.Wash) job.Veil.Compose(job.Time, job.X, job.Y, 1, job.Bright);
                        composing += Now - began; composed++;
                        strips[0].BeginInvoke((MethodInvoker)delegate { double start = Now; try { Apply(job); } catch { } finally { presenting += Now - start; Interlocked.Exchange(ref inFlight, 0); } });
                    }
                    catch { Interlocked.Exchange(ref inFlight, 0); Thread.Sleep(50); }
                }
            }

            // Decides what this frame needs. Called under gate.
            Job Next()
            {
                if (edge == null || !live) { live = false; return null; }
                double now = Now; bool motion = DesktopVisuals.MotionEnabled, quick = false;
                Job job = new Job(); job.Edge = edge; job.Veil = veil; job.Generation = generation; job.Grow = 1; job.Master = (float)masterTo;
                if (pointAt >= 0)
                {
                    float t = (float)((now - pointAt) / DesktopVisuals.Normal), e = DesktopVisuals.EaseInOut(t);
                    aimX = pointFromX + (pointToX - pointFromX) * e; aimY = pointFromY + (pointToY - pointFromY) * e;
                    if (t >= 1) { pointAt = -1; aimX = pointToX; aimY = pointToY; }
                    quick = true;
                }
                if (enterAt >= 0)
                {
                    float t = (float)((now - enterAt) / DesktopVisuals.Slow);
                    job.Grow = DesktopVisuals.EaseOut(t);
                    if (t >= 1) enterAt = -1;
                    quick = true;
                }
                bool dimming = brightAt >= 0;
                if (dimming)
                {
                    float t = (float)((now - brightAt) / DesktopVisuals.Normal);
                    bright = brightFrom + (brightTo - brightFrom) * DesktopVisuals.EaseOut(t);
                    if (t >= 1) { brightAt = -1; bright = brightTo; }
                    quick = true;
                }
                if (masterAt >= 0)
                {
                    // Opacity only: no new picture is needed for it. The UI
                    // thread clears masterAt when it has seen the fade end.
                    double t = masterMs <= 0 ? 1 : (now - masterAt) / masterMs;
                    job.Master = (float)(masterFrom + (masterTo - masterFrom) * DesktopVisuals.EaseOut((float)t));
                    job.Done = t >= 1;
                }
                // The light is never quite still, but at rest it changes by
                // less than one level a frame, so it is composed at the rest
                // rate. With motion reduced it is composed when something
                // changes, and then holds.
                if (motion) still = now / 1000.0;
                job.Time = still; job.X = aimX; job.Y = aimY; job.Bright = bright;
                job.Band = bandDue || quick || (motion && now - bandAt >= DesktopVisuals.GlowRestFrame - 4);
                job.Every = quick || masterAt >= 0 ? DesktopVisuals.GlowFrame : DesktopVisuals.GlowRestFrame;
                job.Wash = washDue || dimming || (motion && now - washAt >= DesktopVisuals.GlowVeilFrame);
                if (job.Band) { bandDue = false; bandAt = now; }
                if (job.Wash) { washDue = false; washAt = now; }
                if (!job.Band && !job.Wash && masterAt < 0)
                {
                    if (!motion) live = false;   // nothing will change until something asks
                    return null;
                }
                return job;
            }

            // Back on the UI thread: put the finished frame on screen, unless
            // the glow has changed or gone since it was asked for.
            void Apply(Job job)
            {
                bool stale; lock (gate) stale = job.Generation != generation || job.Edge != edge;
                if (stale || !shown || suspended) return;
                if (waiting && !(job.Band && job.Wash)) { lock (gate) bandDue = washDue = true; return; }
                for (int i = 0; i < 4; i++)
                {
                    if (job.Band) { Rectangle strip = job.Edge.Strips[i]; if (!strip.IsEmpty) { strip.Offset(shift); strips[i].Surface(job.Edge.Pixels[i], strip); } }
                    if (job.Wash) { Rectangle strip = job.Veil.Strips[i]; if (!strip.IsEmpty) { strip.Offset(shift); strips[4 + i].Surface(job.Veil.Pixels[i], strip); } }
                }
                master = job.Master;
                for (int i = 0; i < 8; i++) strips[i].Level = master;
                if (waiting)
                {
                    waiting = false;
                    for (int i = 0; i < 8; i++) { if (Field(i).Strips[i % 4].IsEmpty) strips[i].Hide(); else if (!strips[i].Visible) strips[i].Show(); }
                    Order();
                }
                if (job.Band)
                {
                    double now = Now;
                    if (lastShown >= 0 && now - lastShown < 250) gaps[gapCount++ % gaps.Length] = now - lastShown;
                    lastShown = now;
                }
                if (job.Done)
                {
                    lock (gate) masterAt = -1;
                    if (leaving) { HideNow(); target = IntPtr.Zero; lock (gate) edge = veil = null; leaving = false; watch.Stop(); }
                    else if (passing) HideNow();   // the watch enters again on the new bounds
                }
            }

            void FadeTo(float level, int milliseconds)
            {
                lock (gate) { masterFrom = master; masterTo = level; masterAt = Now; masterMs = DesktopVisuals.MotionEnabled ? milliseconds : 0; }
                Wake();
            }

            // glow.pass: the window jumped (maximised, restored, minimised)
            // or the agent moved to another one. The light leaves over
            // NormalLeave and enters again where it now belongs.
            void Pass()
            {
                if (!shown || passing) return;
                if (waiting || suspended || !DesktopVisuals.MotionEnabled) { HideNow(); return; }
                passing = true; FadeTo(0, DesktopVisuals.NormalLeave);
            }

            // glow.exit (NormalLeave) and glow.stop (FastLeave): opacity only,
            // from whatever it has now. A stop is never slowed by a running exit.
            internal void Exit(int milliseconds)
            {
                sampleAt = -1;
                if (!shown || waiting || suspended) { HideNow(); target = IntPtr.Zero; lock (gate) edge = veil = null; leaving = false; watch.Stop(); return; }
                bool fading; lock (gate) fading = masterAt >= 0 && masterTo == 0 && masterMs <= milliseconds;
                if ((leaving || passing) && fading) { leaving = true; passing = false; return; }
                leaving = true; passing = false; FadeTo(0, milliseconds);
            }

            void HideNow()
            {
                for (int i = 0; i < 8; i++) if (strips[i].Visible) strips[i].Hide();
                shown = false; passing = false; waiting = false; master = 0; shift = Point.Empty; moved = false;
                lock (gate) { generation++; live = false; enterAt = -1; masterAt = -1; pointAt = -1; }
            }

            // A screenshot is being taken: out of the picture at once, and
            // back without ceremony when the agent carries on. A frame that
            // was on its way is dropped, so it cannot land in the picture.
            internal void Suspend()
            {
                if (!shown || suspended) return;
                suspended = true;
                lock (gate) { generation++; live = false; }
                for (int i = 0; i < 8; i++) if (strips[i].Visible) strips[i].Hide();
            }
            internal void Resume()
            {
                if (!suspended) return;
                suspended = false;
                if (!shown || edge == null) return;
                if (!waiting) for (int i = 0; i < 8; i++) if (!Field(i).Strips[i % 4].IsEmpty) strips[i].Show();
                Order(); lock (gate) bandDue = washDue = true; lastShown = -1; Wake();
            }

            bool IsStrip(IntPtr h) { for (int i = 0; i < 8; i++) if (strips[i].IsHandleCreated && strips[i].Handle == h) return true; return false; }

            // Directly above the target in z-order, never topmost unless the
            // target itself is. The edge band ends up above the wash.
            void Order()
            {
                if (!shown || target == IntPtr.Zero || passing) return;
                IntPtr above = GetWindow(target, GW_HWNDPREV);
                if (above != IntPtr.Zero && IsStrip(above)) return;
                bool targetTop = (GetWindowLongW(target, GWL_EXSTYLE) & 0x8) != 0;
                IntPtr after = above;
                if (above == IntPtr.Zero) after = targetTop ? new IntPtr(-1) : IntPtr.Zero;
                else if (!targetTop && (GetWindowLongW(above, GWL_EXSTYLE) & 0x8) != 0) after = IntPtr.Zero;
                for (int i = 0; i < 8; i++)
                    if (strips[i].Visible) SetWindowPos(strips[i].Handle, after, 0, 0, 0, 0, SWP_QUIET);
            }
        }

        // ------------------------------------------------------------------
        // The banner. The only surface here that accepts a click, because Stop
        // has to be pressable. With per-pixel alpha the transparent corners pass
        // clicks through on their own.
        sealed class BannerForm : GhostForm
        {
            const string BaseMessage = "Claude is using your computer";
            const string Action_ = "Stop";

            // Only says which session it is when there is another one to be
            // confused with. One Claude on the machine needs no qualifier.
            static string MessageText()
            {
                string m = BaseMessage;
                if (_peers > 0 && !string.IsNullOrEmpty(_sessionLabel))
                    m = m + " (" + _sessionLabel + " of " + (_peers + 1).ToString(System.Globalization.CultureInfo.InvariantCulture) + ")";
                if (!string.IsNullOrEmpty(_status))
                    m = m + " 00B7 " + _status;
                return m;
            }

            // Which monitor the banner belongs on. Centring it on the virtual
            // screen looks right on one display and is wrong on two: the middle
            // of the virtual screen is the seam between them, so the banner ends
            // up split down the gap, or on whichever monitor happens to own the
            // midpoint. It belongs on the screen the person is looking at, which
            // is the one holding the window they are working in.
            static Rectangle HostScreen()
            {
                try
                {
                    IntPtr fg = Native.GetForegroundWindow();
                    if (fg != IntPtr.Zero && !IsAnyOverlayWindow(fg))
                        return Screen.FromHandle(fg).Bounds;
                }
                catch { }
                try { return Screen.PrimaryScreen.Bounds; }
                catch { return SystemInformation.VirtualScreen; }
            }

            // Held for as long as the banner is up, so a change of foreground
            // mid-run does not make it hop between monitors.
            Rectangle _screen = Rectangle.Empty;

            // Row for this session, one banner height apart, on its own monitor.
            int RestY()
            {
                Rectangle sc = _screen.IsEmpty ? HostScreen() : _screen;
                return sc.Y + 14 + _slot * (H + 10);
            }
            const int H = 54, PadL = 20, PadR = 8, Gap = 16, StopH = 38, StopPadX = 20;
            const int DotSize = 8, DotGap = 12;

            Rectangle _stopRect;
            bool _hover, _pressed;
            readonly System.Windows.Forms.Timer _pulse;
            float _phase;

            internal BannerForm() : base(false)
            {
                _pulse = new System.Windows.Forms.Timer();
                _pulse.Interval = 66;
                _pulse.Tick += delegate
                {
                    _phase += 0.06f;
                    if (_phase > 1f) _phase -= 1f;
                    Redraw();
                };
            }

            static int Measure(string text, float size, FontStyle style)
            {
                using (Bitmap b = new Bitmap(1, 1))
                using (Graphics g = Graphics.FromImage(b))
                using (Font f = new Font(UiFont, size, style))
                    return (int)Math.Ceiling(g.MeasureString(text, f).Width);
            }

            static int MeasureWidth()
            {
                return PadL + DotSize + DotGap + Measure(MessageText(), 11f, FontStyle.Regular)
                     + Gap + (Measure(Action_, 10.5f, FontStyle.Bold) + StopPadX * 2) + PadR;
            }

            // The label can change while the banner is up - another session
            // starts, or the last one leaves - so it can be re-measured in place.
            internal void Relayout()
            {
                if (!Visible) return;
                int w = MeasureWidth();
                Rectangle sc = _screen.IsEmpty ? HostScreen() : _screen;
                Bounds = new Rectangle(sc.X + (sc.Width - w) / 2, RestY(), w, H);
                LayoutStop();
                Redraw();
            }

            void LayoutStop()
            {
                int w = Measure(Action_, 10.5f, FontStyle.Bold) + StopPadX * 2;
                _stopRect = new Rectangle(Width - PadR - w, (H - StopH) / 2, w, StopH);
            }

            internal void Appear()
            {
                if (Visible) return;
                int w = MeasureWidth();
                // Pick the monitor once, as it appears, and keep it.
                _screen = HostScreen();
                int restY = RestY();
                Bounds = new Rectangle(_screen.X + (_screen.Width - w) / 2, restY - 8, w, H);
                LayoutStop();
                Alpha = 0;
                Redraw();
                Show();
                TopMost = true;
                _pulse.Start();
                Animate(180, delegate(float t)
                {
                    Alpha = t;
                    PlaceAt(Left, (int)Lerp(restY - 8, restY, t));
                }, null);
            }

            internal void Vanish()
            {
                if (!Visible) { _pulse.Stop(); return; }
                _pulse.Stop();
                _hover = _pressed = false;
                float from = Alpha;
                int restY = Top;
                Animate(150, delegate(float t)
                {
                    Alpha = from * (1 - t);
                    PlaceAt(Left, (int)Lerp(restY, restY - 6, t));
                }, delegate { Hide(); PlaceAt(Left, restY); });
            }

            protected override void OnMouseMove(MouseEventArgs e)
            {
                bool over = _stopRect.Contains(e.Location);
                if (over != _hover)
                {
                    _hover = over;
                    Cursor = over ? Cursors.Hand : Cursors.Default;
                    Redraw();
                }
                base.OnMouseMove(e);
            }

            protected override void OnMouseLeave(EventArgs e)
            {
                if (_hover || _pressed) { _hover = _pressed = false; Cursor = Cursors.Default; Redraw(); }
                base.OnMouseLeave(e);
            }

            protected override void OnMouseDown(MouseEventArgs e)
            {
                if (_stopRect.Contains(e.Location)) { _pressed = true; Redraw(); }
                base.OnMouseDown(e);
            }

            protected override void OnMouseUp(MouseEventArgs e)
            {
                bool fire = _pressed && _stopRect.Contains(e.Location);
                _pressed = false;
                if (fire)
                {
                    RequestStop();
                    Vanish();
                    try { _glow.Exit(DesktopVisuals.FastLeave); _cursor.Vanish(); } catch { }
                }
                else Redraw();
                base.OnMouseUp(e);
            }

            protected override void Render(Graphics g)
            {
                RectangleF body = new RectangleF(0, 0, Width, H);
                using (SolidBrush bg = new SolidBrush(Accent))
                using (GraphicsPath path = RoundRect(body, H / 2f))
                    g.FillPath(bg, path);

                // Status dot: breathes while working. The only motion that says
                // something true - it is still going, and it leaves when done.
                float t = (float)((Math.Sin(_phase * Math.PI * 2) + 1) / 2);
                int a = (int)(110 + 145 * t);
                float grow = 1f + 0.25f * t;
                float ds = DotSize * grow;
                using (SolidBrush dot = new SolidBrush(Color.FromArgb(a, Paper)))
                    g.FillEllipse(dot, PadL + (DotSize - ds) / 2f, (H - ds) / 2f, ds, ds);

                using (Font f = new Font(UiFont, 11f, FontStyle.Regular))
                using (SolidBrush fg = new SolidBrush(Paper))
                using (StringFormat sf = new StringFormat())
                {
                    sf.LineAlignment = StringAlignment.Center;
                    sf.FormatFlags = StringFormatFlags.NoWrap;
                    float x = PadL + DotSize + DotGap;
                    g.DrawString(MessageText(), f, fg, new RectangleF(x, 0, _stopRect.Left - Gap - x, H), sf);
                }

                Color fill = _pressed ? Shade(Paper, 0.12f) : (_hover ? Color.White : Paper);
                using (SolidBrush sb = new SolidBrush(fill))
                using (GraphicsPath sp = RoundRect(_stopRect, _stopRect.Height / 2f))
                    g.FillPath(sb, sp);

                using (Font af = new Font(UiFont, 10.5f, FontStyle.Bold))
                using (SolidBrush at = new SolidBrush(Ink))
                using (StringFormat sf = new StringFormat())
                {
                    sf.Alignment = StringAlignment.Center;
                    sf.LineAlignment = StringAlignment.Center;
                    g.DrawString(Action_, af, at, _stopRect, sf);
                }
            }
        }

        // ------------------------------------------------------------------
        sealed class CursorForm : GhostForm
        {
            readonly System.Windows.Forms.Timer _hover;
            bool _showLabel;
            const int ArrowW = 22, ArrowH = 32, LabelGap = 6;
            readonly System.Windows.Forms.Timer _follow,_rippling;
            float _scale=1;
            bool _ripple;DateTime _clicked;
            // pointer.follow: the glow is moved by the pointer's own events,
            // so it never trails. The hook only notes the point and posts one
            // message; the window work happens here on the UI thread.
            volatile int _atX,_atY;volatile bool _following;int _posted;
            // pointer.click: one ring, over Press, drawn on a kept surface.
            internal void Ping() {_clicked=DateTime.UtcNow;_ripple=true;RedrawKept();_rippling.Start();}

            internal CursorForm() : base(true)
            {
                Size = new Size(220, 64);
                // Polling beats hit-testing: this window stays click-through, so
                // it can never swallow a click meant for an app underneath.
                _hover = new System.Windows.Forms.Timer();
                _hover.Interval = 120;
                _hover.Tick += delegate { UpdateHover(); };
                // The slow check: a change of monitor scale, and a place to
                // stand if the pointer's events are not available.
                _follow=new System.Windows.Forms.Timer();_follow.Interval=100;
                _follow.Tick += delegate {
                    NPOINT p;if(!GetCursorPos(out p))return;
                    int wanted=Presence.HooksOk?100:16;if(_follow.Interval!=wanted)_follow.Interval=wanted;
                    float scale=ScreenScale(Screen.FromPoint(new Point(p.X,p.Y)));
                    if(scale!=_scale) {_scale=scale;Size=new Size((int)(96*scale),(int)(96*scale));RedrawKept();}
                    PlaceAt(p.X-(int)(48*scale),p.Y-(int)(48*scale));
                };
                _rippling=new System.Windows.Forms.Timer();_rippling.Interval=16;
                _rippling.Tick += delegate {
                    if((DateTime.UtcNow-_clicked).TotalMilliseconds>=DesktopVisuals.Press){_ripple=false;_rippling.Stop();}
                    if(Visible)RedrawKept();
                };
                if(Environment.GetEnvironmentVariable("AGCU_GUARDIAN")=="1")Presence.PointerMoved=delegate(int x,int y) {
                    _atX=x;_atY=y;
                    if(!_following||Interlocked.Exchange(ref _posted,1)!=0)return;
                    try {BeginInvoke((MethodInvoker)delegate {
                        Interlocked.Exchange(ref _posted,0);
                        if(_following&&Visible)SlideTo(_atX-(int)(48*_scale),_atY-(int)(48*_scale));
                    });}catch {Interlocked.Exchange(ref _posted,0);}
                };
            }

            internal void FollowRealCursor() {
                // A screenshot may have hidden the pointer's glow while it kept following.
                if(_follow.Enabled&&Visible)return;
                NPOINT p;if(!GetCursorPos(out p))return;
                _scale=ScreenScale(Screen.FromPoint(new Point(p.X,p.Y)));
                Size=new Size((int)(96*_scale),(int)(96*_scale));
                Location=new Point(p.X-(int)(48*_scale),p.Y-(int)(48*_scale));
                StopAnimation();Alpha=1;RedrawKept();Show();_follow.Start();_following=true;
            }

            internal void MoveTo(int x, int y)
            {
                // Two sessions acting on the same control would put two cursors
                // in exactly the same place, and the top one would be the only
                // one you ever saw. A few pixels of stagger per session keeps
                // both visible without moving either far from what it touched.
                x += _slot * 11;
                y += _slot * 7;
                if (!Visible)
                {
                    Location = new Point(x, y);
                    Alpha = 0;
                    Redraw();
                    Show();
                    TopMost = true;
                    _hover.Start();
                    Animate(160, delegate(float t) { Alpha = t; }, null);
                    return;
                }
                Point from = Location;
                // A short glide beats a jump: you can follow where it went.
                Animate(200, delegate(float t)
                {
                    PlaceAt((int)Lerp(from.X, x, t), (int)Lerp(from.Y, y, t));
                }, null);
            }

            internal void Vanish()
            {
                _follow.Stop();_following=false;_rippling.Stop();_ripple=false;
                _hover.Stop();
                _showLabel = false;
                if (!Visible) return;
                float from = Alpha;
                Animate(180, delegate(float t) { Alpha = from * (1 - t); }, delegate { Hide(); });
            }

            void UpdateHover()
            {
                NPOINT p;
                if (!GetCursorPos(out p)) return;
                Rectangle near = new Rectangle(Left - 24, Top - 24, ArrowW + 48, ArrowH + 48);
                bool want = near.Contains(p.X, p.Y);
                if (want != _showLabel) { _showLabel = want; Redraw(); }
            }

            static GraphicsPath ArrowPath()
            {
                PointF[] pts = {
                    new PointF(0f,    0f),    new PointF(0f,    23.5f), new PointF(6.2f,  18f),
                    new PointF(9.7f,  26.3f), new PointF(13.8f, 24.3f), new PointF(10.4f, 16f),
                    new PointF(16.6f, 16f),
                };
                GraphicsPath p = new GraphicsPath();
                p.AddPolygon(pts);
                return p;
            }

            protected override void Render(Graphics g)
            {
                if(Environment.GetEnvironmentVariable("AGCU_GUARDIAN")=="1") {
                    g.ScaleTransform(_scale,_scale);DesktopVisuals.Pointer(g,0);
                    if(_ripple) {
                        DesktopVisuals.Ripple(g,(float)Math.Min(1,(DateTime.UtcNow-_clicked).TotalMilliseconds/DesktopVisuals.Press));
                    }
                    return;
                }
                using (GraphicsPath arrow = ArrowPath())
                using (SolidBrush fill = new SolidBrush(Accent))
                using (Pen edge = new Pen(Paper, 1.6f))
                {
                    edge.LineJoin = LineJoin.Round;
                    g.DrawPath(edge, arrow);
                    g.FillPath(fill, arrow);
                }

                if (!_showLabel) return;

                // Named for its session once there is another one to confuse it
                // with, so the colour has a caption rather than being a code.
                string label = (_peers > 0 && !string.IsNullOrEmpty(_sessionLabel))
                    ? "Claude - " + _sessionLabel
                    : "Claude Cursor";
                using (Font f = new Font(UiFont, 9f, FontStyle.Regular))
                {
                    SizeF sz = g.MeasureString(label, f);
                    RectangleF tag = new RectangleF(ArrowW + LabelGap, ArrowH * 0.45f, sz.Width + 18, sz.Height + 10);
                    using (SolidBrush bg = new SolidBrush(Accent))
                    using (GraphicsPath path = RoundRect(tag, tag.Height / 2f))
                        g.FillPath(bg, path);
                    using (SolidBrush fg = new SolidBrush(Paper))
                        g.DrawString(label, f, fg, tag.X + 9, tag.Y + 5);
                }
            }
            protected override void Dispose(bool disposing) {
                if(disposing){_follow.Dispose();_hover.Dispose();_rippling.Dispose();}base.Dispose(disposing);
            }
        }

        // ------------------------------------------------------------------
        // Names the control as it is touched, so what is happening is readable
        // at a glance instead of being an unexplained rectangle.
        sealed class MarkerForm : GhostForm
        {
            readonly System.Windows.Forms.Timer _timer;
            string _label = "";
            Rectangle _target;
            const int TagH = 26;

            internal MarkerForm() : base(true)
            {
                Bounds = new Rectangle(-10000, -10000, 10, 10);
                _timer = new System.Windows.Forms.Timer();
                _timer.Interval = 620;
                _timer.Tick += delegate
                {
                    _timer.Stop();
                    if (!Visible) return;
                    float from = Alpha;
                    Animate(240, delegate(float t) { Alpha = from * (1 - t); }, delegate { Hide(); });
                };
            }

            internal void Flash(Rectangle target, string label)
            {
                StopAnimation();
                _label = label ?? "";
                _target = target;
                int w = Math.Max(target.Width + 8, TagWidth() + 8);
                Bounds = new Rectangle(target.X - 4, target.Y - TagH - 4, w, target.Height + TagH + 8);
                Alpha = 1;
                Redraw();
                if (!Visible) Show();
                TopMost = true;
                _timer.Stop();
                _timer.Start();
            }

            int TagWidth()
            {
                if (_label.Length == 0) return 0;
                using (Bitmap b = new Bitmap(1, 1))
                using (Graphics g = Graphics.FromImage(b))
                using (Font f = new Font(UiFont, 8.5f, FontStyle.Regular))
                    return (int)Math.Ceiling(g.MeasureString(_label, f).Width) + 18;
            }

            protected override void Render(Graphics g)
            {
                Rectangle box = new Rectangle(4, TagH + 4, _target.Width, _target.Height);
                using (Pen pen = new Pen(Accent, 2f))
                {
                    pen.Alignment = PenAlignment.Inset;
                    g.DrawRectangle(pen, box);
                }

                if (_label.Length == 0) return;
                using (Font f = new Font(UiFont, 8.5f, FontStyle.Regular))
                {
                    SizeF sz = g.MeasureString(_label, f);
                    RectangleF tag = new RectangleF(4, 2, sz.Width + 18, TagH - 2);
                    using (SolidBrush bg = new SolidBrush(Accent))
                    using (GraphicsPath path = RoundRect(tag, (TagH - 2) / 2f))
                        g.FillPath(bg, path);
                    using (SolidBrush fg = new SolidBrush(Paper))
                        g.DrawString(_label, f, fg, tag.X + 9, tag.Y + 4);
                }
            }
        }
    }
}
